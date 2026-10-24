import { describe, expect, it } from 'vitest';
import { cleanName, compareNl, nameKey, searchKey } from '$lib/shared/text';
import { formatQuantity, parseEntry, quantityStep } from '$lib/shared/quantity';
import { guessCategory } from '$lib/shared/categorize';

describe('text', () => {
	it('normalises names for duplicate detection', () => {
		expect(cleanName('  Halfvolle   melk ')).toBe('Halfvolle melk');
		expect(nameKey('  HALFVOLLE   Melk ')).toBe(nameKey('halfvolle melk'));
		expect(searchKey('Crème fraîche')).toBe('creme fraiche');
	});

	it('sorts the Dutch way', () => {
		const names = ['zout', 'Éclair', 'appel', 'Banaan', 'ijs', '10 eieren', '2 eieren'];
		expect([...names].sort(compareNl)).toEqual([
			'2 eieren',
			'10 eieren',
			'appel',
			'Banaan',
			'Éclair',
			'ijs',
			'zout'
		]);
	});
});

describe('parseEntry', () => {
	it.each([
		['Melk', { name: 'Melk', quantity: null, unit: null }],
		['2 melk', { name: 'melk', quantity: 2, unit: null }],
		['500 g gehakt', { name: 'gehakt', quantity: 500, unit: 'g' }],
		['500g gehakt', { name: 'gehakt', quantity: 500, unit: 'g' }],
		['1,5 kg aardappelen', { name: 'aardappelen', quantity: 1.5, unit: 'kg' }],
		['2 liter melk', { name: 'melk', quantity: 2, unit: 'l' }],
		['3 stuks paprika', { name: 'paprika', quantity: 3, unit: null }],
		["2 rode paprika's", { name: "rode paprika's", quantity: 2, unit: null }],
		['eieren x10', { name: 'eieren', quantity: 10, unit: null }],
		['eieren 6x', { name: 'eieren', quantity: 6, unit: null }],
		['7up', { name: '7up', quantity: null, unit: null }],
		['  brood  ', { name: 'brood', quantity: null, unit: null }]
	])('%s', (input, expected) => {
		expect(parseEntry(input)).toEqual(expected);
	});

	it('formats quantities', () => {
		expect(formatQuantity(null, null)).toBe('');
		expect(formatQuantity(2, null)).toBe('2×');
		expect(formatQuantity(1.5, 'kg')).toBe('1,5 kg');
		expect(formatQuantity(null, 'pak')).toBe('pak');
		expect(quantityStep('g')).toBe(50);
		expect(quantityStep('kg')).toBe(0.5);
		expect(quantityStep(null)).toBe(1);
	});
});

describe('guessCategory', () => {
	it.each([
		['Halfvolle melk', 'cat-zuivel'],
		['Bananen', 'cat-groente'],
		['Volkorenbrood', 'cat-brood'],
		['Wc-papier', 'cat-huishouden'],
		['Shampoo', 'cat-verzorging'],
		['Rode wijn', 'cat-dranken'],
		['Diepvriespizza', 'cat-diepvries'],
		['Iets onbekends', null]
	])('%s → %s', (name, category) => {
		expect(guessCategory(name)).toBe(category);
	});
});
