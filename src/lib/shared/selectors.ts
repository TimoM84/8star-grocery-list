/** Pure view selectors: sorting, grouping, autocomplete and suggestions. */

import type { Category, Item, Product, Snapshot, SortMode } from './types';
import { compareNl, nameKey, searchKey } from './text';
import { computeStats, frequencyScore, isSuggested, type ProductStats } from './stats';

export interface ItemView {
	item: Item;
	product: Product;
}

export function itemViews(s: Snapshot, listId: string): ItemView[] {
	const byId = new Map(s.products.map((p) => [p.id, p]));
	const out: ItemView[] = [];
	for (const item of s.items) {
		if (item.listId !== listId) continue;
		const product = byId.get(item.productId);
		if (product) out.push({ item, product });
	}
	return out;
}

export function sortActive(views: ItemView[], mode: SortMode): ItemView[] {
	const arr = [...views];
	if (mode === 'az') arr.sort((a, b) => compareNl(a.product.name, b.product.name));
	else if (mode === 'oldest')
		arr.sort(
			(a, b) => a.item.activatedAt - b.item.activatedAt || compareNl(a.product.name, b.product.name)
		);
	else
		arr.sort(
			(a, b) => b.item.activatedAt - a.item.activatedAt || compareNl(a.product.name, b.product.name)
		);
	return arr;
}

/** Completed items: most recently completed first. */
export function sortCompleted(views: ItemView[]): ItemView[] {
	return [...views].sort((a, b) => (b.item.completedAt ?? 0) - (a.item.completedAt ?? 0));
}

export interface CategoryGroup {
	category: Category | null;
	items: ItemView[];
}

/** Groups (already sorted) items by category in the configured category order. */
export function groupByCategory(views: ItemView[], categories: Category[]): CategoryGroup[] {
	const ordered = [...categories].sort((a, b) => a.position - b.position);
	const groups = new Map<string | null, ItemView[]>();
	for (const v of views) {
		const key =
			v.product.categoryId && ordered.some((c) => c.id === v.product.categoryId)
				? v.product.categoryId
				: null;
		const arr = groups.get(key);
		if (arr) arr.push(v);
		else groups.set(key, [v]);
	}
	const out: CategoryGroup[] = [];
	for (const c of ordered) {
		const items = groups.get(c.id);
		if (items) out.push({ category: c, items });
	}
	const none = groups.get(null);
	if (none) out.push({ category: null, items: none });
	return out;
}

export interface ProductView {
	product: Product;
	stats: ProductStats;
	/** Status on the given list, if present. */
	status: 'active' | 'completed' | null;
}

export function productViews(s: Snapshot, listId: string | null, now: number): ProductView[] {
	const status = new Map<string, 'active' | 'completed'>();
	if (listId) for (const i of s.items) if (i.listId === listId) status.set(i.productId, i.status);
	return s.products.map((product) => ({
		product,
		stats: computeStats(product.completions, product.purchaseCount, now, product.firstCompletedAt),
		status: status.get(product.id) ?? null
	}));
}

/** Autocomplete: prefix matches first, then word/substring matches; favourites and frequent first. */
export function autocomplete(views: ProductView[], query: string, limit = 6): ProductView[] {
	const q = searchKey(query);
	if (!q) return [];
	const scored: { v: ProductView; score: number }[] = [];
	for (const v of views) {
		const key = searchKey(v.product.name);
		if (key === q && v.status === 'active') continue;
		let score: number;
		if (key.startsWith(q)) score = 300;
		else if (key.split(/[\s-]+/).some((w) => w.startsWith(q))) score = 200;
		else if (key.includes(q)) score = 100;
		else continue;
		// Prefer exact and short matches, then frequently/recently bought and favourites.
		if (key === q) score += 50;
		score -= Math.min(key.length - q.length, 20);
		score +=
			Math.min(v.stats.purchaseCount, 50) + v.stats.recentCount * 3 + (v.product.favorite ? 15 : 0);
		if (v.status === 'active') score -= 250;
		scored.push({ v, score });
	}
	scored.sort((a, b) => b.score - a.score || compareNl(a.v.product.name, b.v.product.name));
	return scored.slice(0, limit).map((x) => x.v);
}

export function searchProducts(views: ProductView[], query: string): ProductView[] {
	const q = searchKey(query);
	if (!q) return views;
	return views.filter((v) => searchKey(v.product.name).includes(q));
}

/** "Misschien nodig": due by local statistics and not already active on the list. */
export function suggestions(
	views: ProductView[],
	snoozed: Record<string, number> = {},
	now = Date.now()
): ProductView[] {
	return views
		.filter(
			(v) => v.status !== 'active' && isSuggested(v.stats) && !((snoozed[v.product.id] ?? 0) > now)
		)
		.sort((a, b) => (b.stats.dueRatio ?? 0) - (a.stats.dueRatio ?? 0));
}

export function frequent(views: ProductView[], limit = 20): ProductView[] {
	return views
		.filter((v) => v.stats.purchaseCount >= 2)
		.sort(
			(a, b) =>
				frequencyScore(b.stats) - frequencyScore(a.stats) ||
				compareNl(a.product.name, b.product.name)
		)
		.slice(0, limit);
}

export function favorites(views: ProductView[]): ProductView[] {
	return views.filter((v) => v.product.favorite);
}

export function findProductByName(s: Snapshot, name: string): Product | undefined {
	const key = nameKey(name);
	return s.products.find((p) => nameKey(p.name) === key);
}

export function activeCount(s: Snapshot, listId: string): number {
	return s.items.reduce((n, i) => n + (i.listId === listId && i.status === 'active' ? 1 : 0), 0);
}
