/**
 * Imports: full JSON restore (replace), JSON merge, CSV products, CSV purchase history and AI
 * recommendations. Every import runs in one SQLite transaction; a preview runs the exact same
 * code and then rolls back, so the preview always matches the real result.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { GroceryStore } from '../store';
import { createBackupSync } from '../backup';
import { readSettings, writeSettings } from '../settings';
import { householdMessages } from '../i18n';
import { LANGUAGE_NAMES, type Messages } from '$lib/shared/i18n';
import {
	parseExportFile,
	parseTimestamp,
	Validator,
	type ImportDataset,
	type ImportItem
} from './format';
import { CsvError, hasColumn, pick, readCsvTable } from './csv';
import { readZip, ZipError } from './zip';
import { MediaError, sanitizeImage, type MediaStore } from '../media';
import { normaliseUnit } from '$lib/shared/quantity';
import { capitaliseFirst, cleanName, MAX_NAME_LENGTH, nameKey } from '$lib/shared/text';

import type { Counter, ImportKind, ImportMode, ImportReport } from '$lib/shared/transfer';

export type { Counter, ImportKind, ImportMode, ImportReport };

export interface ImportOptions {
	kind: ImportKind;
	mode: ImportMode;
	text: string;
	/** Raw upload; a ZIP (full backup with photos) is detected by its signature. */
	bytes?: Buffer;
	preview: boolean;
	backupDir: string;
	/** Needed to restore photos from a full backup. */
	media?: MediaStore;
	now?: number;
}

/** Full backup ZIP: manifest + export.json + media/*. See docs/IMPORT-EXPORT.md. */
export const BACKUP_FORMAT = '8star-grocery-backup';
export const BACKUP_FORMAT_VERSION = 1;

interface BackupContents {
	exportText: string;
	files: Map<string, Buffer>;
}

function readBackupZip(bytes: Buffer, t: Messages): BackupContents {
	let entries: Map<string, Buffer>;
	try {
		entries = readZip(bytes);
	} catch (e) {
		throw new ImportRejected(
			t.import.zipUnreadable(e instanceof ZipError ? zipErrorText(e, t) : t.import.unknownError)
		);
	}
	const manifestRaw = entries.get('manifest.json');
	if (!manifestRaw) throw new ImportRejected(t.import.notBackup);
	let manifest: { format?: unknown; formatVersion?: unknown };
	try {
		manifest = JSON.parse(manifestRaw.toString('utf8'));
	} catch {
		throw new ImportRejected(t.import.manifestInvalid);
	}
	if (manifest.format !== BACKUP_FORMAT)
		throw new ImportRejected(t.import.unknownBackupFormat(BACKUP_FORMAT));
	if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion > BACKUP_FORMAT_VERSION)
		throw new ImportRejected(t.import.backupVersion(String(manifest.formatVersion)));
	const exportRaw = entries.get('export.json');
	if (!exportRaw) throw new ImportRejected(t.import.exportMissing);
	return { exportText: exportRaw.toString('utf8'), files: entries };
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const newId = (prefix: string) => `${prefix}-${randomBytes(9).toString('base64url')}`;

class PreviewRollback extends Error {}
class ImportRejected extends Error {}

/** Readable text for a ZIP problem (the codes come from zip.ts). */
function zipErrorText(e: ZipError, t: Messages): string {
	const z = t.import.zip;
	switch (e.code) {
		case 'compression':
			return z.compression(e.entry);
		case 'checksum':
			return z.checksum(e.entry);
		case 'extract':
			return z.extract(e.entry);
		default:
			return z[e.code];
	}
}

function counter(): Counter {
	return { added: 0, matched: 0, updated: 0, duplicates: 0, skipped: 0, removed: 0 };
}

function summarise(report: ImportReport, t: Messages) {
	const lines: string[] = [];
	const s = t.import.summary;
	const n = (count: number, key: string) => {
		const [one, many] = s.labels[key] ?? [key, key];
		return `${count} ${count === 1 ? one : many}`;
	};
	for (const [key, c] of Object.entries(report.counts)) {
		const parts: string[] = [];
		for (const action of ['removed', 'added', 'updated'] as const)
			if (c[action]) parts.push(s.action(n(c[action], key), c[action], action, report.preview));
		if (c.matched) parts.push(s.matched(n(c.matched, key)));
		if (c.duplicates) parts.push(s.duplicates(c.duplicates));
		if (c.skipped) parts.push(s.skipped(c.skipped));
		if (parts.length) lines.push(parts.join(', '));
	}
	if (!lines.length) lines.push(s.nothing);
	report.summary = lines;
}

/** Entry point for all imports. Never throws for user errors: they end up in `errors`. */
export function runImport(store: GroceryStore, options: ImportOptions): ImportReport {
	const { kind, preview } = options;
	const mode: ImportMode = kind === 'json' ? options.mode : 'merge';
	const now = options.now ?? Date.now();
	const report: ImportReport = {
		ok: false,
		preview,
		kind,
		mode,
		summary: [],
		counts: {},
		warnings: [],
		errors: []
	};
	const count = (key: string) => (report.counts[key] ??= counter());
	const settingNotes: string[] = [];
	const t = householdMessages(store.db);

	try {
		// Parse and validate everything before touching the database.
		let apply: () => void;
		let backup: BackupContents | null = null;
		if (kind === 'json' && options.bytes && options.bytes.subarray(0, 4).equals(ZIP_MAGIC)) {
			backup = readBackupZip(options.bytes, t);
		}
		if (kind === 'json' || kind === 'ai') {
			let parsed: unknown;
			try {
				parsed = JSON.parse((backup?.exportText ?? options.text).replace(/^\ufeff/, ''));
			} catch {
				throw new ImportRejected(t.import.invalidJson);
			}
			if (kind === 'json') {
				const v = new Validator(t);
				const data = parseExportFile(parsed, v);
				report.warnings.push(...v.warnings);
				if (v.errors.length) {
					report.errors.push(...v.errors);
					throw new ImportRejected('');
				}
				if (mode === 'replace' && !data.lists.length)
					throw new ImportRejected(t.import.replaceNeedsList);
				const photos = preparePhotos(store, data, backup, options, report, count, t);
				apply = () => {
					photos();
					if (mode === 'replace') {
						replaceAll(store, data, count, now);
						settingNotes.push(...applySettings(store, data, preview, t));
					} else {
						mergeDataset(store, data, count, report, now);
						const current = readSettings(store.db);
						const suggestions = data.settings?.suggestionsEnabled;
						if (suggestions !== undefined && suggestions !== current.suggestionsEnabled)
							settingNotes.push(t.import.suggestionsNotApplied);
						const bulkAdd = data.settings?.bulkAddEnabled;
						if (bulkAdd !== undefined && bulkAdd !== current.bulkAddEnabled)
							settingNotes.push(t.import.bulkAddNotApplied);
						const language = data.settings?.language;
						if (language !== undefined && language !== current.language)
							settingNotes.push(t.import.languageNotApplied);
					}
				};
			} else {
				apply = prepareAiImport(store, parsed, count, report, now, t);
			}
		} else {
			apply =
				kind === 'products-csv'
					? prepareProductsCsv(store, options.text, count, report, now, t)
					: preparePurchasesCsv(store, options.text, count, report, now, t);
		}

		if (!preview && mode === 'replace') {
			// Safety net: a consistent copy of the current database before it is replaced.
			report.backupFile = createBackupSync(store.db, options.backupDir, 'pre-import')
				.split(/[\\/]/)
				.pop();
		}

		const execute = () => {
			apply();
			if (report.errors.length) throw new ImportRejected('');
			if (preview) throw new PreviewRollback();
		};
		try {
			store.bulkChange(execute);
		} catch (e) {
			if (!(e instanceof PreviewRollback)) throw e;
		}
		report.ok = true;
	} catch (e) {
		if (e instanceof ImportRejected) {
			if (e.message) report.errors.unshift(e.message);
		} else if (e instanceof CsvError) {
			report.errors.unshift(e.code === 'unclosed' ? t.import.csvUnclosed : t.import.csvEmpty);
		} else {
			console.error('[8star] import failed', e);
			report.errors.unshift(t.import.failed((e as Error).message ?? t.import.unknownError));
		}
		report.ok = false;
	}
	if (report.ok) {
		summarise(report, t);
		report.summary.push(...settingNotes);
	} else report.summary = [t.import.nothingChanged];
	return report;
}

// ------------------------------------------------------------------ replace

function replaceAll(
	store: GroceryStore,
	d: ImportDataset,
	count: (k: string) => Counter,
	now: number
) {
	const db = store.db;
	const existing = (table: string) =>
		(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
	count('lists').removed = existing('lists');
	count('categories').removed = existing('categories');
	count('products').removed = existing('products');
	count('listItems').removed = existing('items');
	count('purchaseEvents').removed = existing('cycles');
	count('aiRecommendations').removed = existing('ai_recommendations');
	count('productAliases').removed = existing('product_aliases');
	count('bundles').removed = existing('bundles');

	// Photos are kept on disk (and in `media`) until the periodic cleanup: a later undo or
	// restore can still need them. Rounds, claims and snoozes are temporary and not restored.
	db.exec(`DELETE FROM claims; DELETE FROM rounds; DELETE FROM snoozes;
		DELETE FROM bundle_lines; DELETE FROM bundles; DELETE FROM product_aliases;
		DELETE FROM items; DELETE FROM cycles; DELETE FROM ai_recommendations;
		DELETE FROM products; DELETE FROM categories; DELETE FROM lists;`);

	const insList = db.prepare(
		`INSERT INTO lists (id, name, position, created_at, updated_at, kind, kind_changed_at, category_order)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const l of d.lists)
		insList.run(
			l.id,
			l.name,
			l.position,
			l.createdAt,
			l.updatedAt,
			l.kind,
			l.kindChangedAt,
			l.categoryOrder ? JSON.stringify(l.categoryOrder) : null
		);
	const insCat = db.prepare(
		`INSERT INTO categories (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
	);
	for (const c of d.categories) insCat.run(c.id, c.name, c.position, c.createdAt, c.updatedAt);
	const insProduct = productInserter(store);
	for (const p of d.products) insProduct(p, p.categoryId);
	const insEvent = eventInserter(store);
	for (const e of d.purchaseEvents) insEvent(e, e.productId, e.listId);
	const insItem = itemInserter(store);
	for (const i of d.listItems) insItem(i, i.id, i.listId, i.productId, i.purchaseEventId);
	const insRec = recommendationInserter(store);
	for (const r of d.aiRecommendations) insRec({ ...r, fingerprint: fingerprint(r) });
	const insAlias = aliasInserter(store);
	for (const a of d.productAliases) insAlias(a, a.productId);
	const insBundle = bundleInserter(store);
	for (const b of d.bundles) insBundle(b, b.id, (id) => id);
	count('productAliases').added = d.productAliases.length;
	count('bundles').added = d.bundles.length;

	count('lists').added = d.lists.length;
	count('categories').added = d.categories.length;
	count('products').added = d.products.length;
	count('listItems').added = d.listItems.length;
	count('purchaseEvents').added = d.purchaseEvents.length;
	count('aiRecommendations').added = d.aiRecommendations.length;

	store.markDatasetReplaced(now);
}

/**
 * A full replace restores the settings stored in the file. Files without settings (older
 * exports) keep the current ones. Returns summary lines for changed settings.
 */
function applySettings(
	store: GroceryStore,
	d: ImportDataset,
	preview: boolean,
	t: Messages
): string[] {
	const notes: string[] = [];
	const { suggestionsEnabled, bulkAddEnabled, language } = d.settings ?? {};
	if (suggestionsEnabled !== undefined && writeSettings(store.db, { suggestionsEnabled }))
		notes.push(t.import.suggestionsSetting(suggestionsEnabled, preview));
	if (bulkAddEnabled !== undefined && writeSettings(store.db, { bulkAddEnabled }))
		notes.push(t.import.bulkAddSetting(bulkAddEnabled, preview));
	if (language !== undefined && writeSettings(store.db, { language }))
		notes.push(t.import.languageSetting(LANGUAGE_NAMES[language], preview));
	return notes;
}

function productInserter(store: GroceryStore) {
	const stmt = store.db.prepare(
		`INSERT INTO products (id, name, name_key, category_id, favorite, created_at, updated_at, default_quantity,
			default_unit, preferred_list_id, note, photo_id, stock_status, stock_updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	return (
		p: ImportDataset['products'][number],
		categoryId: string | null,
		listId = p.preferredListId
	) =>
		stmt.run(
			p.id,
			p.name,
			nameKey(p.name),
			categoryId,
			p.favorite ? 1 : 0,
			p.createdAt,
			p.updatedAt,
			p.defaultQuantity,
			p.defaultUnit,
			listId,
			p.note,
			p.photoId,
			p.stockStatus,
			p.stockUpdatedAt
		);
}

function eventInserter(store: GroceryStore) {
	const stmt = store.db.prepare(
		`INSERT INTO cycles (id, product_id, list_id, activated_at, completed_at, cancelled_at, quantity, unit,
			requested_quantity, purchased_quantity, last_purchase_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	return (e: ImportDatasetEvent, productId: string, listId: string | null, id = e.id) =>
		stmt.run(
			id,
			productId,
			listId,
			e.activatedAt,
			e.completedAt,
			e.cancelledAt,
			e.quantity,
			e.unit,
			e.requestedQuantity,
			e.purchasedQuantity,
			e.completedAt ?? (e.purchasedQuantity ? e.activatedAt : null)
		);
}

function itemInserter(store: GroceryStore) {
	const stmt = store.db.prepare(
		`INSERT INTO items (id, list_id, product_id, quantity, unit, status, activated_at, completed_at, cycle_id,
			created_at, updated_at, note, substitute_ok, substitute_note, unavailable_at, position)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	return (i: ImportItem, id: string, listId: string, productId: string, cycleId: string | null) =>
		stmt.run(
			id,
			listId,
			productId,
			i.quantity,
			i.unit,
			i.status,
			i.activatedAt,
			i.completedAt,
			cycleId,
			i.createdAt,
			i.updatedAt,
			i.note,
			i.substituteOk ? 1 : 0,
			i.substituteNote,
			i.unavailableAt,
			i.position
		);
}

function aliasInserter(store: GroceryStore) {
	const stmt = store.db.prepare(
		'INSERT INTO product_aliases (id, product_id, alias, alias_key, created_at) VALUES (?, ?, ?, ?, ?)'
	);
	return (a: ImportDataset['productAliases'][number], productId: string, id = a.id) =>
		stmt.run(id, productId, a.alias, nameKey(a.alias), a.createdAt);
}

function bundleInserter(store: GroceryStore) {
	const bundle = store.db.prepare(
		'INSERT INTO bundles (id, name, servings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
	);
	const line = store.db.prepare(
		'INSERT INTO bundle_lines (id, bundle_id, product_id, quantity, unit, note, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
	);
	return (
		b: ImportDataset['bundles'][number],
		id: string,
		product: (id: string) => string,
		lineId: (id: string) => string = (x) => x
	) => {
		bundle.run(id, b.name, b.servings, b.createdAt, b.updatedAt);
		b.lines.forEach((l, i) =>
			line.run(lineId(l.id), id, product(l.productId), l.quantity, l.unit, l.note, i)
		);
	};
}

/**
 * Photos of a full backup are validated up front (same rules as uploads) and written inside
 * the import transaction; a preview never writes files. Photo references without bytes (a
 * plain JSON export) are kept only when the photo already exists on this server.
 */
function preparePhotos(
	store: GroceryStore,
	d: ImportDataset,
	backup: BackupContents | null,
	options: ImportOptions,
	report: ImportReport,
	count: (k: string) => Counter,
	t: Messages
): () => void {
	const available = new Map<string, { data: Buffer; createdAt: number }>();
	for (const m of d.media) {
		const data = backup?.files.get(m.file);
		if (!data) continue;
		try {
			sanitizeImage(data, t);
			available.set(m.id, { data, createdAt: m.createdAt });
		} catch (e) {
			report.warnings.push(
				t.import.photoSkipped(m.id, e instanceof MediaError ? e.message : t.import.unreadable)
			);
		}
	}
	// Without a media store (never in the app itself) photos cannot be written.
	if (!options.media && !options.preview) available.clear();
	let missing = 0;
	for (const p of d.products) {
		if (!p.photoId) continue;
		const exists = !!store.db.prepare('SELECT 1 FROM media WHERE id = ?').get(p.photoId);
		if (!available.has(p.photoId) && !exists) {
			p.photoId = null;
			missing++;
		}
	}
	if (missing) report.warnings.push(t.import.photosMissing(missing));
	return () => {
		for (const [id, m] of available) {
			if (options.preview || !options.media) {
				// Preview: a placeholder row satisfies the foreign key; the transaction rolls back.
				store.db
					.prepare(
						"INSERT OR IGNORE INTO media (id, mime, width, height, bytes, sha256, created_at) VALUES (?, 'image/jpeg', 1, 1, 0, '', ?)"
					)
					.run(id, m.createdAt);
			} else options.media.restore(id, m.data, m.createdAt);
			count('media').added++;
		}
	};
}

// ------------------------------------------------------------------ merge

interface Row {
	[k: string]: unknown;
}

function nameIndex(store: GroceryStore, table: 'lists' | 'categories' | 'products' | 'bundles') {
	const byKey = new Map<string, string>();
	for (const r of store.db.prepare(`SELECT id, name FROM ${table}`).all() as Row[])
		byKey.set(nameKey(r.name as string), r.id as string);
	return byKey;
}

function exists(store: GroceryStore, table: string, id: string): Row | undefined {
	return store.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
}

function nextPosition(store: GroceryStore, table: 'lists' | 'categories'): number {
	return (
		store.db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${table}`).get() as {
			p: number;
		}
	).p;
}

function freeId(store: GroceryStore, table: string, id: string, prefix: string): string {
	return exists(store, table, id) ? newId(prefix) : id;
}

/** Merges a full export into the existing data. Existing data always wins on conflicts. */
function mergeDataset(
	store: GroceryStore,
	d: ImportDataset,
	count: (k: string) => Counter,
	report: ImportReport,
	now: number
) {
	const db = store.db;
	const listMap = new Map<string, string>();
	const catMap = new Map<string, string>();
	const productMap = new Map<string, string>();
	const eventMap = new Map<string, string>();

	for (const [table, rows, map, key] of [
		['lists', d.lists, listMap, 'lists'],
		['categories', d.categories, catMap, 'categories']
	] as const) {
		const byName = nameIndex(store, table);
		let position = nextPosition(store, table);
		for (const r of rows) {
			const target = exists(store, table, r.id) ? r.id : byName.get(nameKey(r.name));
			if (target) {
				map.set(r.id, target);
				count(key).matched++;
				continue;
			}
			db.prepare(
				`INSERT INTO ${table} (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
			).run(r.id, r.name, position++, r.createdAt, r.updatedAt);
			if (table === 'lists' && 'kind' in r)
				db.prepare('UPDATE lists SET kind = ?, kind_changed_at = ? WHERE id = ?').run(
					r.kind,
					r.kindChangedAt,
					r.id
				);
			byName.set(nameKey(r.name), r.id);
			map.set(r.id, r.id);
			count(key).added++;
		}
	}

	// A walking route of a newly added list, translated to this server's categories.
	for (const l of d.lists) {
		if (!l.categoryOrder || listMap.get(l.id) !== l.id || count('lists').added === 0) continue;
		const row = exists(store, 'lists', l.id);
		if (row && row.category_order === null) {
			const ids = l.categoryOrder.map((c) => catMap.get(c)).filter((c): c is string => !!c);
			if (ids.length)
				db.prepare('UPDATE lists SET category_order = ? WHERE id = ?').run(
					JSON.stringify(ids),
					l.id
				);
		}
	}

	const productsByName = nameIndex(store, 'products');
	const aliasKeys = new Map(
		(db.prepare('SELECT alias_key, product_id FROM product_aliases').all() as Row[]).map((r) => [
			r.alias_key as string,
			r.product_id as string
		])
	);
	const insProduct = productInserter(store);
	for (const p of d.products) {
		const categoryId = p.categoryId ? (catMap.get(p.categoryId) ?? null) : null;
		const preferred = p.preferredListId ? (listMap.get(p.preferredListId) ?? null) : null;
		const target =
			(exists(store, 'products', p.id) ? p.id : undefined) ??
			productsByName.get(nameKey(p.name)) ??
			aliasKeys.get(nameKey(p.name));
		if (target) {
			productMap.set(p.id, target);
			// Existing data wins; only empty fields are filled in from the file.
			const current = exists(store, 'products', target)!;
			const next = {
				favorite: current.favorite === 1 || p.favorite ? 1 : 0,
				category_id: (current.category_id as string | null) ?? categoryId,
				default_quantity: (current.default_quantity as number | null) ?? p.defaultQuantity,
				default_unit: current.default_quantity !== null ? current.default_unit : p.defaultUnit,
				preferred_list_id: (current.preferred_list_id as string | null) ?? preferred,
				note: (current.note as string | null) ?? p.note,
				photo_id: (current.photo_id as string | null) ?? p.photoId,
				stock_status:
					current.stock_status === 'unknown' ? p.stockStatus : (current.stock_status as string),
				stock_updated_at:
					current.stock_status === 'unknown' ? p.stockUpdatedAt : current.stock_updated_at
			};
			const changed = (Object.keys(next) as (keyof typeof next)[]).some(
				(k) => (next[k] ?? null) !== (current[k] ?? null)
			);
			if (changed) {
				db.prepare(
					`UPDATE products SET favorite = ?, category_id = ?, default_quantity = ?, default_unit = ?,
						preferred_list_id = ?, note = ?, photo_id = ?, stock_status = ?, stock_updated_at = ?,
						version = version + 1, updated_at = ? WHERE id = ?`
				).run(
					next.favorite,
					next.category_id,
					next.default_quantity,
					next.default_unit,
					next.preferred_list_id,
					next.note,
					next.photo_id,
					next.stock_status,
					next.stock_updated_at,
					now,
					target
				);
				count('products').updated++;
			} else count('products').matched++;
			continue;
		}
		insProduct(p, categoryId, preferred);
		productsByName.set(nameKey(p.name), p.id);
		productMap.set(p.id, p.id);
		count('products').added++;
	}

	const insAlias = aliasInserter(store);
	for (const a of d.productAliases) {
		const key = nameKey(a.alias);
		if (aliasKeys.has(key) || productsByName.has(key) || exists(store, 'product_aliases', a.id)) {
			count('productAliases').duplicates++;
			continue;
		}
		insAlias(a, productMap.get(a.productId)!);
		aliasKeys.set(key, productMap.get(a.productId)!);
		count('productAliases').added++;
	}

	const bundleNames = nameIndex(store, 'bundles');
	const insBundle = bundleInserter(store);
	for (const b of d.bundles) {
		if (exists(store, 'bundles', b.id) || bundleNames.has(nameKey(b.name))) {
			count('bundles').matched++;
			continue;
		}
		insBundle(
			b,
			b.id,
			(id) => productMap.get(id)!,
			(id) => freeId(store, 'bundle_lines', id, 'l')
		);
		bundleNames.set(nameKey(b.name), b.id);
		count('bundles').added++;
	}

	const dedupe = new Set<string>();
	for (const r of db
		.prepare('SELECT product_id, completed_at, cancelled_at FROM cycles')
		.all() as Row[]) {
		if (r.completed_at) dedupe.add(`${r.product_id}|c|${r.completed_at}`);
		if (r.cancelled_at) dedupe.add(`${r.product_id}|x|${r.cancelled_at}`);
	}
	const insEvent = eventInserter(store);
	const openEvents = new Map<string, (typeof d.purchaseEvents)[number]>();
	for (const e of d.purchaseEvents) {
		const productId = productMap.get(e.productId)!;
		if (exists(store, 'cycles', e.id)) {
			eventMap.set(e.id, e.id);
			count('purchaseEvents').duplicates++;
			continue;
		}
		if (e.completedAt === null && e.cancelledAt === null) {
			// Open activations only make sense together with their list item (handled below).
			openEvents.set(e.id, e);
			continue;
		}
		const key =
			e.completedAt !== null
				? `${productId}|c|${e.completedAt}`
				: `${productId}|x|${e.cancelledAt}`;
		if (dedupe.has(key)) {
			count('purchaseEvents').duplicates++;
			continue;
		}
		dedupe.add(key);
		const listId = e.listId ? (listMap.get(e.listId) ?? null) : null;
		insEvent(e, productId, listId);
		eventMap.set(e.id, e.id);
		count('purchaseEvents').added++;
	}

	for (const it of d.listItems)
		mergeItem(store, it, listMap, productMap, eventMap, openEvents, count);
	const skippedOpen = [...openEvents.keys()].filter((id) => !eventMap.has(id)).length;
	if (skippedOpen) count('purchaseEvents').skipped += skippedOpen;

	const insRec = recommendationInserter(store);
	for (const r of d.aiRecommendations) {
		const productId = productMap.get(r.productId)!;
		const rec = { ...r, productId };
		const fp = fingerprint(rec);
		if (exists(store, 'ai_recommendations', r.id) || fingerprintExists(store, fp)) {
			count('aiRecommendations').duplicates++;
			continue;
		}
		insRec({ ...rec, fingerprint: fp });
		count('aiRecommendations').added++;
	}
	void report;
}

function mergeItem(
	store: GroceryStore,
	it: ImportItem,
	listMap: Map<string, string>,
	productMap: Map<string, string>,
	eventMap: Map<string, string>,
	openEvents: Map<string, ImportDatasetEvent>,
	count: (k: string) => Counter
) {
	const db = store.db;
	const listId = listMap.get(it.listId)!;
	const productId = productMap.get(it.productId)!;
	const already = db
		.prepare('SELECT id FROM items WHERE list_id = ? AND product_id = ?')
		.get(listId, productId);
	if (already) {
		// The current state of a list on this server wins over the imported one.
		count('listItems').matched++;
		return;
	}
	let cycleId: string | null = null;
	if (it.purchaseEventId) {
		cycleId = eventMap.get(it.purchaseEventId) ?? null;
		const open = openEvents.get(it.purchaseEventId);
		if (!cycleId && open && it.status === 'active') {
			cycleId = freeId(store, 'cycles', open.id, 'c');
			eventInserter(store)(open, productId, listId, cycleId);
			eventMap.set(open.id, cycleId);
			count('purchaseEvents').added++;
		}
	}
	itemInserter(store)(it, freeId(store, 'items', it.id, 'i'), listId, productId, cycleId);
	count('listItems').added++;
}

type ImportDatasetEvent = ImportDataset['purchaseEvents'][number];

// ------------------------------------------------------------------ AI recommendations

export const AI_FORMAT = '8star-ai-recommendations';
export const AI_FORMAT_VERSION = 1;

interface RecInput {
	id: string;
	productId: string;
	suggestedQuantity: number | null;
	suggestedUnit: string | null;
	nextPurchaseAt: number | null;
	confidence: number;
	reasoning: string;
	source: string | null;
	batchId: string;
	status: 'open' | 'accepted' | 'dismissed';
	importedAt: number;
	resolvedAt: number | null;
	fingerprint: string;
}

export function fingerprint(r: {
	productId: string;
	suggestedQuantity: number | null;
	suggestedUnit: string | null;
	nextPurchaseAt: number | null;
	reasoning: string;
}): string {
	const day =
		r.nextPurchaseAt === null ? '' : new Date(r.nextPurchaseAt).toISOString().slice(0, 10);
	return createHash('sha256')
		.update(
			[r.productId, r.suggestedQuantity ?? '', r.suggestedUnit ?? '', day, r.reasoning.trim()].join(
				'\u0000'
			)
		)
		.digest('hex')
		.slice(0, 32);
}

function fingerprintExists(store: GroceryStore, fp: string): boolean {
	return !!store.db.prepare('SELECT 1 FROM ai_recommendations WHERE fingerprint = ?').get(fp);
}

function recommendationInserter(store: GroceryStore) {
	const stmt = store.db.prepare(
		`INSERT INTO ai_recommendations (id, product_id, suggested_quantity, suggested_unit, next_purchase_at,
			confidence, reasoning, source, batch_id, fingerprint, status, imported_at, resolved_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	return (r: RecInput) =>
		stmt.run(
			r.id,
			r.productId,
			r.suggestedQuantity,
			r.suggestedUnit,
			r.nextPurchaseAt,
			r.confidence,
			r.reasoning,
			r.source,
			r.batchId,
			r.fingerprint,
			r.status,
			r.importedAt,
			r.resolvedAt
		);
}

function prepareAiImport(
	store: GroceryStore,
	input: unknown,
	count: (k: string) => Counter,
	report: ImportReport,
	now: number,
	t: Messages
): () => void {
	const file = input as Record<string, unknown> | null;
	if (!file || typeof file !== 'object' || Array.isArray(file))
		throw new ImportRejected(t.import.notObject);
	if (file.format !== AI_FORMAT) throw new ImportRejected(t.import.notAiFile(AI_FORMAT));
	if (file.formatVersion !== AI_FORMAT_VERSION)
		throw new ImportRejected(t.import.aiVersion(String(file.formatVersion), AI_FORMAT_VERSION));
	if (!Array.isArray(file.recommendations) || !file.recommendations.length)
		throw new ImportRejected(t.import.recommendationsEmpty);
	if (file.recommendations.length > 1000)
		throw new ImportRejected(t.import.tooManyRecommendations(1000));
	const source =
		typeof file.source === 'string' && file.source.trim() ? file.source.trim().slice(0, 80) : null;
	const batchId = newId('batch');

	const products = new Map(
		(store.db.prepare('SELECT id, name FROM products').all() as { id: string; name: string }[]).map(
			(p) => [p.id, p.name]
		)
	);
	const valid = new Map<string, RecInput>();
	file.recommendations.forEach((raw: unknown, i: number) => {
		const ai = t.import.ai;
		const at = ai.at(i + 1);
		const r = raw as Record<string, unknown>;
		if (!r || typeof r !== 'object') return report.warnings.push(ai.notObject(at));
		const productId = r.productId;
		if (typeof productId !== 'string' || !ID_RE.test(productId))
			return report.warnings.push(ai.badProductId(at));
		const name = products.get(productId);
		if (!name) return report.warnings.push(ai.unknownProduct(at, productId));
		if (typeof r.productName === 'string' && nameKey(r.productName) !== nameKey(name))
			report.warnings.push(ai.nameMismatch(at, r.productName, productId, name));
		const confidence = r.confidence;
		if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1))
			return report.warnings.push(ai.confidence(`${at} (${name})`));
		const reasoning = typeof r.reasoning === 'string' ? r.reasoning.trim() : '';
		if (!reasoning || reasoning.length > 1000)
			return report.warnings.push(ai.reasoning(`${at} (${name})`, 1000));
		let quantity: number | null = null;
		if (r.suggestedQuantity !== undefined && r.suggestedQuantity !== null) {
			if (
				typeof r.suggestedQuantity !== 'number' ||
				!(r.suggestedQuantity > 0 && r.suggestedQuantity < 100000)
			)
				return report.warnings.push(ai.quantity(`${at} (${name})`));
			quantity = Math.round(r.suggestedQuantity * 1000) / 1000;
		}
		let unit: string | null = null;
		if (r.unit !== undefined && r.unit !== null && r.unit !== '') {
			unit = typeof r.unit === 'string' ? normaliseUnit(r.unit) : null;
			if (!unit) return report.warnings.push(ai.unit(`${at} (${name})`, String(r.unit)));
			if (unit === 'stuks') unit = null;
		}
		let next: number | null = null;
		if (
			r.nextPurchaseDate !== undefined &&
			r.nextPurchaseDate !== null &&
			r.nextPurchaseDate !== ''
		) {
			next = parseTimestamp(r.nextPurchaseDate);
			if (next === null) return report.warnings.push(ai.date(`${at} (${name})`));
		}
		if (valid.has(productId)) report.warnings.push(ai.repeated(`${at} (${name})`));
		const rec = {
			id: newId('ai'),
			productId,
			suggestedQuantity: quantity,
			suggestedUnit: quantity === null ? null : unit,
			nextPurchaseAt: next,
			confidence: Math.round(confidence * 1000) / 1000,
			reasoning,
			source,
			batchId,
			status: 'open' as const,
			importedAt: now,
			resolvedAt: null
		};
		valid.set(productId, { ...rec, fingerprint: fingerprint(rec) });
	});
	const invalid = file.recommendations.length - [...valid.values()].length;
	if (!valid.size) {
		report.errors.push(...report.warnings.splice(0));
		throw new ImportRejected(t.import.ai.noneValid);
	}

	return () => {
		const insert = recommendationInserter(store);
		const c = count('aiRecommendations');
		c.skipped = invalid;
		for (const rec of valid.values()) {
			if (fingerprintExists(store, rec.fingerprint)) {
				c.duplicates++;
				continue;
			}
			// One open suggestion per product: a newer one replaces the older.
			const open = store.db
				.prepare("SELECT id FROM ai_recommendations WHERE product_id = ? AND status = 'open'")
				.get(rec.productId) as { id: string } | undefined;
			if (open) {
				store.db
					.prepare(
						`UPDATE ai_recommendations SET suggested_quantity = ?, suggested_unit = ?, next_purchase_at = ?,
							confidence = ?, reasoning = ?, source = ?, batch_id = ?, fingerprint = ?, imported_at = ?,
							version = version + 1 WHERE id = ?`
					)
					.run(
						rec.suggestedQuantity,
						rec.suggestedUnit,
						rec.nextPurchaseAt,
						rec.confidence,
						rec.reasoning,
						rec.source,
						rec.batchId,
						rec.fingerprint,
						rec.importedAt,
						open.id
					);
				c.updated++;
				continue;
			}
			insert(rec);
			c.added++;
		}
	};
}

// ------------------------------------------------------------------ CSV

const TRUE_WORDS = new Set(['ja', 'j', 'yes', 'y', 'true', '1', 'x', 'waar']);

function csvNumber(raw: string): number | null | undefined {
	if (!raw) return null;
	const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
	return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 1000) / 1000 : undefined;
}

/** ISO 8601, `YYYY-MM-DD[ HH:mm[:ss]]` or Dutch `DD-MM-YYYY[ HH:mm]` (local server time). */
export function parseCsvDate(raw: string): number | null {
	const s = raw.trim();
	if (!s) return null;
	const local = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): number | null => {
		const date = new Date(y, m - 1, d, hh, mm, ss);
		// Reject roll-overs such as 2026-13-45 or 31-02-2026.
		const ok =
			date.getFullYear() === y &&
			date.getMonth() === m - 1 &&
			date.getDate() === d &&
			hh < 24 &&
			mm < 60 &&
			ss < 60;
		return ok ? date.getTime() : null;
	};
	const nl = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
	if (nl) {
		const [, d, m, y, hh = '0', mm = '0', ss = '0'] = nl;
		return local(+y, +m, +d, +hh, +mm, +ss);
	}
	const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
	if (iso) {
		const [, y, m, d, hh, mm, ss = '0'] = iso;
		// A date without time is treated as midday, so time zones never shift the day.
		return hh === undefined ? local(+y, +m, +d, 12) : local(+y, +m, +d, +hh, +mm, +ss);
	}
	const t = parseTimestamp(s);
	return t !== null && t > 0 ? t : null;
}

/** Resolves (or creates) categories by name for CSV imports. */
function categoryResolver(store: GroceryStore, count: (k: string) => Counter, now: number) {
	const byName = nameIndex(store, 'categories');
	return (name: string): string | null => {
		const clean = cleanName(name);
		if (!clean) return null;
		const found = byName.get(nameKey(clean));
		if (found) return found;
		const id = newId('cat');
		store.db
			.prepare(
				'INSERT INTO categories (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
			)
			.run(
				id,
				capitaliseFirst(clean.slice(0, MAX_NAME_LENGTH)),
				nextPosition(store, 'categories'),
				now,
				now
			);
		byName.set(nameKey(clean), id);
		count('categories').added++;
		return id;
	};
}

function prepareProductsCsv(
	store: GroceryStore,
	text: string,
	count: (k: string) => Counter,
	report: ImportReport,
	now: number,
	t: Messages
): () => void {
	const table = readCsvTable(text);
	if (!hasColumn(table, 'product', 'naam', 'name'))
		throw new ImportRejected(t.import.csv.productColumnHeader);
	const rows: {
		line: number;
		id: string | null;
		name: string;
		category: string;
		favorite: boolean | null;
	}[] = [];
	for (const r of table.records) {
		const name = cleanName(pick(r.values, 'product', 'naam', 'name'));
		if (!name || name.length > MAX_NAME_LENGTH) {
			report.errors.push(t.import.csv.line(r.line, t.import.csv.badName));
			continue;
		}
		const id = pick(r.values, 'product_id', 'id') || null;
		if (id && !ID_RE.test(id)) {
			report.errors.push(t.import.csv.line(r.line, t.import.csv.badProductId(id)));
			continue;
		}
		const fav = pick(r.values, 'favoriet', 'favorite');
		rows.push({
			line: r.line,
			id,
			name,
			category: pick(r.values, 'categorie', 'category'),
			favorite: fav ? TRUE_WORDS.has(fav.toLowerCase()) : null
		});
	}
	if (report.errors.length)
		throw new ImportRejected(t.import.csv.invalidLines(report.errors.length));
	if (!rows.length) throw new ImportRejected(t.import.csv.noProducts);

	return () => {
		const db = store.db;
		const category = categoryResolver(store, count, now);
		const byName = nameIndex(store, 'products');
		const seen = new Set<string>();
		const c = count('products');
		for (const r of rows) {
			const key = nameKey(r.name);
			if (seen.has(key)) {
				c.duplicates++;
				continue;
			}
			seen.add(key);
			const target = (r.id && exists(store, 'products', r.id) ? r.id : null) ?? byName.get(key);
			if (target) {
				const current = exists(store, 'products', target)!;
				const cat =
					(current.category_id as string | null) ?? (r.category ? category(r.category) : null);
				const fav = current.favorite === 1 || r.favorite === true;
				if (cat !== current.category_id || fav !== (current.favorite === 1)) {
					db.prepare(
						'UPDATE products SET category_id = ?, favorite = ?, version = version + 1, updated_at = ? WHERE id = ?'
					).run(cat, fav ? 1 : 0, now, target);
					c.updated++;
				} else c.matched++;
				continue;
			}
			const id = r.id ?? newId('p');
			const name = capitaliseFirst(r.name);
			db.prepare(
				'INSERT INTO products (id, name, name_key, category_id, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
			).run(id, name, key, r.category ? category(r.category) : null, r.favorite ? 1 : 0, now, now);
			byName.set(key, id);
			c.added++;
		}
	};
}

const DUPLICATE_WINDOW_MS = 60_000;

function preparePurchasesCsv(
	store: GroceryStore,
	text: string,
	count: (k: string) => Counter,
	report: ImportReport,
	now: number,
	t: Messages
): () => void {
	const c = t.import.csv;
	const table = readCsvTable(text);
	if (!hasColumn(table, 'product', 'naam', 'name')) throw new ImportRejected(c.productColumn);
	if (!hasColumn(table, 'gekocht', 'purchased_at', 'completed_at', 'datum', 'date'))
		throw new ImportRejected(c.purchasedColumn);

	interface PurchaseRow {
		line: number;
		id: string | null;
		productId: string | null;
		name: string;
		category: string;
		list: string;
		status: 'purchased' | 'cancelled';
		activatedAt: number;
		completedAt: number | null;
		cancelledAt: number | null;
		quantity: number | null;
		unit: string | null;
	}
	const rows: PurchaseRow[] = [];
	let skippedOpen = 0;
	for (const r of table.records) {
		const v = r.values;
		const err = (m: string) => report.errors.push(c.line(r.line, m));
		const name = cleanName(pick(v, 'product', 'naam', 'name'));
		if (!name || name.length > MAX_NAME_LENGTH) {
			err(c.badName);
			continue;
		}
		const statusRaw = pick(v, 'status').toLowerCase();
		if (['open', 'active', 'actief'].includes(statusRaw)) {
			skippedOpen++;
			continue;
		}
		const cancelled = ['geannuleerd', 'cancelled', 'canceled'].includes(statusRaw);
		if (
			statusRaw &&
			!cancelled &&
			!['gekocht', 'purchased', 'completed', 'bought'].includes(statusRaw)
		) {
			err(c.badStatus(statusRaw));
			continue;
		}
		const completedRaw = pick(v, 'gekocht', 'purchased_at', 'completed_at', 'datum', 'date');
		const cancelledRaw = pick(v, 'geannuleerd', 'cancelled_at');
		const when = parseCsvDate(cancelled ? cancelledRaw || completedRaw : completedRaw);
		if (when === null) {
			err(c.badDate(cancelled ? cancelledRaw : completedRaw));
			continue;
		}
		const activatedRaw = pick(v, 'geactiveerd', 'activated_at', 'toegevoegd');
		const activated = activatedRaw ? parseCsvDate(activatedRaw) : when;
		if (activated === null) {
			err(c.badActivated(activatedRaw));
			continue;
		}
		const quantity = csvNumber(pick(v, 'aantal', 'quantity'));
		if (quantity === undefined) {
			err(c.badQuantity(pick(v, 'aantal', 'quantity')));
			continue;
		}
		const unitRaw = pick(v, 'eenheid', 'unit');
		const unit = unitRaw ? normaliseUnit(unitRaw) : null;
		if (unitRaw && !unit) {
			err(c.badUnit(unitRaw));
			continue;
		}
		const id = pick(v, 'purchase_id', 'aankoop_id', 'id') || null;
		const productId = pick(v, 'product_id') || null;
		if ((id && !ID_RE.test(id)) || (productId && !ID_RE.test(productId))) {
			err(c.badId);
			continue;
		}
		rows.push({
			line: r.line,
			id,
			productId,
			name,
			category: pick(v, 'categorie', 'category'),
			list: pick(v, 'lijst', 'list'),
			status: cancelled ? 'cancelled' : 'purchased',
			activatedAt: Math.min(activated, when),
			completedAt: cancelled ? null : when,
			cancelledAt: cancelled ? when : null,
			quantity,
			unit: unit === 'stuks' ? null : unit
		});
	}
	if (report.errors.length) throw new ImportRejected(c.invalidLines(report.errors.length));
	if (!rows.length && !skippedOpen) throw new ImportRejected(c.noPurchases);
	if (skippedOpen) report.warnings.push(c.skippedOpen(skippedOpen));

	return () => {
		const db = store.db;
		const category = categoryResolver(store, count, now);
		const products = nameIndex(store, 'products');
		const lists = nameIndex(store, 'lists');
		const events = count('purchaseEvents');
		events.skipped += skippedOpen;
		const unknownLists = new Set<string>();
		const existingTimes = new Map<string, number[]>();
		const timesFor = (productId: string) => {
			let arr = existingTimes.get(productId);
			if (!arr) {
				arr = (
					db
						.prepare(
							'SELECT COALESCE(completed_at, cancelled_at) AS t FROM cycles WHERE product_id = ? AND t IS NOT NULL'
						)
						.all(productId) as { t: number }[]
				).map((x) => x.t);
				existingTimes.set(productId, arr);
			}
			return arr;
		};
		for (const r of rows) {
			let productId =
				(r.productId && exists(store, 'products', r.productId) ? r.productId : null) ??
				products.get(nameKey(r.name)) ??
				null;
			if (!productId) {
				productId = r.productId ?? newId('p');
				db.prepare(
					'INSERT INTO products (id, name, name_key, category_id, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
				).run(
					productId,
					capitaliseFirst(r.name),
					nameKey(r.name),
					r.category ? category(r.category) : null,
					r.activatedAt,
					now
				);
				products.set(nameKey(r.name), productId);
				count('products').added++;
			}
			if (r.id && exists(store, 'cycles', r.id)) {
				events.duplicates++;
				continue;
			}
			const when = (r.completedAt ?? r.cancelledAt)!;
			const times = timesFor(productId);
			if (times.some((t) => Math.abs(t - when) < DUPLICATE_WINDOW_MS)) {
				events.duplicates++;
				continue;
			}
			times.push(when);
			let listId: string | null = null;
			if (r.list) {
				listId = (exists(store, 'lists', r.list) ? r.list : lists.get(nameKey(r.list))) ?? null;
				if (!listId) unknownLists.add(r.list);
			}
			db.prepare(
				'INSERT INTO cycles (id, product_id, list_id, activated_at, completed_at, cancelled_at, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
			).run(
				r.id ?? newId('c'),
				productId,
				listId,
				r.activatedAt,
				r.completedAt,
				r.cancelledAt,
				r.quantity,
				r.unit
			);
			events.added++;
		}
		if (unknownLists.size)
			report.warnings.push(c.unknownLists([...unknownLists].map((l) => `"${l}"`).join(', ')));
	};
}
