import type { GroceryStore } from './store';
import { computeStats } from '$lib/shared/stats';

/** CSV with `;` separator and a UTF-8 BOM so Dutch Excel opens it correctly. */
export function toCsv(header: string[], rows: unknown[][]): string {
	const cell = (v: unknown) => {
		if (v === null || v === undefined) return '';
		const s = String(v);
		return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

const iso = (t: unknown) => (typeof t === 'number' ? new Date(t).toISOString() : '');
const num = (n: number | null) =>
	n === null ? '' : String(Math.round(n * 10) / 10).replace('.', ',');

export function exportJson(store: GroceryStore, version: string, now = Date.now()) {
	const data = store.exportAll();
	const snapshot = store.snapshot(now);
	return {
		app: '8star-grocery-list',
		version,
		exportedAt: new Date(now).toISOString(),
		...data,
		statistics: snapshot.products.map((p) => ({
			productId: p.id,
			name: p.name,
			...computeStats(p.completions, p.purchaseCount, now, p.firstCompletedAt)
		}))
	};
}

export function exportPurchasesCsv(store: GroceryStore): string {
	const { cycles, products, lists, categories } = store.exportAll() as {
		cycles: Record<string, unknown>[];
		products: Record<string, unknown>[];
		lists: Record<string, unknown>[];
		categories: Record<string, unknown>[];
	};
	const productById = new Map(products.map((p) => [p.id, p]));
	const listById = new Map(lists.map((l) => [l.id, l]));
	const catById = new Map(categories.map((c) => [c.id, c]));
	const rows = cycles.map((c) => {
		const p = productById.get(c.product_id);
		const status = c.completed_at ? 'gekocht' : c.cancelled_at ? 'geannuleerd' : 'open';
		return [
			p?.name,
			p?.category_id ? catById.get(p.category_id)?.name : '',
			c.list_id ? listById.get(c.list_id)?.name : '',
			status,
			iso(c.activated_at),
			iso(c.completed_at),
			iso(c.cancelled_at),
			c.quantity === null ? '' : String(c.quantity).replace('.', ','),
			c.unit
		];
	});
	return toCsv(
		[
			'product',
			'categorie',
			'lijst',
			'status',
			'geactiveerd',
			'gekocht',
			'geannuleerd',
			'aantal',
			'eenheid'
		],
		rows
	);
}

export function exportProductsCsv(store: GroceryStore, now = Date.now()): string {
	const snapshot = store.snapshot(now);
	const catById = new Map(snapshot.categories.map((c) => [c.id, c.name]));
	const rows = snapshot.products.map((p) => {
		const s = computeStats(p.completions, p.purchaseCount, now, p.firstCompletedAt);
		return [
			p.name,
			p.categoryId ? catById.get(p.categoryId) : '',
			p.favorite ? 'ja' : 'nee',
			iso(p.createdAt),
			s.purchaseCount,
			iso(s.lastPurchasedAt),
			num(s.avgIntervalDays),
			num(s.perMonth),
			iso(s.nextEstimatedAt)
		];
	});
	return toCsv(
		[
			'product',
			'categorie',
			'favoriet',
			'aangemaakt',
			'aantal_keer_gekocht',
			'laatst_gekocht',
			'gem_interval_dagen',
			'per_maand',
			'volgende_verwacht'
		],
		rows
	);
}
