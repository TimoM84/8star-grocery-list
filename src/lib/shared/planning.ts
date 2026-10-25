/**
 * Pure planning helpers for adding things to a list: what happens when a product is entered
 * (new, back on the list, already there, on another list), multiline paste, bundle scaling,
 * list-aware suggestions and the per-list walking route. Shared by the UI and the tests.
 */

import type { Bundle, Category, Item, List, Product, Snapshot } from './types';
import { analyseDuplicate, isDiscreteUnit, parseEntry, type DuplicateAnalysis } from './quantity';
import { capitaliseFirst, cleanName, MAX_NAME_LENGTH, nameKey } from './text';
import { findProductForName } from './reducer';
import type { ItemView } from './selectors';

export interface EntryInput {
	name: string;
	quantity: number | null;
	unit: string | null;
}

export interface EntryPlan {
	/** Name shown to the user: the known product's name, or the typed name. */
	name: string;
	product: Product | undefined;
	/** Quantity to use for a new or returning item (explicit beats the product's usual one). */
	quantity: number | null;
	unit: string | null;
	explicit: boolean;
	/** The item row of this product on the target list, if any. */
	item: Item | undefined;
	state: 'new' | 'reactivate' | 'active';
	/** Choices when the product is already active on the target list. */
	duplicate: DuplicateAnalysis | null;
	/** Active on other lists (offer "ook hier" / "verplaatsen"). */
	elsewhere: { item: Item; list: List }[];
}

export function planEntry(s: Snapshot, listId: string, entry: EntryInput): EntryPlan | null {
	const typed = cleanName(entry.name);
	if (!typed) return null;
	const product = findProductForName(s, typed);
	const item = product
		? s.items.find((i) => i.productId === product.id && i.listId === listId)
		: undefined;
	const explicit = entry.quantity !== null;
	const usual =
		!explicit && product?.defaultQuantity != null
			? { quantity: product.defaultQuantity, unit: product.defaultUnit }
			: null;
	const state: EntryPlan['state'] = !item
		? 'new'
		: item.status === 'active'
			? 'active'
			: 'reactivate';
	let quantity = explicit ? entry.quantity : (usual?.quantity ?? null);
	let unit = explicit ? entry.unit : (usual?.unit ?? null);
	if (state === 'reactivate' && !explicit && !usual && item) {
		// Coming back without a typed amount keeps what it had last time.
		quantity = item.quantity;
		unit = item.unit;
	}
	const elsewhere: EntryPlan['elsewhere'] = [];
	if (product) {
		for (const i of s.items) {
			if (i.productId !== product.id || i.listId === listId || i.status !== 'active') continue;
			const list = s.lists.find((l) => l.id === i.listId);
			if (list) elsewhere.push({ item: i, list });
		}
	}
	return {
		name: product?.name ?? capitaliseFirst(typed),
		product,
		quantity,
		unit,
		explicit,
		item,
		state,
		duplicate:
			state === 'active' && item
				? analyseDuplicate(
						{ quantity: item.quantity, unit: item.unit },
						{ quantity: entry.quantity, unit: entry.unit }
					)
				: null,
		elsewhere
	};
}

// ------------------------------------------------------------------ multiline paste

export const MAX_BULK_LINES = 100;
export const MAX_BULK_CHARS = 10_000;

export interface BulkLine {
	/** Original line (trimmed) for reference. */
	raw: string;
	name: string;
	quantity: number | null;
	unit: string | null;
	error: string | null;
	/** Index of the first line naming the same product. */
	duplicateOf: number | null;
}

/** Bullets, numbering and checkboxes as pasted from notes apps and chats. */
const BULLET = /^(?:[-*•·–—+>]|\d{1,3}[.)](?=\s)|\[[ xX✓]?\]|[☐☑✓✔□■▪◦])\s*/u;

export function stripBullet(line: string): string {
	let out = line.trim();
	for (let i = 0; i < 3; i++) {
		const next = out.replace(BULLET, '').trim();
		if (next === out) break;
		out = next;
	}
	return out;
}

export interface BulkParse {
	lines: BulkLine[];
	/** Lines dropped because the paste is longer than MAX_BULK_LINES. */
	truncated: number;
	tooLong: boolean;
}

/**
 * Splits pasted text into one entry per line using the normal quantity parser. Lines are never
 * split on commas ("kaas, jong belegen" stays one product). Empty lines are skipped.
 */
export function parseBulk(text: string, s?: Snapshot): BulkParse {
	const tooLong = text.length > MAX_BULK_CHARS;
	const source = tooLong ? text.slice(0, MAX_BULK_CHARS) : text;
	const rows = source
		.split(/\r\n|\r|\n/)
		.map(stripBullet)
		.filter((l) => l.length > 0);
	const truncated = Math.max(0, rows.length - MAX_BULK_LINES);
	const keys = new Map<string, number>();
	const lines = rows.slice(0, MAX_BULK_LINES).map((raw, index): BulkLine => {
		const parsed = parseEntry(raw);
		const name = cleanName(parsed.name);
		let error: string | null = null;
		if (!name) error = 'Geen productnaam';
		else if (name.length > MAX_NAME_LENGTH) error = `Langer dan ${MAX_NAME_LENGTH} tekens`;
		const product = name && s ? findProductForName(s, name) : undefined;
		const key = product ? `p:${product.id}` : `n:${nameKey(name)}`;
		let duplicateOf: number | null = null;
		if (name && !error) {
			if (keys.has(key)) duplicateOf = keys.get(key)!;
			else keys.set(key, index);
		}
		return {
			raw,
			name: product?.name ?? capitaliseFirst(name),
			quantity: parsed.quantity,
			unit: parsed.unit,
			error,
			duplicateOf
		};
	});
	return { lines, truncated, tooLong };
}

// ------------------------------------------------------------------ bundles

export interface ScaledLine {
	lineId: string;
	productId: string;
	quantity: number | null;
	unit: string | null;
	note: string | null;
	/** Exact scaled amount when it had to be rounded up to a whole unit. */
	exact: number | null;
}

/**
 * Scales a bundle to a number of servings. Weights and volumes scale exactly; counted units and
 * packages are rounded up to whole numbers, and the line remembers the exact value so the UI
 * can ask the user to check it ("2,5 blik → 3 blik").
 */
export function scaleBundle(bundle: Bundle, servings: number | null): ScaledLine[] {
	const factor = bundle.servings && servings && servings > 0 ? servings / bundle.servings : 1;
	return bundle.lines.map((l) => {
		if (l.quantity === null || factor === 1)
			return {
				lineId: l.id,
				productId: l.productId,
				quantity: l.quantity,
				unit: l.unit,
				note: l.note,
				exact: null
			};
		const raw = Math.round(l.quantity * factor * 1000) / 1000;
		if (isDiscreteUnit(l.unit) && !Number.isInteger(raw)) {
			return {
				lineId: l.id,
				productId: l.productId,
				quantity: Math.max(1, Math.ceil(raw)),
				unit: l.unit,
				note: l.note,
				exact: raw
			};
		}
		return {
			lineId: l.id,
			productId: l.productId,
			quantity: raw,
			unit: l.unit,
			note: l.note,
			exact: null
		};
	});
}

// ------------------------------------------------------------------ list-aware suggestions

/**
 * Which products belong to a list for suggestions ("Misschien nodig", stock, autocomplete
 * ranking). Documented fallback, in order:
 *  1. a product with a preferred list belongs only to that list;
 *  2. otherwise it belongs to every grocery list where it has an item row (active or ticked);
 *  3. a product without any item row on a grocery list belongs to every grocery list.
 * Checklists never get purchase suggestions.
 */
export function productsForList(s: Snapshot, listId: string): Set<string> {
	const out = new Set<string>();
	const list = s.lists.find((l) => l.id === listId);
	if (!list || list.kind === 'checklist') return out;
	const grocery = new Set(s.lists.filter((l) => l.kind !== 'checklist').map((l) => l.id));
	const listIds = new Set(s.lists.map((l) => l.id));
	const rows = new Map<string, Set<string>>();
	for (const i of s.items) {
		if (!grocery.has(i.listId)) continue;
		let set = rows.get(i.productId);
		if (!set) rows.set(i.productId, (set = new Set()));
		set.add(i.listId);
	}
	for (const p of s.products) {
		if (p.preferredListId && listIds.has(p.preferredListId)) {
			if (p.preferredListId === listId) out.add(p.id);
			continue;
		}
		const on = rows.get(p.id);
		if (!on || on.size === 0 || on.has(listId)) out.add(p.id);
	}
	return out;
}

/** The list a product should normally go to from Suggesties/Voorraad. */
export function targetListFor(s: Snapshot, product: Product, fallbackListId: string): string {
	const preferred = product.preferredListId
		? s.lists.find((l) => l.id === product.preferredListId && l.kind !== 'checklist')
		: undefined;
	if (preferred) return preferred.id;
	const current = s.lists.find((l) => l.id === fallbackListId);
	if (current && current.kind !== 'checklist') return current.id;
	return s.lists.find((l) => l.kind !== 'checklist')?.id ?? fallbackListId;
}

// ------------------------------------------------------------------ walking route

/** Categories in the list's walking route; categories missing from it follow in global order. */
export function routeCategories(categories: Category[], list: List | null | undefined): Category[] {
	const global = [...categories].sort((a, b) => a.position - b.position);
	const order = list?.categoryOrder;
	if (!order?.length) return global;
	const byId = new Map(global.map((c) => [c.id, c]));
	const out: Category[] = [];
	for (const id of order) {
		const c = byId.get(id);
		if (c) {
			out.push(c);
			byId.delete(id);
		}
	}
	for (const c of global) if (byId.has(c.id)) out.push(c);
	return out;
}

/** Checklist order: manual position, then creation time. */
export function sortManual(views: ItemView[]): ItemView[] {
	return [...views].sort(
		(a, b) => a.item.position - b.item.position || a.item.createdAt - b.item.createdAt
	);
}

/** Stock older than this is shown as possibly outdated. */
export const STOCK_STALE_MS = 14 * 24 * 60 * 60 * 1000;

export function stockIsStale(product: Product, now: number): boolean {
	return (
		product.stockStatus !== 'unknown' &&
		product.stockUpdatedAt !== null &&
		now - product.stockUpdatedAt > STOCK_STALE_MS
	);
}
