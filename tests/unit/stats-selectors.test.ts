import { describe, expect, it } from 'vitest';
import { computeStats, DAY, isSuggested, MIN_HISTORY, purchaseTrips } from '$lib/shared/stats';
import {
	autocomplete,
	frequent,
	groupByCategory,
	productViews,
	sortActive,
	suggestions,
	type ItemView
} from '$lib/shared/selectors';
import type { Item, Product, Snapshot } from '$lib/shared/types';
import { newItem, newList, newProduct } from '$lib/shared/reducer';

const NOW = Date.UTC(2026, 5, 1, 12);

describe('statistics', () => {
	it('merges completions of one trip', () => {
		expect(purchaseTrips([NOW, NOW + 60_000, NOW + DAY])).toEqual([NOW, NOW + DAY]);
	});

	it('computes interval, frequency and next estimate', () => {
		const completions = [0, 1, 2, 3].map((i) => NOW - (21 - i * 7) * DAY);
		const s = computeStats(completions, 4, NOW);
		expect(s.purchaseCount).toBe(4);
		expect(s.avgIntervalDays).toBeCloseTo(7);
		expect(s.perMonth).toBeCloseTo(30 / 7);
		expect(s.lastPurchasedAt).toBe(NOW);
		expect(s.nextEstimatedAt).toBe(NOW + 7 * DAY);
		expect(s.dueRatio).toBeCloseTo(0);
		expect(s.recentCount).toBe(4);
		expect(isSuggested(s)).toBe(false);
	});

	it('requires a minimum history before estimating', () => {
		const two = [NOW - 14 * DAY, NOW - 7 * DAY];
		const s = computeStats(two, 2, NOW);
		expect(MIN_HISTORY).toBe(3);
		expect(s.avgIntervalDays).toBeCloseTo(7);
		expect(s.hasEnoughHistory).toBe(false);
		expect(s.nextEstimatedAt).toBeNull();
		expect(isSuggested(s)).toBe(false);
	});

	it('suggests when due and stops suggesting when habits changed', () => {
		const weekly = (lastDaysAgo: number) =>
			computeStats(
				[3, 2, 1, 0].map((i) => NOW - (lastDaysAgo + i * 7) * DAY),
				4,
				NOW
			);
		expect(isSuggested(weekly(3))).toBe(false);
		expect(isSuggested(weekly(6))).toBe(true);
		expect(isSuggested(weekly(10))).toBe(true);
		expect(isSuggested(weekly(40))).toBe(false);
	});

	it('uses the all-time first purchase date when known', () => {
		const s = computeStats([NOW - DAY], 10, NOW, NOW - 300 * DAY);
		expect(s.firstPurchasedAt).toBe(NOW - 300 * DAY);
		expect(s.purchaseCount).toBe(10);
	});
});

function product(id: string, name: string, extra: Partial<Product> = {}): Product {
	return { ...newProduct(id, name, 0), ...extra };
}

function item(id: string, productId: string, activatedAt: number, extra: Partial<Item> = {}): Item {
	return { ...newItem(id, 'l', productId, activatedAt), createdAt: 0, updatedAt: 0, ...extra };
}

describe('selectors', () => {
	const views: ItemView[] = [
		{ item: item('1', 'a', 300), product: product('a', 'Zout', { categoryId: 'c2' }) },
		{ item: item('2', 'b', 100), product: product('b', 'appel', { categoryId: 'c1' }) },
		{ item: item('3', 'c', 200), product: product('c', 'Éclair') }
	];

	it('sorts newest, oldest and A–Z', () => {
		const names = (m: 'newest' | 'oldest' | 'az') =>
			sortActive(views, m).map((v) => v.product.name);
		expect(names('newest')).toEqual(['Zout', 'Éclair', 'appel']);
		expect(names('oldest')).toEqual(['appel', 'Éclair', 'Zout']);
		expect(names('az')).toEqual(['appel', 'Éclair', 'Zout']);
	});

	it('groups by configured category order with uncategorised last', () => {
		const groups = groupByCategory(views, [
			{ id: 'c2', name: 'Houdbaar', position: 0, createdAt: 0, updatedAt: 0 },
			{ id: 'c1', name: 'Fruit', position: 1, createdAt: 0, updatedAt: 0 }
		]);
		expect(groups.map((g) => g.category?.name ?? null)).toEqual(['Houdbaar', 'Fruit', null]);
	});

	const weekly = [3, 2, 1, 0].map((i) => NOW - (8 + i * 7) * DAY);
	const snap: Snapshot = {
		seq: 1,
		epoch: 'e1',
		serverTime: NOW,
		lists: [newList('l', 'L', 0)],
		categories: [],
		products: [
			product('m', 'Melk', { completions: weekly, purchaseCount: 4 }),
			product('mk', 'Melkchocolade', { favorite: true }),
			product('km', 'Karnemelk', { completions: [NOW - DAY, NOW - 3 * DAY], purchaseCount: 2 }),
			product('b', 'Brood')
		],
		items: [item('x', 'b', NOW)],
		aiRecommendations: [],
		aliases: [],
		bundles: [],
		snoozes: [],
		rounds: [],
		claims: [],
		settings: { suggestionsEnabled: true, bulkAddEnabled: true, language: 'nl' }
	};

	it('autocompletes prefix matches first and skips exact active duplicates', () => {
		const pv = productViews(snap, 'l', NOW);
		expect(autocomplete(pv, 'mel').map((v) => v.product.name)).toEqual([
			'Melk',
			'Melkchocolade',
			'Karnemelk'
		]);
		expect(autocomplete(pv, 'brood')).toHaveLength(0);
		expect(autocomplete(pv, '')).toHaveLength(0);
	});

	it('lists due suggestions, frequent and respects snoozing', () => {
		const pv = productViews(snap, 'l', NOW);
		expect(suggestions(pv, {}, NOW).map((v) => v.product.id)).toEqual(['m']);
		expect(suggestions(pv, { m: NOW + DAY }, NOW)).toHaveLength(0);
		expect(frequent(pv).map((v) => v.product.id)).toEqual(['m', 'km']);
	});
});
