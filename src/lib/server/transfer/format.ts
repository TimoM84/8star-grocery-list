/**
 * Versioned export/import formats. See docs/IMPORT-EXPORT.md.
 *
 * Export format 2 (v1.2) contains every meaningful record with its stable id, relationships
 * and ISO 8601 timestamps: lists (with kind and walking route), categories, products (with
 * memory, note, photo reference and stock status), aliases, list items (with notes and
 * statuses), purchase events, bundles, AI recommendations and photo metadata. Derived
 * statistics are included for analysis but ignored on import. Format 1 files (v1.1) and the
 * v1.0 export are still accepted; missing fields get safe defaults. Since v1.3 format 2 also
 * carries the household settings (`data.settings`, optional on import).
 *
 * Deliberately not exported (temporary): shopping rounds, participants, claims, device names
 * and "Niet nu" snoozes.
 */

import type { DB } from '../db';
import { schemaVersion } from '../db';
import { computeStats } from '$lib/shared/stats';
import { UNITS } from '$lib/shared/quantity';
import { cleanName, nameKey, MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '$lib/shared/text';
import type { Settings } from '$lib/shared/settings';
import { readSettings } from '../settings';
import {
	DEFAULT_LANGUAGE,
	LANGUAGES,
	isLanguage,
	messagesFor,
	type Messages
} from '$lib/shared/i18n';

export const EXPORT_FORMAT = '8star-grocery-export';
export const EXPORT_FORMAT_VERSION = 2;

export interface ExportCategory {
	id: string;
	name: string;
	position: number;
	createdAt: string;
	updatedAt: string;
}
export interface ExportList extends ExportCategory {
	kind: 'grocery' | 'checklist';
	kindChangedAt: string | null;
	categoryOrder: string[] | null;
}

export interface ExportProduct {
	id: string;
	name: string;
	categoryId: string | null;
	favorite: boolean;
	createdAt: string;
	updatedAt: string;
	defaultQuantity: number | null;
	defaultUnit: string | null;
	preferredListId: string | null;
	note: string | null;
	photoId: string | null;
	stockStatus: 'unknown' | 'enough' | 'low' | 'out';
	stockUpdatedAt: string | null;
}

export interface ExportAlias {
	id: string;
	productId: string;
	alias: string;
	createdAt: string;
}

export interface ExportBundle {
	id: string;
	name: string;
	servings: number | null;
	createdAt: string;
	updatedAt: string;
	lines: {
		id: string;
		productId: string;
		quantity: number | null;
		unit: string | null;
		note: string | null;
	}[];
}

/** Photo metadata. The bytes are only in the full backup ZIP (`media/<file>`). */
export interface ExportMedia {
	id: string;
	mime: string;
	width: number;
	height: number;
	bytes: number;
	sha256: string;
	createdAt: string;
	file: string;
}

export type PurchaseEventStatus = 'purchased' | 'cancelled' | 'open';

/** One activation of a product on a list and its outcome (purchase or cancellation). */
export interface ExportPurchaseEvent {
	id: string;
	productId: string;
	listId: string | null;
	status: PurchaseEventStatus;
	activatedAt: string;
	completedAt: string | null;
	cancelledAt: string | null;
	quantity: number | null;
	unit: string | null;
	/** What was asked for (format 2). */
	requestedQuantity: number | null;
	/** What was actually bought, including partial purchases (format 2). */
	purchasedQuantity: number | null;
}

export interface ExportListItem {
	id: string;
	listId: string;
	productId: string;
	status: 'active' | 'completed';
	quantity: number | null;
	unit: string | null;
	activatedAt: string;
	completedAt: string | null;
	purchaseEventId: string | null;
	createdAt: string;
	updatedAt: string;
	note: string | null;
	substituteOk: boolean;
	substituteNote: string | null;
	unavailableAt: string | null;
	position: number;
}

export interface ExportAiRecommendation {
	id: string;
	productId: string;
	suggestedQuantity: number | null;
	suggestedUnit: string | null;
	nextPurchaseAt: string | null;
	confidence: number;
	reasoning: string;
	source: string | null;
	batchId: string;
	status: 'open' | 'accepted' | 'dismissed';
	importedAt: string;
	resolvedAt: string | null;
}

export interface ExportData {
	lists: ExportList[];
	categories: ExportCategory[];
	products: ExportProduct[];
	listItems: ExportListItem[];
	purchaseEvents: ExportPurchaseEvent[];
	aiRecommendations: ExportAiRecommendation[];
	productAliases: ExportAlias[];
	bundles: ExportBundle[];
	media: ExportMedia[];
	/**
	 * Household settings (v1.3; `suggestionsEnabled` and `bulkAddEnabled` since v1.5, before that
	 * `aiEnabled`). Optional on import: absent keeps the current settings.
	 */
	settings?: Settings;
}

export interface ExportFile {
	format: typeof EXPORT_FORMAT;
	formatVersion: number;
	app: { name: string; version: string };
	databaseSchemaVersion: number;
	exportedAt: string;
	data: ExportData;
	/** Derived, for analysis only. Ignored on import. */
	statistics?: unknown[];
}

// ------------------------------------------------------------------ export

const iso = (t: number | null | undefined): string | null =>
	typeof t === 'number' ? new Date(t).toISOString() : null;
const isoReq = (t: number) => new Date(t).toISOString();

type R = Record<string, unknown>;

export function exportData(db: DB): ExportData {
	const read = db.transaction((): ExportData => {
		const all = (sql: string) => db.prepare(sql).all() as R[];
		return {
			lists: all('SELECT * FROM lists ORDER BY position, created_at').map((r) => ({
				id: r.id as string,
				name: r.name as string,
				position: r.position as number,
				createdAt: isoReq(r.created_at as number),
				updatedAt: isoReq(r.updated_at as number),
				kind: (r.kind as 'grocery' | 'checklist') ?? 'grocery',
				kindChangedAt: iso(r.kind_changed_at as number | null),
				categoryOrder: r.category_order
					? (JSON.parse(r.category_order as string) as string[])
					: null
			})),
			categories: all('SELECT * FROM categories ORDER BY position, created_at').map((r) => ({
				id: r.id as string,
				name: r.name as string,
				position: r.position as number,
				createdAt: isoReq(r.created_at as number),
				updatedAt: isoReq(r.updated_at as number)
			})),
			products: all('SELECT * FROM products ORDER BY name_key, id').map((r) => ({
				id: r.id as string,
				name: r.name as string,
				categoryId: (r.category_id as string | null) ?? null,
				favorite: r.favorite === 1,
				createdAt: isoReq(r.created_at as number),
				updatedAt: isoReq(r.updated_at as number),
				defaultQuantity: (r.default_quantity as number | null) ?? null,
				defaultUnit: (r.default_unit as string | null) ?? null,
				preferredListId: (r.preferred_list_id as string | null) ?? null,
				note: (r.note as string | null) ?? null,
				photoId: (r.photo_id as string | null) ?? null,
				stockStatus: (r.stock_status as ExportProduct['stockStatus']) ?? 'unknown',
				stockUpdatedAt: iso(r.stock_updated_at as number | null)
			})),
			listItems: all('SELECT * FROM items ORDER BY activated_at, id').map((r) => ({
				id: r.id as string,
				listId: r.list_id as string,
				productId: r.product_id as string,
				status: r.status as 'active' | 'completed',
				quantity: (r.quantity as number | null) ?? null,
				unit: (r.unit as string | null) ?? null,
				activatedAt: isoReq(r.activated_at as number),
				completedAt: iso(r.completed_at as number | null),
				purchaseEventId: (r.cycle_id as string | null) ?? null,
				createdAt: isoReq(r.created_at as number),
				updatedAt: isoReq(r.updated_at as number),
				note: (r.note as string | null) ?? null,
				substituteOk: r.substitute_ok === 1,
				substituteNote: (r.substitute_note as string | null) ?? null,
				unavailableAt: iso(r.unavailable_at as number | null),
				position: (r.position as number) ?? 0
			})),
			purchaseEvents: all('SELECT * FROM cycles ORDER BY activated_at, id').map((r) => ({
				id: r.id as string,
				productId: r.product_id as string,
				listId: (r.list_id as string | null) ?? null,
				status: r.completed_at ? 'purchased' : r.cancelled_at ? 'cancelled' : 'open',
				activatedAt: isoReq(r.activated_at as number),
				completedAt: iso(r.completed_at as number | null),
				cancelledAt: iso(r.cancelled_at as number | null),
				quantity: (r.quantity as number | null) ?? null,
				unit: (r.unit as string | null) ?? null,
				requestedQuantity: (r.requested_quantity as number | null) ?? null,
				purchasedQuantity: (r.purchased_quantity as number | null) ?? null
			})),
			aiRecommendations: all('SELECT * FROM ai_recommendations ORDER BY imported_at, id').map(
				(r) => ({
					id: r.id as string,
					productId: r.product_id as string,
					suggestedQuantity: (r.suggested_quantity as number | null) ?? null,
					suggestedUnit: (r.suggested_unit as string | null) ?? null,
					nextPurchaseAt: iso(r.next_purchase_at as number | null),
					confidence: r.confidence as number,
					reasoning: r.reasoning as string,
					source: (r.source as string | null) ?? null,
					batchId: r.batch_id as string,
					status: r.status as 'open' | 'accepted' | 'dismissed',
					importedAt: isoReq(r.imported_at as number),
					resolvedAt: iso(r.resolved_at as number | null)
				})
			),
			productAliases: all('SELECT * FROM product_aliases ORDER BY alias_key').map((r) => ({
				id: r.id as string,
				productId: r.product_id as string,
				alias: r.alias as string,
				createdAt: isoReq(r.created_at as number)
			})),
			bundles: all('SELECT * FROM bundles ORDER BY name, id').map((b) => ({
				id: b.id as string,
				name: b.name as string,
				servings: (b.servings as number | null) ?? null,
				createdAt: isoReq(b.created_at as number),
				updatedAt: isoReq(b.updated_at as number),
				lines: (
					db
						.prepare('SELECT * FROM bundle_lines WHERE bundle_id = ? ORDER BY position, id')
						.all(b.id) as R[]
				).map((l) => ({
					id: l.id as string,
					productId: l.product_id as string,
					quantity: (l.quantity as number | null) ?? null,
					unit: (l.unit as string | null) ?? null,
					note: (l.note as string | null) ?? null
				}))
			})),
			media: all(
				'SELECT * FROM media WHERE id IN (SELECT photo_id FROM products WHERE photo_id IS NOT NULL) ORDER BY id'
			).map((m) => ({
				id: m.id as string,
				mime: m.mime as string,
				width: m.width as number,
				height: m.height as number,
				bytes: m.bytes as number,
				sha256: m.sha256 as string,
				createdAt: isoReq(m.created_at as number),
				file: `media/${m.id as string}.${mediaExt(m.mime as string)}`
			})),
			settings: readSettings(db)
		};
	});
	return read();
}

export function mediaExt(mime: string): string {
	return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}

export function statisticsRows(data: ExportData, now = Date.now()) {
	const completions = new Map<string, number[]>();
	for (const e of data.purchaseEvents) {
		if (!e.completedAt) continue;
		const arr = completions.get(e.productId) ?? [];
		arr.push(Date.parse(e.completedAt));
		completions.set(e.productId, arr);
	}
	return data.products.map((p) => {
		const c = completions.get(p.id) ?? [];
		const s = computeStats(c, c.length, now);
		return {
			productId: p.id,
			name: p.name,
			purchaseCount: s.purchaseCount,
			firstPurchasedAt: iso(s.firstPurchasedAt),
			lastPurchasedAt: iso(s.lastPurchasedAt),
			avgIntervalDays:
				s.avgIntervalDays === null ? null : Math.round(s.avgIntervalDays * 100) / 100,
			purchasesPerMonth: s.perMonth === null ? null : Math.round(s.perMonth * 100) / 100,
			purchasesLast90Days: s.recentCount,
			nextEstimatedAt: iso(s.nextEstimatedAt),
			enoughHistory: s.hasEnoughHistory
		};
	});
}

export function buildExport(db: DB, appVersion: string, now = Date.now()): ExportFile {
	const data = exportData(db);
	return {
		format: EXPORT_FORMAT,
		formatVersion: EXPORT_FORMAT_VERSION,
		app: { name: '8star-grocery-list', version: appVersion },
		databaseSchemaVersion: schemaVersion(db),
		exportedAt: new Date(now).toISOString(),
		data,
		statistics: statisticsRows(data, now)
	};
}

// ------------------------------------------------------------------ validation

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_RECORDS = 200_000;

/** Validated import data with timestamps as epoch milliseconds. */
export interface ImportCategory {
	id: string;
	name: string;
	position: number;
	createdAt: number;
	updatedAt: number;
}
export interface ImportList extends ImportCategory {
	kind: 'grocery' | 'checklist';
	kindChangedAt: number | null;
	categoryOrder: string[] | null;
}
export interface ImportProduct {
	id: string;
	name: string;
	categoryId: string | null;
	favorite: boolean;
	createdAt: number;
	updatedAt: number;
	defaultQuantity: number | null;
	defaultUnit: string | null;
	preferredListId: string | null;
	note: string | null;
	photoId: string | null;
	stockStatus: 'unknown' | 'enough' | 'low' | 'out';
	stockUpdatedAt: number | null;
}
export interface ImportAlias {
	id: string;
	productId: string;
	alias: string;
	createdAt: number;
}
export interface ImportBundle {
	id: string;
	name: string;
	servings: number | null;
	createdAt: number;
	updatedAt: number;
	lines: {
		id: string;
		productId: string;
		quantity: number | null;
		unit: string | null;
		note: string | null;
	}[];
}
export interface ImportMedia {
	id: string;
	file: string;
	createdAt: number;
}
export interface ImportEvent {
	id: string;
	productId: string;
	listId: string | null;
	activatedAt: number;
	completedAt: number | null;
	cancelledAt: number | null;
	quantity: number | null;
	unit: string | null;
	requestedQuantity: number | null;
	purchasedQuantity: number | null;
}
export interface ImportItem {
	id: string;
	listId: string;
	productId: string;
	status: 'active' | 'completed';
	quantity: number | null;
	unit: string | null;
	activatedAt: number;
	completedAt: number | null;
	purchaseEventId: string | null;
	createdAt: number;
	updatedAt: number;
	note: string | null;
	substituteOk: boolean;
	substituteNote: string | null;
	unavailableAt: number | null;
	position: number;
}
export interface ImportRecommendation {
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
}
export interface ImportDataset {
	lists: ImportList[];
	categories: ImportCategory[];
	products: ImportProduct[];
	listItems: ImportItem[];
	purchaseEvents: ImportEvent[];
	aiRecommendations: ImportRecommendation[];
	productAliases: ImportAlias[];
	bundles: ImportBundle[];
	media: ImportMedia[];
	/** Only the settings present in the file; a replace applies them, a merge ignores them. */
	settings?: Partial<Settings>;
}

export class Validator {
	errors: string[] = [];
	warnings: string[] = [];

	/** Messages are in the household language (English when none is given). */
	constructor(readonly t: Messages = messagesFor(DEFAULT_LANGUAGE)) {}

	error(path: string, message: string) {
		if (this.errors.length < 200) this.errors.push(`${path}: ${message}`);
	}

	obj(v: unknown, path: string): R | null {
		if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as R;
		this.error(path, this.t.import.validate.object);
		return null;
	}

	arr(v: unknown, path: string, required = true): unknown[] {
		if (v === undefined && !required) return [];
		if (!Array.isArray(v)) {
			this.error(path, this.t.import.validate.array);
			return [];
		}
		if (v.length > MAX_RECORDS) {
			this.error(path, this.t.import.validate.tooMany(MAX_RECORDS));
			return [];
		}
		return v;
	}

	id(v: unknown, path: string): string {
		if (typeof v === 'string' && ID_RE.test(v)) return v;
		this.error(path, this.t.import.validate.id);
		return '';
	}

	nullableId(v: unknown, path: string): string | null {
		if (v === null || v === undefined || v === '') return null;
		return this.id(v, path);
	}

	name(v: unknown, path: string): string {
		if (typeof v === 'string') {
			const n = cleanName(v);
			if (n && n.length <= MAX_NAME_LENGTH) return n;
		}
		this.error(path, this.t.import.validate.name(MAX_NAME_LENGTH));
		return '';
	}

	time(v: unknown, path: string): number {
		const t = parseTimestamp(v);
		if (t === null) {
			this.error(path, this.t.import.validate.time);
			return 0;
		}
		return t;
	}

	nullableTime(v: unknown, path: string): number | null {
		if (v === null || v === undefined || v === '') return null;
		return this.time(v, path);
	}

	quantity(v: unknown, path: string): number | null {
		if (v === null || v === undefined || v === '') return null;
		if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 100000)
			return Math.round(v * 1000) / 1000;
		this.error(path, this.t.import.validate.quantity);
		return null;
	}

	unit(v: unknown, path: string): string | null {
		if (v === null || v === undefined || v === '') return null;
		if (typeof v === 'string' && (UNITS as readonly string[]).includes(v)) return v;
		this.error(path, this.t.import.validate.unit(UNITS.join(', ')));
		return null;
	}

	note(v: unknown, path: string): string | null {
		if (v === null || v === undefined || v === '') return null;
		if (typeof v === 'string') {
			const n = cleanName(v);
			if (n.length <= MAX_NOTE_LENGTH) return n || null;
		}
		this.error(path, this.t.import.validate.note(MAX_NOTE_LENGTH));
		return null;
	}

	number(v: unknown, path: string, fallback: number): number {
		if (v === undefined || v === null) return fallback;
		if (typeof v === 'number' && Number.isFinite(v)) return v;
		this.error(path, this.t.import.validate.number);
		return fallback;
	}

	int(v: unknown, path: string, fallback: number): number {
		if (v === undefined || v === null) return fallback;
		if (typeof v === 'number' && Number.isInteger(v)) return v;
		this.error(path, this.t.import.validate.integer);
		return fallback;
	}
}

/** Accepts ISO 8601 strings (and epoch milliseconds for legacy exports). */
export function parseTimestamp(v: unknown): number | null {
	// v1.0.0 seeded its default categories with created_at = 0.
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.round(v);
	if (typeof v !== 'string' || !v.trim()) return null;
	const s = v.trim();
	if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
	const t = Date.parse(s);
	return Number.isFinite(t) ? t : null;
}

function legacyToCurrent(file: R): R {
	// v1.0.0 exported raw SQLite rows (snake_case, epoch ms) at the top level.
	const rows = (k: string) => (Array.isArray(file[k]) ? (file[k] as R[]) : []);
	return {
		lists: rows('lists').map((r) => ({
			id: r.id,
			name: r.name,
			position: r.position,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			kind: r.kind,
			kindChangedAt: r.kind_changed_at
		})),
		categories: rows('categories').map((r) => ({
			id: r.id,
			name: r.name,
			position: r.position,
			createdAt: r.created_at,
			updatedAt: r.updated_at
		})),
		products: rows('products').map((r) => ({
			id: r.id,
			name: r.name,
			categoryId: r.category_id,
			favorite: r.favorite === 1 || r.favorite === true,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			defaultQuantity: r.default_quantity,
			defaultUnit: r.default_unit,
			preferredListId: r.preferred_list_id,
			note: r.note,
			photoId: r.photo_id,
			stockStatus: r.stock_status,
			stockUpdatedAt: r.stock_updated_at
		})),
		listItems: rows('items').map((r) => ({
			id: r.id,
			listId: r.list_id,
			productId: r.product_id,
			status: r.status,
			quantity: r.quantity,
			unit: r.unit,
			activatedAt: r.activated_at,
			completedAt: r.completed_at,
			purchaseEventId: r.cycle_id,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			// Raw rows of newer databases carry these too; v1.0.0 rows simply lack them.
			note: r.note,
			substituteOk: r.substitute_ok === 1,
			substituteNote: r.substitute_note,
			unavailableAt: r.unavailable_at,
			position: r.position
		})),
		purchaseEvents: rows('cycles').map((r) => ({
			id: r.id,
			productId: r.product_id,
			listId: r.list_id,
			activatedAt: r.activated_at,
			completedAt: r.completed_at,
			cancelledAt: r.cancelled_at,
			quantity: r.quantity,
			unit: r.unit,
			requestedQuantity: r.requested_quantity,
			purchasedQuantity: r.purchased_quantity
		})),
		aiRecommendations: [],
		productAliases: [],
		bundles: [],
		media: []
	};
}

/**
 * Validates an uploaded export file (format 1, or the v1.0.0 export) and returns the dataset.
 * All problems are collected; the caller rejects the import when `errors` is non-empty.
 */
export function parseExportFile(input: unknown, v = new Validator()): ImportDataset {
	const empty: ImportDataset = {
		lists: [],
		categories: [],
		products: [],
		listItems: [],
		purchaseEvents: [],
		aiRecommendations: [],
		productAliases: [],
		bundles: [],
		media: []
	};
	const vt = v.t.import.validate;
	const file = v.obj(input, vt.file);
	if (!file) return empty;

	let data: R | null;
	if (file.format === EXPORT_FORMAT) {
		if (typeof file.formatVersion !== 'number' || file.formatVersion > EXPORT_FORMAT_VERSION) {
			v.error('formatVersion', vt.version(String(file.formatVersion), EXPORT_FORMAT_VERSION));
			return empty;
		}
		data = v.obj(file.data, 'data');
	} else if (file.app === '8star-grocery-list' && Array.isArray(file.cycles)) {
		v.warnings.push(vt.legacy);
		data = legacyToCurrent(file);
	} else {
		v.error('format', vt.notExport(EXPORT_FORMAT));
		return empty;
	}
	if (!data) return empty;

	const category = (r: unknown, path: string): ImportCategory | null => {
		const o = v.obj(r, path);
		if (!o) return null;
		const createdAt = v.time(o.createdAt, `${path}.createdAt`);
		return {
			id: v.id(o.id, `${path}.id`),
			name: v.name(o.name, `${path}.name`),
			position: v.int(o.position, `${path}.position`, 0),
			createdAt,
			updatedAt: v.nullableTime(o.updatedAt, `${path}.updatedAt`) ?? createdAt
		};
	};
	const list = (r: unknown, path: string): ImportList | null => {
		const base = category(r, path);
		if (!base) return null;
		const o = r as R;
		const kind = o.kind === undefined || o.kind === null ? 'grocery' : o.kind;
		if (kind !== 'grocery' && kind !== 'checklist')
			v.error(`${path}.kind`, vt.oneOf('"grocery", "checklist"'));
		let categoryOrder: string[] | null = null;
		if (Array.isArray(o.categoryOrder))
			categoryOrder = o.categoryOrder.map((c, i) => v.id(c, `${path}.categoryOrder[${i}]`));
		return {
			...base,
			kind: kind === 'checklist' ? 'checklist' : 'grocery',
			kindChangedAt: v.nullableTime(o.kindChangedAt, `${path}.kindChangedAt`),
			categoryOrder
		};
	};

	const out: ImportDataset = {
		lists: v
			.arr(data.lists, 'data.lists')
			.map((r, i) => list(r, `lists[${i}]`))
			.filter((x): x is ImportList => !!x),
		categories: v
			.arr(data.categories, 'data.categories')
			.map((r, i) => category(r, `categories[${i}]`))
			.filter((x): x is ImportCategory => !!x),
		products: [],
		listItems: [],
		purchaseEvents: [],
		aiRecommendations: [],
		productAliases: [],
		bundles: [],
		media: []
	};

	v.arr(data.products, 'data.products').forEach((r, i) => {
		const p = `products[${i}]`;
		const o = v.obj(r, p);
		if (!o) return;
		const createdAt = v.time(o.createdAt, `${p}.createdAt`);
		const stock = o.stockStatus ?? 'unknown';
		if (!['unknown', 'enough', 'low', 'out'].includes(stock as string))
			v.error(`${p}.stockStatus`, vt.oneOf('unknown, enough, low, out'));
		const defaultQuantity = v.quantity(o.defaultQuantity, `${p}.defaultQuantity`);
		out.products.push({
			id: v.id(o.id, `${p}.id`),
			name: v.name(o.name, `${p}.name`),
			categoryId: v.nullableId(o.categoryId, `${p}.categoryId`),
			favorite: o.favorite === true,
			createdAt,
			updatedAt: v.nullableTime(o.updatedAt, `${p}.updatedAt`) ?? createdAt,
			defaultQuantity,
			defaultUnit: defaultQuantity === null ? null : v.unit(o.defaultUnit, `${p}.defaultUnit`),
			preferredListId: v.nullableId(o.preferredListId, `${p}.preferredListId`),
			note: v.note(o.note, `${p}.note`),
			photoId: v.nullableId(o.photoId, `${p}.photoId`),
			stockStatus: stock as ImportProduct['stockStatus'],
			stockUpdatedAt: v.nullableTime(o.stockUpdatedAt, `${p}.stockUpdatedAt`)
		});
	});

	v.arr(data.purchaseEvents, 'data.purchaseEvents').forEach((r, i) => {
		const p = `purchaseEvents[${i}]`;
		const o = v.obj(r, p);
		if (!o) return;
		const ev: ImportEvent = {
			id: v.id(o.id, `${p}.id`),
			productId: v.id(o.productId, `${p}.productId`),
			listId: v.nullableId(o.listId, `${p}.listId`),
			activatedAt: v.time(o.activatedAt, `${p}.activatedAt`),
			completedAt: v.nullableTime(o.completedAt, `${p}.completedAt`),
			cancelledAt: v.nullableTime(o.cancelledAt, `${p}.cancelledAt`),
			quantity: v.quantity(o.quantity, `${p}.quantity`),
			unit: v.unit(o.unit, `${p}.unit`),
			requestedQuantity: null,
			purchasedQuantity: null
		};
		// Format 1 has no requested/purchased split: the quantity was both.
		ev.requestedQuantity =
			o.requestedQuantity === undefined
				? ev.quantity
				: v.quantity(o.requestedQuantity, `${p}.requestedQuantity`);
		ev.purchasedQuantity =
			o.purchasedQuantity === undefined
				? ev.completedAt !== null
					? ev.quantity
					: null
				: v.quantity(o.purchasedQuantity, `${p}.purchasedQuantity`);
		if (ev.completedAt !== null && ev.cancelledAt !== null) v.error(p, vt.boughtAndCancelled);
		out.purchaseEvents.push(ev);
	});

	v.arr(data.listItems, 'data.listItems').forEach((r, i) => {
		const p = `listItems[${i}]`;
		const o = v.obj(r, p);
		if (!o) return;
		const status = o.status === 'active' || o.status === 'completed' ? o.status : null;
		if (!status) v.error(`${p}.status`, vt.oneOf('"active", "completed"'));
		const activatedAt = v.time(o.activatedAt, `${p}.activatedAt`);
		const completedAt = v.nullableTime(o.completedAt, `${p}.completedAt`);
		if (status === 'completed' && completedAt === null)
			v.error(`${p}.completedAt`, vt.completedRequired);
		out.listItems.push({
			id: v.id(o.id, `${p}.id`),
			listId: v.id(o.listId, `${p}.listId`),
			productId: v.id(o.productId, `${p}.productId`),
			status: status ?? 'active',
			quantity: v.quantity(o.quantity, `${p}.quantity`),
			unit: v.unit(o.unit, `${p}.unit`),
			activatedAt,
			completedAt: status === 'active' ? null : completedAt,
			purchaseEventId: v.nullableId(o.purchaseEventId, `${p}.purchaseEventId`),
			createdAt: v.nullableTime(o.createdAt, `${p}.createdAt`) ?? activatedAt,
			updatedAt: v.nullableTime(o.updatedAt, `${p}.updatedAt`) ?? activatedAt,
			note: v.note(o.note, `${p}.note`),
			substituteOk: o.substituteOk === true,
			substituteNote: v.note(o.substituteNote, `${p}.substituteNote`),
			unavailableAt:
				status === 'active' ? v.nullableTime(o.unavailableAt, `${p}.unavailableAt`) : null,
			position: v.number(o.position, `${p}.position`, activatedAt)
		});
	});

	v.arr(data.productAliases, 'data.productAliases', false).forEach((r, i) => {
		const p = `productAliases[${i}]`;
		const o = v.obj(r, p);
		if (!o) return;
		out.productAliases.push({
			id: v.id(o.id, `${p}.id`),
			productId: v.id(o.productId, `${p}.productId`),
			alias: v.name(o.alias, `${p}.alias`),
			createdAt: v.nullableTime(o.createdAt, `${p}.createdAt`) ?? 0
		});
	});

	v.arr(data.bundles, 'data.bundles', false).forEach((r, i) => {
		const p = `bundles[${i}]`;
		const o = v.obj(r, p);
		if (!o) return;
		const createdAt = v.nullableTime(o.createdAt, `${p}.createdAt`) ?? 0;
		const servings = o.servings === null || o.servings === undefined ? null : o.servings;
		if (servings !== null && !(typeof servings === 'number' && servings > 0 && servings <= 100))
			v.error(`${p}.servings`, vt.between(0, 100));
		out.bundles.push({
			id: v.id(o.id, `${p}.id`),
			name: v.name(o.name, `${p}.name`),
			servings: typeof servings === 'number' ? servings : null,
			createdAt,
			updatedAt: v.nullableTime(o.updatedAt, `${p}.updatedAt`) ?? createdAt,
			lines: v.arr(o.lines, `${p}.lines`, false).map((l, j) => {
				const lp = `${p}.lines[${j}]`;
				const lo = v.obj(l, lp) ?? {};
				const quantity = v.quantity(lo.quantity, `${lp}.quantity`);
				return {
					id: v.id(lo.id, `${lp}.id`),
					productId: v.id(lo.productId, `${lp}.productId`),
					quantity,
					unit: quantity === null ? null : v.unit(lo.unit, `${lp}.unit`),
					note: v.note(lo.note, `${lp}.note`)
				};
			})
		});
	});

	v.arr(data.media, 'data.media', false).forEach((r, i) => {
		const p = `media[${i}]`;
		const o = v.obj(r, p);
		if (!o) return;
		const id = v.id(o.id, `${p}.id`);
		const file = typeof o.file === 'string' ? o.file : '';
		if (!/^media\/[A-Za-z0-9_-]{1,64}\.(jpg|png|webp)$/.test(file))
			v.error(`${p}.file`, vt.fileName);
		out.media.push({ id, file, createdAt: v.nullableTime(o.createdAt, `${p}.createdAt`) ?? 0 });
	});

	v.arr(data.aiRecommendations, 'data.aiRecommendations', false).forEach((r, i) => {
		const p = `aiRecommendations[${i}]`;
		const o = v.obj(r, p);
		if (!o) return;
		const status =
			o.status === 'open' || o.status === 'accepted' || o.status === 'dismissed' ? o.status : null;
		if (!status) v.error(`${p}.status`, vt.oneOf('"open", "accepted", "dismissed"'));
		const confidence = typeof o.confidence === 'number' ? o.confidence : NaN;
		if (!(confidence >= 0 && confidence <= 1)) v.error(`${p}.confidence`, vt.between(0, 1));
		const reasoning = typeof o.reasoning === 'string' ? o.reasoning.trim().slice(0, 1000) : '';
		if (!reasoning) v.error(`${p}.reasoning`, vt.missing);
		out.aiRecommendations.push({
			id: v.id(o.id, `${p}.id`),
			productId: v.id(o.productId, `${p}.productId`),
			suggestedQuantity: v.quantity(o.suggestedQuantity, `${p}.suggestedQuantity`),
			suggestedUnit: v.unit(o.suggestedUnit, `${p}.suggestedUnit`),
			nextPurchaseAt: v.nullableTime(o.nextPurchaseAt, `${p}.nextPurchaseAt`),
			confidence,
			reasoning,
			source: typeof o.source === 'string' ? o.source.slice(0, 80) : null,
			batchId: typeof o.batchId === 'string' && o.batchId ? o.batchId.slice(0, 64) : 'import',
			status: status ?? 'open',
			importedAt: v.time(o.importedAt, `${p}.importedAt`),
			resolvedAt: v.nullableTime(o.resolvedAt, `${p}.resolvedAt`)
		});
	});

	if (data.settings !== undefined && data.settings !== null) {
		const o = v.obj(data.settings, 'data.settings');
		if (o) {
			out.settings = {};
			// `aiEnabled` is the v1.3/v1.4 name of `suggestionsEnabled`; the new name wins.
			for (const key of ['suggestionsEnabled', 'aiEnabled', 'bulkAddEnabled'] as const) {
				const value = o[key];
				if (value === undefined) continue;
				if (typeof value !== 'boolean') v.error(`settings.${key}`, vt.oneOf('true, false'));
				else if (key === 'bulkAddEnabled') out.settings.bulkAddEnabled = value;
				else out.settings.suggestionsEnabled ??= value;
			}
			if (o.language !== undefined) {
				if (isLanguage(o.language)) out.settings.language = o.language;
				else v.error('settings.language', vt.oneOf(LANGUAGES.join(', ')));
			}
		}
	}

	checkIntegrity(out, v);
	return out;
}

/** Referential integrity and uniqueness inside an import file. */
function checkIntegrity(d: ImportDataset, v: Validator) {
	const vt = v.t.import.validate;
	const unique = <T extends { id: string }>(rows: T[], label: string) => {
		const seen = new Set<string>();
		for (const r of rows) {
			if (!r.id) continue;
			if (seen.has(r.id)) v.error(label, vt.duplicateId(r.id));
			seen.add(r.id);
		}
		return seen;
	};
	const lists = unique(d.lists, 'lists');
	const categories = unique(d.categories, 'categories');
	const products = unique(d.products, 'products');
	const events = unique(d.purchaseEvents, 'purchaseEvents');
	unique(d.listItems, 'listItems');
	unique(d.aiRecommendations, 'aiRecommendations');

	const names = new Map<string, string>();
	for (const p of d.products) {
		const key = nameKey(p.name);
		if (key && names.has(key))
			v.error('products', vt.duplicateProduct(p.name, names.get(key) ?? '', p.id));
		names.set(key, p.id);
		if (p.categoryId && !categories.has(p.categoryId))
			v.error(`product ${p.id}`, vt.unknownCategory(p.categoryId ?? ''));
	}
	const pairs = new Set<string>();
	for (const it of d.listItems) {
		if (!lists.has(it.listId)) v.error(`listItem ${it.id}`, vt.unknownList(it.listId));
		if (!products.has(it.productId)) v.error(`listItem ${it.id}`, vt.unknownProduct(it.productId));
		if (it.purchaseEventId && !events.has(it.purchaseEventId))
			v.error(`listItem ${it.id}`, vt.unknownPurchase(it.purchaseEventId ?? ''));
		const pair = `${it.listId}|${it.productId}`;
		if (pairs.has(pair)) v.error(`listItem ${it.id}`, vt.twiceOnList);
		pairs.add(pair);
	}
	for (const e of d.purchaseEvents) {
		if (!products.has(e.productId))
			v.error(`purchaseEvent ${e.id}`, vt.unknownProduct(e.productId));
		if (e.listId && !lists.has(e.listId)) {
			v.warnings.push(vt.purchaseListMissing(e.id, e.listId));
			e.listId = null;
		}
	}
	for (const r of d.aiRecommendations) {
		if (!products.has(r.productId))
			v.error(`aiRecommendation ${r.id}`, vt.unknownProduct(r.productId));
	}
	unique(d.productAliases, 'productAliases');
	unique(d.bundles, 'bundles');
	unique(
		d.bundles.flatMap((b) => b.lines),
		'bundle lines'
	);
	const aliasKeys = new Set<string>();
	for (const a of d.productAliases) {
		const key = nameKey(a.alias);
		if (!products.has(a.productId)) v.error(`alias ${a.id}`, vt.unknownProduct(a.productId));
		if (names.has(key)) v.error(`alias ${a.id}`, vt.aliasIsName(a.alias));
		if (aliasKeys.has(key)) v.error(`alias ${a.id}`, vt.aliasTwice(a.alias));
		aliasKeys.add(key);
	}
	for (const b of d.bundles) {
		const seen = new Set<string>();
		for (const l of b.lines) {
			if (!products.has(l.productId)) v.error(`bundle ${b.id}`, vt.unknownProduct(l.productId));
			if (seen.has(l.productId)) v.error(`bundle ${b.id}`, vt.twiceInBundle);
			seen.add(l.productId);
		}
	}
	for (const l of d.lists) {
		if (l.categoryOrder) l.categoryOrder = l.categoryOrder.filter((c) => categories.has(c));
	}
	for (const p of d.products) {
		if (p.preferredListId && !lists.has(p.preferredListId)) {
			v.warnings.push(vt.preferredListMissing(p.id));
			p.preferredListId = null;
		}
	}
}
