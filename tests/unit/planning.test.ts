import { describe, expect, it } from 'vitest';
import {
	parseBulk,
	planEntry,
	productsForList,
	routeCategories,
	scaleBundle,
	stripBullet,
	targetListFor,
	MAX_BULK_LINES
} from '$lib/shared/planning';
import { newItem, newList, newProduct } from '$lib/shared/reducer';
import type { Bundle, Snapshot } from '$lib/shared/types';

const NOW = Date.UTC(2026, 5, 1, 12);

function snap(): Snapshot {
	const s: Snapshot = {
		seq: 1,
		epoch: 'e',
		serverTime: NOW,
		lists: [
			newList('default', 'Boodschappen', NOW, 0),
			newList('drogist', 'Drogist', NOW, 1),
			{ ...newList('todo', 'Vakantie', NOW, 2), kind: 'checklist' }
		],
		categories: [
			{ id: 'groente', name: 'Groente', position: 0, createdAt: NOW, updatedAt: NOW },
			{ id: 'zuivel', name: 'Zuivel', position: 1, createdAt: NOW, updatedAt: NOW },
			{ id: 'brood', name: 'Brood', position: 2, createdAt: NOW, updatedAt: NOW }
		],
		products: [],
		items: [],
		aiRecommendations: [],
		aliases: [],
		bundles: [],
		snoozes: [],
		rounds: [],
		claims: []
	};
	const melk = newProduct('melk', 'Melk', NOW);
	const shampoo = newProduct('shampoo', 'Shampoo', NOW);
	const eieren = { ...newProduct('eieren', 'Eieren', NOW), defaultQuantity: 10, defaultUnit: null };
	const kaas = { ...newProduct('kaas', 'Kaas', NOW), preferredListId: 'default' };
	s.products.push(melk, shampoo, eieren, kaas);
	s.aliases.push({ id: 'a1', productId: 'melk', alias: 'Halfvolle melk', createdAt: NOW });
	s.items.push(
		{ ...newItem('i-melk', 'default', 'melk', NOW), quantity: 2, unit: null },
		{ ...newItem('i-shampoo', 'drogist', 'shampoo', NOW) },
		{ ...newItem('i-eieren', 'default', 'eieren', NOW), status: 'completed', completedAt: NOW }
	);
	return s;
}

describe('planEntry', () => {
	it('detects an active duplicate (also via an alias) and offers explicit choices', () => {
		const plan = planEntry(snap(), 'default', { name: 'halfvolle melk', quantity: 1, unit: null })!;
		expect(plan.state).toBe('active');
		expect(plan.product?.id).toBe('melk');
		expect(plan.duplicate?.extra).toEqual({ quantity: 1, unit: null });
		expect(plan.duplicate?.set).toEqual({ quantity: 1, unit: null });
	});

	it('uses the usual quantity unless one is typed', () => {
		const s = snap();
		expect(planEntry(s, 'default', { name: 'eieren', quantity: null, unit: null })).toMatchObject({
			state: 'reactivate',
			quantity: 10
		});
		expect(planEntry(s, 'default', { name: 'eieren', quantity: 6, unit: null })).toMatchObject({
			quantity: 6,
			explicit: true
		});
	});

	it('reports when the product is active on another list', () => {
		const plan = planEntry(snap(), 'default', { name: 'Shampoo', quantity: null, unit: null })!;
		expect(plan.state).toBe('new');
		expect(plan.elsewhere.map((e) => e.list.name)).toEqual(['Drogist']);
	});

	it('returns null for an empty name', () => {
		expect(planEntry(snap(), 'default', { name: '  ', quantity: null, unit: null })).toBeNull();
	});
});

describe('parseBulk', () => {
	it('strips bullets, numbering and checkboxes but never splits on commas', () => {
		expect(stripBullet('- [ ] melk')).toBe('melk');
		expect(stripBullet('3. brood')).toBe('brood');
		expect(stripBullet('• 2 kg aardappelen')).toBe('2 kg aardappelen');
		const { lines } = parseBulk('- kaas, jong belegen\n\n2 melk\n* 500 g gehakt\n1,5 kg uien');
		expect(lines.map((l) => [l.name, l.quantity, l.unit])).toEqual([
			['Kaas, jong belegen', null, null],
			['Melk', 2, null],
			['Gehakt', 500, 'g'],
			['Uien', 1.5, 'kg']
		]);
	});

	it('flags duplicates within the input (including aliases) and invalid lines', () => {
		const { lines } = parseBulk(`melk\nHalfvolle melk\n- \n${'x'.repeat(90)}`, snap());
		expect(lines[0].duplicateOf).toBeNull();
		expect(lines[1].duplicateOf).toBe(0);
		expect(lines[1].name).toBe('Melk');
		expect(lines.some((l) => l.error === 'Langer dan 80 tekens')).toBe(true);
	});

	it('limits the number of lines', () => {
		const text = Array.from({ length: MAX_BULK_LINES + 5 }, (_, i) => `product ${i}`).join('\n');
		const parsed = parseBulk(text);
		expect(parsed.lines).toHaveLength(MAX_BULK_LINES);
		expect(parsed.truncated).toBe(5);
	});
});

describe('scaleBundle', () => {
	const bundle: Bundle = {
		id: 'b',
		name: 'Lasagne',
		servings: 4,
		createdAt: NOW,
		updatedAt: NOW,
		version: 1,
		lines: [
			{ id: 'l1', productId: 'gehakt', quantity: 500, unit: 'g', note: null },
			{ id: 'l2', productId: 'tomaten', quantity: 1, unit: 'blik', note: null },
			{ id: 'l3', productId: 'kaas', quantity: null, unit: null, note: null }
		]
	};

	it('scales weights exactly and rounds counted units up with the exact value kept', () => {
		const lines = scaleBundle(bundle, 6);
		expect(lines[0]).toMatchObject({ quantity: 750, unit: 'g', exact: null });
		expect(lines[1]).toMatchObject({ quantity: 2, unit: 'blik', exact: 1.5 });
		expect(lines[2]).toMatchObject({ quantity: null, exact: null });
	});

	it('keeps quantities without servings', () => {
		expect(scaleBundle({ ...bundle, servings: null }, 6)[0].quantity).toBe(500);
	});
});

describe('list-aware suggestions and route', () => {
	it('follows preferred list, then item rows, then all grocery lists; never checklists', () => {
		const s = snap();
		s.products.push(newProduct('nieuw', 'Nieuw', NOW));
		const main = productsForList(s, 'default');
		const drog = productsForList(s, 'drogist');
		expect([...main].sort()).toEqual(['eieren', 'kaas', 'melk', 'nieuw']);
		expect([...drog].sort()).toEqual(['nieuw', 'shampoo']);
		expect(productsForList(s, 'todo').size).toBe(0);
	});

	it('picks the target list for a product', () => {
		const s = snap();
		expect(
			targetListFor(
				s,
				s.products.find((p) => p.id === 'kaas')!,
				'drogist'
			)
		).toBe('default');
		expect(
			targetListFor(
				s,
				s.products.find((p) => p.id === 'melk')!,
				'todo'
			)
		).toBe('default');
	});

	it('orders categories by the list route with the global order as fallback', () => {
		const s = snap();
		const list = { ...s.lists[0], categoryOrder: ['brood', 'groente'] };
		expect(routeCategories(s.categories, list).map((c) => c.id)).toEqual([
			'brood',
			'groente',
			'zuivel'
		]);
		expect(routeCategories(s.categories, s.lists[1]).map((c) => c.id)).toEqual([
			'groente',
			'zuivel',
			'brood'
		]);
	});
});
