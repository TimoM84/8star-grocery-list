/**
 * Imports: full JSON restore (replace), JSON merge, CSV products, CSV purchase history and AI
 * recommendations. Every import runs in one SQLite transaction; a preview runs the exact same
 * code and then rolls back, so the preview always matches the real result.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { GroceryStore } from '../store';
import { createBackupSync } from '../backup';
import {
	parseExportFile,
	parseTimestamp,
	Validator,
	type ImportDataset,
	type ImportItem
} from './format';
import { CsvError, hasColumn, pick, readCsvTable } from './csv';
import { normaliseUnit } from '$lib/shared/quantity';
import { capitaliseFirst, cleanName, MAX_NAME_LENGTH, nameKey } from '$lib/shared/text';

import type { Counter, ImportKind, ImportMode, ImportReport } from '$lib/shared/transfer';

export type { Counter, ImportKind, ImportMode, ImportReport };

export interface ImportOptions {
	kind: ImportKind;
	mode: ImportMode;
	text: string;
	preview: boolean;
	backupDir: string;
	now?: number;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const newId = (prefix: string) => `${prefix}-${randomBytes(9).toString('base64url')}`;

class PreviewRollback extends Error {}
class ImportRejected extends Error {}

const LABELS: Record<string, [string, string]> = {
	lists: ['lijst', 'lijsten'],
	categories: ['categorie', 'categorieën'],
	products: ['product', 'producten'],
	listItems: ['item op een lijst', 'items op lijsten'],
	purchaseEvents: ['aankoop', 'aankopen'],
	aiRecommendations: ['AI-suggestie', 'AI-suggesties']
};

function counter(): Counter {
	return { added: 0, matched: 0, updated: 0, duplicates: 0, skipped: 0, removed: 0 };
}

function summarise(report: ImportReport) {
	const lines: string[] = [];
	const n = (count: number, key: string) => {
		const [one, many] = LABELS[key] ?? [key, key];
		return `${count} ${count === 1 ? one : many}`;
	};
	const verb = report.preview ? (s: string) => `wordt ${s}` : (s: string) => s;
	const verbMany = report.preview ? (s: string) => `worden ${s}` : (s: string) => s;
	for (const [key, c] of Object.entries(report.counts)) {
		const parts: string[] = [];
		const v = (count: number, single: string, plural: string) =>
			parts.push(`${n(count, key)} ${count === 1 ? verb(single) : verbMany(plural)}`);
		if (c.removed) v(c.removed, 'verwijderd', 'verwijderd');
		if (c.added) v(c.added, 'toegevoegd', 'toegevoegd');
		if (c.updated) v(c.updated, 'bijgewerkt', 'bijgewerkt');
		if (c.matched) parts.push(`${n(c.matched, key)} al aanwezig`);
		if (c.duplicates) parts.push(`${c.duplicates} dubbel (overgeslagen)`);
		if (c.skipped) parts.push(`${c.skipped} overgeslagen`);
		if (parts.length) lines.push(parts.join(', '));
	}
	if (!lines.length) lines.push('Geen wijzigingen: alles stond er al in.');
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

	try {
		// Parse and validate everything before touching the database.
		let apply: () => void;
		if (kind === 'json' || kind === 'ai') {
			let parsed: unknown;
			try {
				parsed = JSON.parse(options.text.replace(/^\ufeff/, ''));
			} catch {
				throw new ImportRejected('Het bestand is geen geldige JSON.');
			}
			if (kind === 'json') {
				const v = new Validator();
				const data = parseExportFile(parsed, v);
				report.warnings.push(...v.warnings);
				if (v.errors.length) {
					report.errors.push(...v.errors);
					throw new ImportRejected('');
				}
				if (mode === 'replace' && !data.lists.length)
					throw new ImportRejected('Een volledige vervanging heeft minstens één lijst nodig.');
				apply = () =>
					mode === 'replace'
						? replaceAll(store, data, count, now)
						: mergeDataset(store, data, count, report, now);
			} else {
				apply = prepareAiImport(store, parsed, count, report, now);
			}
		} else {
			apply =
				kind === 'products-csv'
					? prepareProductsCsv(store, options.text, count, report, now)
					: preparePurchasesCsv(store, options.text, count, report, now);
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
		if (e instanceof ImportRejected || e instanceof CsvError) {
			if (e.message) report.errors.unshift(e.message);
		} else {
			console.error('[8star] import failed', e);
			report.errors.unshift(
				'De import is mislukt en volledig teruggedraaid: ' +
					((e as Error).message ?? 'onbekende fout')
			);
		}
		report.ok = false;
	}
	if (report.ok) summarise(report);
	else report.summary = ['Er is niets gewijzigd.'];
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

	db.exec(`DELETE FROM items; DELETE FROM cycles; DELETE FROM ai_recommendations;
		DELETE FROM products; DELETE FROM categories; DELETE FROM lists;`);

	const insList = (table: 'lists' | 'categories') =>
		db.prepare(
			`INSERT INTO ${table} (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
		);
	for (const l of d.lists) insList('lists').run(l.id, l.name, l.position, l.createdAt, l.updatedAt);
	for (const c of d.categories)
		insList('categories').run(c.id, c.name, c.position, c.createdAt, c.updatedAt);
	const insProduct = db.prepare(
		'INSERT INTO products (id, name, name_key, category_id, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
	);
	for (const p of d.products)
		insProduct.run(
			p.id,
			p.name,
			nameKey(p.name),
			p.categoryId,
			p.favorite ? 1 : 0,
			p.createdAt,
			p.updatedAt
		);
	const insEvent = db.prepare(
		'INSERT INTO cycles (id, product_id, list_id, activated_at, completed_at, cancelled_at, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	);
	for (const e of d.purchaseEvents)
		insEvent.run(
			e.id,
			e.productId,
			e.listId,
			e.activatedAt,
			e.completedAt,
			e.cancelledAt,
			e.quantity,
			e.unit
		);
	const insItem = db.prepare(
		`INSERT INTO items (id, list_id, product_id, quantity, unit, status, activated_at, completed_at, cycle_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const i of d.listItems)
		insItem.run(
			i.id,
			i.listId,
			i.productId,
			i.quantity,
			i.unit,
			i.status,
			i.activatedAt,
			i.completedAt,
			i.purchaseEventId,
			i.createdAt,
			i.updatedAt
		);
	const insRec = recommendationInserter(store);
	for (const r of d.aiRecommendations) insRec({ ...r, fingerprint: fingerprint(r) });

	count('lists').added = d.lists.length;
	count('categories').added = d.categories.length;
	count('products').added = d.products.length;
	count('listItems').added = d.listItems.length;
	count('purchaseEvents').added = d.purchaseEvents.length;
	count('aiRecommendations').added = d.aiRecommendations.length;

	store.markDatasetReplaced(now);
}

// ------------------------------------------------------------------ merge

interface Row {
	[k: string]: unknown;
}

function nameIndex(store: GroceryStore, table: 'lists' | 'categories' | 'products') {
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
			byName.set(nameKey(r.name), r.id);
			map.set(r.id, r.id);
			count(key).added++;
		}
	}

	const productsByName = nameIndex(store, 'products');
	for (const p of d.products) {
		const categoryId = p.categoryId ? (catMap.get(p.categoryId) ?? null) : null;
		const target = exists(store, 'products', p.id) ? p.id : productsByName.get(nameKey(p.name));
		if (target) {
			productMap.set(p.id, target);
			const current = exists(store, 'products', target)!;
			const fav = current.favorite === 1 || p.favorite;
			const cat = (current.category_id as string | null) ?? categoryId;
			if (fav !== (current.favorite === 1) || cat !== current.category_id) {
				db.prepare(
					'UPDATE products SET favorite = ?, category_id = ?, version = version + 1, updated_at = ? WHERE id = ?'
				).run(fav ? 1 : 0, cat, now, target);
				count('products').updated++;
			} else count('products').matched++;
			continue;
		}
		db.prepare(
			'INSERT INTO products (id, name, name_key, category_id, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
		).run(p.id, p.name, nameKey(p.name), categoryId, p.favorite ? 1 : 0, p.createdAt, p.updatedAt);
		productsByName.set(nameKey(p.name), p.id);
		productMap.set(p.id, p.id);
		count('products').added++;
	}

	const dedupe = new Set<string>();
	for (const r of db
		.prepare('SELECT product_id, completed_at, cancelled_at FROM cycles')
		.all() as Row[]) {
		if (r.completed_at) dedupe.add(`${r.product_id}|c|${r.completed_at}`);
		if (r.cancelled_at) dedupe.add(`${r.product_id}|x|${r.cancelled_at}`);
	}
	const insEvent = db.prepare(
		'INSERT INTO cycles (id, product_id, list_id, activated_at, completed_at, cancelled_at, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	);
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
		insEvent.run(
			e.id,
			productId,
			listId,
			e.activatedAt,
			e.completedAt,
			e.cancelledAt,
			e.quantity,
			e.unit
		);
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
			db.prepare(
				'INSERT INTO cycles (id, product_id, list_id, activated_at, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)'
			).run(cycleId, productId, listId, open.activatedAt, open.quantity, open.unit);
			eventMap.set(open.id, cycleId);
			count('purchaseEvents').added++;
		}
	}
	db.prepare(
		`INSERT INTO items (id, list_id, product_id, quantity, unit, status, activated_at, completed_at, cycle_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		freeId(store, 'items', it.id, 'i'),
		listId,
		productId,
		it.quantity,
		it.unit,
		it.status,
		it.activatedAt,
		it.completedAt,
		cycleId,
		it.createdAt,
		it.updatedAt
	);
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
	now: number
): () => void {
	const file = input as Record<string, unknown> | null;
	if (!file || typeof file !== 'object' || Array.isArray(file))
		throw new ImportRejected('Het bestand moet een JSON-object zijn.');
	if (file.format !== AI_FORMAT)
		throw new ImportRejected(`Geen AI-suggestiebestand: verwacht "format": "${AI_FORMAT}".`);
	if (file.formatVersion !== AI_FORMAT_VERSION)
		throw new ImportRejected(
			`formatVersion ${String(file.formatVersion)} wordt niet ondersteund (verwacht ${AI_FORMAT_VERSION}).`
		);
	if (!Array.isArray(file.recommendations) || !file.recommendations.length)
		throw new ImportRejected('"recommendations" moet een niet-lege lijst zijn.');
	if (file.recommendations.length > 1000)
		throw new ImportRejected('Maximaal 1000 suggesties per bestand.');
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
		const at = `Suggestie ${i + 1}`;
		const r = raw as Record<string, unknown>;
		if (!r || typeof r !== 'object')
			return report.warnings.push(`${at}: geen object, overgeslagen.`);
		const productId = r.productId;
		if (typeof productId !== 'string' || !ID_RE.test(productId))
			return report.warnings.push(`${at}: "productId" ontbreekt of is ongeldig, overgeslagen.`);
		const name = products.get(productId);
		if (!name)
			return report.warnings.push(`${at}: product "${productId}" bestaat niet, overgeslagen.`);
		if (typeof r.productName === 'string' && nameKey(r.productName) !== nameKey(name))
			report.warnings.push(
				`${at}: productName "${r.productName}" hoort niet bij ${productId} ("${name}"); de id is gebruikt.`
			);
		const confidence = r.confidence;
		if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1))
			return report.warnings.push(
				`${at} (${name}): "confidence" moet een getal tussen 0 en 1 zijn, overgeslagen.`
			);
		const reasoning = typeof r.reasoning === 'string' ? r.reasoning.trim() : '';
		if (!reasoning || reasoning.length > 1000)
			return report.warnings.push(
				`${at} (${name}): "reasoning" ontbreekt of is langer dan 1000 tekens, overgeslagen.`
			);
		let quantity: number | null = null;
		if (r.suggestedQuantity !== undefined && r.suggestedQuantity !== null) {
			if (
				typeof r.suggestedQuantity !== 'number' ||
				!(r.suggestedQuantity > 0 && r.suggestedQuantity < 100000)
			)
				return report.warnings.push(
					`${at} (${name}): "suggestedQuantity" moet een getal groter dan 0 zijn, overgeslagen.`
				);
			quantity = Math.round(r.suggestedQuantity * 1000) / 1000;
		}
		let unit: string | null = null;
		if (r.unit !== undefined && r.unit !== null && r.unit !== '') {
			unit = typeof r.unit === 'string' ? normaliseUnit(r.unit) : null;
			if (!unit)
				return report.warnings.push(
					`${at} (${name}): onbekende eenheid "${String(r.unit)}", overgeslagen.`
				);
			if (unit === 'stuks') unit = null;
		}
		let next: number | null = null;
		if (
			r.nextPurchaseDate !== undefined &&
			r.nextPurchaseDate !== null &&
			r.nextPurchaseDate !== ''
		) {
			next = parseTimestamp(r.nextPurchaseDate);
			if (next === null)
				return report.warnings.push(
					`${at} (${name}): "nextPurchaseDate" is geen ISO 8601-datum, overgeslagen.`
				);
		}
		if (valid.has(productId))
			report.warnings.push(
				`${at} (${name}): staat meerdere keren in het bestand; de laatste telt.`
			);
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
		throw new ImportRejected('Geen enkele geldige suggestie gevonden.');
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
	now: number
): () => void {
	const table = readCsvTable(text);
	if (!hasColumn(table, 'product', 'naam', 'name'))
		throw new ImportRejected(
			'Kolom "product" ontbreekt (eerste regel moet de kolomnamen bevatten).'
		);
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
			report.errors.push(`Regel ${r.line}: productnaam ontbreekt of is te lang.`);
			continue;
		}
		const id = pick(r.values, 'product_id', 'id') || null;
		if (id && !ID_RE.test(id)) {
			report.errors.push(`Regel ${r.line}: ongeldige product_id "${id}".`);
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
		throw new ImportRejected(
			`${report.errors.length} ongeldige regel(s); er is niets geïmporteerd.`
		);
	if (!rows.length) throw new ImportRejected('Het bestand bevat geen producten.');

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
	now: number
): () => void {
	const table = readCsvTable(text);
	if (!hasColumn(table, 'product', 'naam', 'name'))
		throw new ImportRejected('Kolom "product" ontbreekt.');
	if (!hasColumn(table, 'gekocht', 'purchased_at', 'completed_at', 'datum', 'date'))
		throw new ImportRejected('Kolom "gekocht" (aankoopmoment) ontbreekt.');

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
		const err = (m: string) => report.errors.push(`Regel ${r.line}: ${m}`);
		const name = cleanName(pick(v, 'product', 'naam', 'name'));
		if (!name || name.length > MAX_NAME_LENGTH) {
			err('productnaam ontbreekt of is te lang.');
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
			err(`onbekende status "${statusRaw}" (gekocht, geannuleerd of open).`);
			continue;
		}
		const completedRaw = pick(v, 'gekocht', 'purchased_at', 'completed_at', 'datum', 'date');
		const cancelledRaw = pick(v, 'geannuleerd', 'cancelled_at');
		const when = parseCsvDate(cancelled ? cancelledRaw || completedRaw : completedRaw);
		if (when === null) {
			err(
				`ongeldige of ontbrekende datum "${cancelled ? cancelledRaw : completedRaw}" (gebruik bijv. 2026-10-24T18:30:00Z of 24-10-2026 18:30).`
			);
			continue;
		}
		const activatedRaw = pick(v, 'geactiveerd', 'activated_at', 'toegevoegd');
		const activated = activatedRaw ? parseCsvDate(activatedRaw) : when;
		if (activated === null) {
			err(`ongeldige datum "${activatedRaw}" in kolom geactiveerd.`);
			continue;
		}
		const quantity = csvNumber(pick(v, 'aantal', 'quantity'));
		if (quantity === undefined) {
			err(`ongeldig aantal "${pick(v, 'aantal', 'quantity')}".`);
			continue;
		}
		const unitRaw = pick(v, 'eenheid', 'unit');
		const unit = unitRaw ? normaliseUnit(unitRaw) : null;
		if (unitRaw && !unit) {
			err(`onbekende eenheid "${unitRaw}".`);
			continue;
		}
		const id = pick(v, 'purchase_id', 'aankoop_id', 'id') || null;
		const productId = pick(v, 'product_id') || null;
		if ((id && !ID_RE.test(id)) || (productId && !ID_RE.test(productId))) {
			err('ongeldige id.');
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
	if (report.errors.length)
		throw new ImportRejected(
			`${report.errors.length} ongeldige regel(s); er is niets geïmporteerd.`
		);
	if (!rows.length && !skippedOpen) throw new ImportRejected('Het bestand bevat geen aankopen.');
	if (skippedOpen)
		report.warnings.push(
			`${skippedOpen} regel(s) met status "open" overgeslagen (dat zijn geen aankopen).`
		);

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
			report.warnings.push(
				`Onbekende lijst(en) ${[...unknownLists].map((l) => `"${l}"`).join(', ')}: aankopen zonder lijst bewaard.`
			);
	};
}
