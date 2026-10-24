/**
 * Versioned export/import formats. See docs/IMPORT-EXPORT.md.
 *
 * Export format 1 contains every meaningful record with its stable id, relationships and
 * ISO 8601 timestamps. Derived statistics are included for analysis but ignored on import.
 */

import type { DB } from '../db';
import { schemaVersion } from '../db';
import { computeStats } from '$lib/shared/stats';
import { UNITS } from '$lib/shared/quantity';
import { cleanName, nameKey, MAX_NAME_LENGTH } from '$lib/shared/text';

export const EXPORT_FORMAT = '8star-grocery-export';
export const EXPORT_FORMAT_VERSION = 1;

export interface ExportList {
	id: string;
	name: string;
	position: number;
	createdAt: string;
	updatedAt: string;
}
export type ExportCategory = ExportList;

export interface ExportProduct {
	id: string;
	name: string;
	categoryId: string | null;
	favorite: boolean;
	createdAt: string;
	updatedAt: string;
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
				updatedAt: isoReq(r.updated_at as number)
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
				updatedAt: isoReq(r.updated_at as number)
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
				updatedAt: isoReq(r.updated_at as number)
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
				unit: (r.unit as string | null) ?? null
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
			)
		};
	});
	return read();
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
export interface ImportList {
	id: string;
	name: string;
	position: number;
	createdAt: number;
	updatedAt: number;
}
export interface ImportProduct {
	id: string;
	name: string;
	categoryId: string | null;
	favorite: boolean;
	createdAt: number;
	updatedAt: number;
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
	categories: ImportList[];
	products: ImportProduct[];
	listItems: ImportItem[];
	purchaseEvents: ImportEvent[];
	aiRecommendations: ImportRecommendation[];
}

export class Validator {
	errors: string[] = [];
	warnings: string[] = [];

	error(path: string, message: string) {
		if (this.errors.length < 200) this.errors.push(`${path}: ${message}`);
	}

	obj(v: unknown, path: string): R | null {
		if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as R;
		this.error(path, 'moet een object zijn');
		return null;
	}

	arr(v: unknown, path: string, required = true): unknown[] {
		if (v === undefined && !required) return [];
		if (!Array.isArray(v)) {
			this.error(path, 'moet een lijst (array) zijn');
			return [];
		}
		if (v.length > MAX_RECORDS) {
			this.error(path, `te veel records (max ${MAX_RECORDS})`);
			return [];
		}
		return v;
	}

	id(v: unknown, path: string): string {
		if (typeof v === 'string' && ID_RE.test(v)) return v;
		this.error(path, 'ongeldige id (letters, cijfers, - en _, max 64 tekens)');
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
		this.error(path, `naam ontbreekt of is langer dan ${MAX_NAME_LENGTH} tekens`);
		return '';
	}

	time(v: unknown, path: string): number {
		const t = parseTimestamp(v);
		if (t === null) {
			this.error(path, 'ongeldige datum/tijd (verwacht ISO 8601, bijv. 2026-10-24T08:30:00Z)');
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
		this.error(path, 'ongeldige hoeveelheid (getal groter dan 0)');
		return null;
	}

	unit(v: unknown, path: string): string | null {
		if (v === null || v === undefined || v === '') return null;
		if (typeof v === 'string' && (UNITS as readonly string[]).includes(v)) return v;
		this.error(path, `onbekende eenheid (toegestaan: ${UNITS.join(', ')})`);
		return null;
	}

	int(v: unknown, path: string, fallback: number): number {
		if (v === undefined || v === null) return fallback;
		if (typeof v === 'number' && Number.isInteger(v)) return v;
		this.error(path, 'moet een geheel getal zijn');
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
			updatedAt: r.updated_at
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
			updatedAt: r.updated_at
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
			updatedAt: r.updated_at
		})),
		purchaseEvents: rows('cycles').map((r) => ({
			id: r.id,
			productId: r.product_id,
			listId: r.list_id,
			activatedAt: r.activated_at,
			completedAt: r.completed_at,
			cancelledAt: r.cancelled_at,
			quantity: r.quantity,
			unit: r.unit
		})),
		aiRecommendations: []
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
		aiRecommendations: []
	};
	const file = v.obj(input, 'bestand');
	if (!file) return empty;

	let data: R | null;
	if (file.format === EXPORT_FORMAT) {
		if (typeof file.formatVersion !== 'number' || file.formatVersion > EXPORT_FORMAT_VERSION) {
			v.error(
				'formatVersion',
				`versie ${String(file.formatVersion)} wordt niet ondersteund (max ${EXPORT_FORMAT_VERSION}); werk de app bij`
			);
			return empty;
		}
		data = v.obj(file.data, 'data');
	} else if (file.app === '8star-grocery-list' && Array.isArray(file.cycles)) {
		v.warnings.push('Oud exportformaat (v1.0.0) herkend en omgezet.');
		data = legacyToCurrent(file);
	} else {
		v.error('format', `geen 8star-export (verwacht "format": "${EXPORT_FORMAT}")`);
		return empty;
	}
	if (!data) return empty;

	const list = (r: unknown, path: string): ImportList | null => {
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

	const out: ImportDataset = {
		lists: v
			.arr(data.lists, 'data.lists')
			.map((r, i) => list(r, `lists[${i}]`))
			.filter((x): x is ImportList => !!x),
		categories: v
			.arr(data.categories, 'data.categories')
			.map((r, i) => list(r, `categories[${i}]`))
			.filter((x): x is ImportList => !!x),
		products: [],
		listItems: [],
		purchaseEvents: [],
		aiRecommendations: []
	};

	v.arr(data.products, 'data.products').forEach((r, i) => {
		const p = `products[${i}]`;
		const o = v.obj(r, p);
		if (!o) return;
		const createdAt = v.time(o.createdAt, `${p}.createdAt`);
		out.products.push({
			id: v.id(o.id, `${p}.id`),
			name: v.name(o.name, `${p}.name`),
			categoryId: v.nullableId(o.categoryId, `${p}.categoryId`),
			favorite: o.favorite === true,
			createdAt,
			updatedAt: v.nullableTime(o.updatedAt, `${p}.updatedAt`) ?? createdAt
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
			unit: v.unit(o.unit, `${p}.unit`)
		};
		if (ev.completedAt !== null && ev.cancelledAt !== null)
			v.error(p, 'kan niet zowel gekocht als geannuleerd zijn');
		out.purchaseEvents.push(ev);
	});

	v.arr(data.listItems, 'data.listItems').forEach((r, i) => {
		const p = `listItems[${i}]`;
		const o = v.obj(r, p);
		if (!o) return;
		const status = o.status === 'active' || o.status === 'completed' ? o.status : null;
		if (!status) v.error(`${p}.status`, 'moet "active" of "completed" zijn');
		const activatedAt = v.time(o.activatedAt, `${p}.activatedAt`);
		const completedAt = v.nullableTime(o.completedAt, `${p}.completedAt`);
		if (status === 'completed' && completedAt === null)
			v.error(`${p}.completedAt`, 'verplicht voor afgevinkte items');
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
			updatedAt: v.nullableTime(o.updatedAt, `${p}.updatedAt`) ?? activatedAt
		});
	});

	v.arr(data.aiRecommendations, 'data.aiRecommendations', false).forEach((r, i) => {
		const p = `aiRecommendations[${i}]`;
		const o = v.obj(r, p);
		if (!o) return;
		const status =
			o.status === 'open' || o.status === 'accepted' || o.status === 'dismissed' ? o.status : null;
		if (!status) v.error(`${p}.status`, 'moet "open", "accepted" of "dismissed" zijn');
		const confidence = typeof o.confidence === 'number' ? o.confidence : NaN;
		if (!(confidence >= 0 && confidence <= 1))
			v.error(`${p}.confidence`, 'moet tussen 0 en 1 liggen');
		const reasoning = typeof o.reasoning === 'string' ? o.reasoning.trim().slice(0, 1000) : '';
		if (!reasoning) v.error(`${p}.reasoning`, 'ontbreekt');
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

	checkIntegrity(out, v);
	return out;
}

/** Referential integrity and uniqueness inside an import file. */
function checkIntegrity(d: ImportDataset, v: Validator) {
	const unique = <T extends { id: string }>(rows: T[], label: string) => {
		const seen = new Set<string>();
		for (const r of rows) {
			if (!r.id) continue;
			if (seen.has(r.id)) v.error(label, `dubbele id "${r.id}"`);
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
			v.error('products', `product "${p.name}" komt twee keer voor (${names.get(key)} en ${p.id})`);
		names.set(key, p.id);
		if (p.categoryId && !categories.has(p.categoryId))
			v.error(`product ${p.id}`, `onbekende categorie "${p.categoryId}"`);
	}
	const pairs = new Set<string>();
	for (const it of d.listItems) {
		if (!lists.has(it.listId)) v.error(`listItem ${it.id}`, `onbekende lijst "${it.listId}"`);
		if (!products.has(it.productId))
			v.error(`listItem ${it.id}`, `onbekend product "${it.productId}"`);
		if (it.purchaseEventId && !events.has(it.purchaseEventId))
			v.error(`listItem ${it.id}`, `onbekende aankoop "${it.purchaseEventId}"`);
		const pair = `${it.listId}|${it.productId}`;
		if (pairs.has(pair)) v.error(`listItem ${it.id}`, 'product staat twee keer op dezelfde lijst');
		pairs.add(pair);
	}
	for (const e of d.purchaseEvents) {
		if (!products.has(e.productId))
			v.error(`purchaseEvent ${e.id}`, `onbekend product "${e.productId}"`);
		if (e.listId && !lists.has(e.listId)) {
			v.warnings.push(
				`Aankoop ${e.id}: lijst "${e.listId}" bestaat niet in het bestand; zonder lijst bewaard.`
			);
			e.listId = null;
		}
	}
	for (const r of d.aiRecommendations) {
		if (!products.has(r.productId))
			v.error(`aiRecommendation ${r.id}`, `onbekend product "${r.productId}"`);
	}
}
