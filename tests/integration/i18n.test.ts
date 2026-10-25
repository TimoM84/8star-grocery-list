import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '$lib/server/db';
import { GroceryStore } from '$lib/server/store';
import { buildExport } from '$lib/server/transfer/format';
import { runImport, type ImportMode } from '$lib/server/transfer/importer';
import { aiPrompt } from '$lib/server/transfer/ai-prompt';
import {
	DEFAULT_LANGUAGE,
	LANGUAGES,
	messagesFor,
	seededCategoryName,
	seededListName
} from '$lib/shared/i18n';
import { en } from '$lib/shared/i18n/en';
import { parseOp, type Op, type OpPayload } from '$lib/shared/ops';
import { formatQuantity, parseEntry } from '$lib/shared/quantity';

const T0 = Date.UTC(2026, 9, 1, 10);
let n = 0;

function makeStore() {
	return new GroceryStore(openDatabase(':memory:'));
}

function apply(store: GroceryStore, payload: OpPayload, at = T0) {
	const op = { id: `op-${++n}`, at, ...payload } as Op;
	return store.applyOps('test', [op], at).results[0];
}

function importJson(store: GroceryStore, text: string, mode: ImportMode) {
	return runImport(store, {
		kind: 'json',
		mode,
		text,
		preview: false,
		backupDir: fs.mkdtempSync(path.join(os.tmpdir(), '8star-i18n-')),
		now: T0
	});
}

/** Every leaf of a dictionary, as [path, value]. */
function leaves(obj: object, prefix = ''): [string, unknown][] {
	return Object.entries(obj).flatMap(([k, v]) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? leaves(v, `${prefix}${k}.`)
			: [[`${prefix}${k}`, v] as [string, unknown]]
	);
}

describe('dictionaries', () => {
	const reference = new Map(leaves(en));

	it.each(LANGUAGES)('%s has every message with the same shape as English', (lang) => {
		const dict = new Map(leaves(messagesFor(lang)));
		for (const [key, value] of reference) {
			// Unit names are optional: a missing one is shown as stored.
			if (/^units(Plural)?\./.test(key)) continue;
			expect(dict.has(key), `${lang}: ${key}`).toBe(true);
			const other = dict.get(key);
			expect(typeof other, `${lang}: ${key}`).toBe(typeof value);
			if (Array.isArray(value)) expect((other as unknown[]).length, key).toBe(value.length);
			if (typeof value === 'function')
				expect((other as (...a: unknown[]) => unknown).length, `${lang}: ${key}`).toBe(
					value.length
				);
		}
		for (const key of dict.keys())
			if (!/^units(Plural)?\./.test(key))
				expect(reference.has(key), `${lang}: extra ${key}`).toBe(true);
	});

	it.each(LANGUAGES.filter((l) => l !== 'en'))('%s is really translated', (lang) => {
		const m = messagesFor(lang);
		expect(m).not.toBe(en);
		expect(m.nav.list).not.toBe(en.nav.list);
		expect(m.settings.language).not.toBe(en.settings.language);
		expect(m.server.listGone).not.toBe(en.server.listGone);
	});
});

describe('household language', () => {
	it('defaults to English, also for existing installations', () => {
		expect(DEFAULT_LANGUAGE).toBe('en');
		expect(makeStore().snapshot().settings.language).toBe('en');
	});

	it('is changed with settings.update and follows into server messages', () => {
		const s = makeStore();
		const english = apply(s, { type: 'list.delete', listId: 'default' });
		expect(english.message).toBe('The last list cannot be deleted.');

		expect(apply(s, { type: 'settings.update', language: 'nl' }).status).toBe('applied');
		expect(s.snapshot().settings).toEqual({ aiEnabled: true, language: 'nl' });
		expect(apply(s, { type: 'list.delete', listId: 'default' }).message).toBe(
			'De laatste lijst kan niet worden verwijderd.'
		);

		apply(s, { type: 'settings.update', language: 'de' });
		expect(apply(s, { type: 'list.delete', listId: 'default' }).message).toBe(
			messagesFor('de').server.lastList
		);
	});

	it('validates the language in the op and needs at least one change', () => {
		const base = { id: 'o', at: T0, type: 'settings.update' };
		expect(parseOp({ ...base, language: 'fr' })).toMatchObject({ language: 'fr' });
		expect(() => parseOp({ ...base, language: 'xx' })).toThrow();
		expect(() => parseOp(base)).toThrow();
		// Changing only the language leaves the AI setting alone.
		const s = makeStore();
		apply(s, { type: 'settings.update', aiEnabled: false });
		apply(s, { type: 'settings.update', language: 'es' });
		expect(s.snapshot().settings).toEqual({ aiEnabled: false, language: 'es' });
	});

	it('travels in the export; a replace restores it, a merge leaves it', () => {
		const source = makeStore();
		apply(source, { type: 'settings.update', language: 'fr' });
		const file = JSON.stringify(buildExport(source.db, 'test'));
		expect(JSON.parse(file).data.settings.language).toBe('fr');

		const merged = makeStore();
		const report = importJson(merged, file, 'merge');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(merged.snapshot().settings.language).toBe('en');
		expect(report.summary).toContain(en.import.languageNotApplied);

		const replaced = makeStore();
		const restore = importJson(replaced, file, 'replace');
		expect(restore.ok, restore.errors.join('\n')).toBe(true);
		expect(replaced.snapshot().settings.language).toBe('fr');
		expect(restore.summary.join('\n')).toContain('Français');
	});

	it('rejects an unknown language in an import file', () => {
		const file = buildExport(makeStore().db, 'test') as unknown as {
			data: { settings: unknown };
		};
		file.data.settings = { aiEnabled: true, language: 'klingon' };
		const report = importJson(makeStore(), JSON.stringify(file), 'replace');
		expect(report.ok).toBe(false);
		expect(report.errors.join('\n')).toMatch(/settings\.language/);
	});

	it('asks the AI for explanations in the household language', () => {
		expect(aiPrompt('nl')).toMatch(/uitleg in het Nederlands/);
		expect(aiPrompt('en')).toMatch(/explanation in English/);
		expect(aiPrompt('de')).toMatch(/explanation in German/);
		expect(aiPrompt('de')).toContain(messagesFor('de').ai.importOpen);
	});
});

describe('seeded names and units', () => {
	it('shows the seeded Dutch names translated while they are unchanged', () => {
		const de = messagesFor('de');
		expect(seededListName('default', 'Boodschappen', en)).toBe(en.seeded.lists.default);
		expect(seededListName('default', 'Weekmenu', en)).toBe('Weekmenu');
		expect(seededListName('other', 'Boodschappen', en)).toBe('Boodschappen');
		expect(seededCategoryName('cat-groente', 'Groente & fruit', de)).toBe(
			de.seeded.categories['cat-groente']
		);
		expect(seededCategoryName('cat-groente', 'Groenten', de)).toBe('Groenten');
	});

	it('reads units in every language and shows them translated', () => {
		expect(parseEntry('2 bottles cola')).toEqual({ name: 'cola', quantity: 2, unit: 'fles' });
		expect(parseEntry('3 Flaschen Wasser')).toEqual({ name: 'Wasser', quantity: 3, unit: 'fles' });
		expect(parseEntry('1 paquet riz')).toEqual({ name: 'riz', quantity: 1, unit: 'pak' });
		expect(parseEntry('2 latas atún')).toEqual({ name: 'atún', quantity: 2, unit: 'blik' });
		expect(parseEntry('1.5 kg potatoes')).toEqual({ name: 'potatoes', quantity: 1.5, unit: 'kg' });
		const english = { units: en.units, unitsPlural: en.unitsPlural, decimal: '.' };
		expect(formatQuantity(2, 'fles', english)).toBe('2 bottles');
		expect(formatQuantity(1, 'fles', english)).toBe('1 bottle');
		expect(formatQuantity(1.5, 'kg', { units: en.units, decimal: '.' })).toBe('1.5 kg');
		expect(formatQuantity(1.5, 'kg')).toBe('1,5 kg');
		expect(formatQuantity(2, 'fles', { units: messagesFor('nl').units })).toBe('2 fles');
	});
});
