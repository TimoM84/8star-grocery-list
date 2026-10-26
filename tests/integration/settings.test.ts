import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '$lib/server/db';
import { GroceryStore } from '$lib/server/store';
import { SyncEngine, type Storage } from '$lib/client/sync';
import type { PendingRecord } from '$lib/client/idb';
import { buildExport } from '$lib/server/transfer/format';
import { runImport, type ImportMode } from '$lib/server/transfer/importer';
import { applyOps, cloneSnapshot } from '$lib/shared/reducer';
import { parseOp, type Op, type OpPayload } from '$lib/shared/ops';
import { DEFAULT_SETTINGS, LEGACY_AI_KEY } from '$lib/shared/settings';
import type { Snapshot } from '$lib/shared/types';

const T0 = Date.UTC(2026, 9, 1, 10);
let n = 0;

function makeStore(file = ':memory:') {
	return new GroceryStore(openDatabase(file));
}

function apply(store: GroceryStore, payload: OpPayload, at = T0) {
	const op = { id: `op-${++n}`, at, ...payload } as Op;
	return store.applyOps('test', [op], at).results[0];
}

const setSuggestions = (store: GroceryStore, suggestionsEnabled: boolean) =>
	apply(store, { type: 'settings.update', suggestionsEnabled });
const setBulkAdd = (store: GroceryStore, bulkAddEnabled: boolean) =>
	apply(store, { type: 'settings.update', bulkAddEnabled });

/** Writes the pre-v1.5 "AI-functies tonen" row as v1.3/v1.4 left it in the database. */
function setLegacyAi(store: GroceryStore, on: boolean) {
	store.db
		.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
		.run(LEGACY_AI_KEY, JSON.stringify(on));
}

/** A store with one product and one open AI recommendation. */
function storeWithRecommendation() {
	const s = makeStore();
	apply(s, {
		type: 'item.add',
		itemId: 'i-melk',
		productId: 'p-melk',
		listId: 'default',
		name: 'Melk',
		quantity: null,
		unit: null,
		categoryId: null
	});
	const r = importFile(
		s,
		'ai',
		JSON.stringify({
			format: '8star-ai-recommendations',
			formatVersion: 1,
			recommendations: [{ productId: 'p-melk', confidence: 0.8, reasoning: 'Elke week.' }]
		})
	);
	expect(r.ok, r.errors.join('\n')).toBe(true);
	return s;
}

function importFile(
	store: GroceryStore,
	kind: 'json' | 'ai',
	text: string,
	mode: ImportMode = 'merge',
	preview = false
) {
	return runImport(store, {
		kind,
		mode,
		text,
		preview,
		backupDir: fs.mkdtempSync(path.join(os.tmpdir(), '8star-settings-')),
		now: T0
	});
}

describe('settings.update op', () => {
	it('defaults to everything shown, so existing installations keep their behaviour', () => {
		expect(DEFAULT_SETTINGS.suggestionsEnabled).toBe(true);
		expect(DEFAULT_SETTINGS.bulkAddEnabled).toBe(true);
		expect(makeStore().snapshot().settings).toEqual({
			suggestionsEnabled: true,
			bulkAddEnabled: true,
			language: 'en'
		});
	});

	it('switches suggestions off and on, shared through the snapshot, and is a no-op when unchanged', () => {
		const s = makeStore();
		const seq = s.seq;
		expect(setSuggestions(s, false).status).toBe('applied');
		expect(s.seq).toBe(seq + 1);
		expect(s.snapshot().settings.suggestionsEnabled).toBe(false);
		const again = setSuggestions(s, false);
		expect(again).toMatchObject({ status: 'noop', reason: 'unchanged' });
		expect(s.seq).toBe(seq + 1);
		expect(setSuggestions(s, true).status).toBe('applied');
		expect(s.snapshot().settings.suggestionsEnabled).toBe(true);
	});

	it('is idempotent per op id', () => {
		const s = makeStore();
		const op = { id: 'same', at: T0, type: 'settings.update', suggestionsEnabled: false } as Op;
		expect(s.applyOps('a', [op], T0).results[0].status).toBe('applied');
		setSuggestions(s, true);
		// A resent op returns the stored result and does not switch AI off again.
		expect(s.applyOps('a', [op], T0).results[0].status).toBe('applied');
		expect(s.snapshot().settings.suggestionsEnabled).toBe(true);
	});

	it('persists across a server restart', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), '8star-settings-db-'));
		const file = path.join(dir, 'db.sqlite');
		const a = makeStore(file);
		setSuggestions(a, false);
		a.db.close();
		expect(makeStore(file).snapshot().settings.suggestionsEnabled).toBe(false);
	});

	it('never deletes data: AI recommendations are kept and come back when switched on', () => {
		const s = storeWithRecommendation();
		setSuggestions(s, false);
		expect(s.snapshot().aiRecommendations).toHaveLength(1);
		setSuggestions(s, true);
		expect(s.snapshot().aiRecommendations).toHaveLength(1);
	});

	it('rejects malformed values', () => {
		for (const key of ['suggestionsEnabled', 'bulkAddEnabled', 'aiEnabled'])
			expect(() => parseOp({ id: 'x', at: T0, type: 'settings.update', [key]: 'nee' })).toThrow(
				new RegExp(key)
			);
		expect(() => parseOp({ id: 'x', at: T0, type: 'settings.update' })).toThrow();
		const r = makeStore().applyOps('a', [{ id: 'bad', at: T0, type: 'settings.update' }], T0);
		expect(r.results[0].status).toBe('rejected');
	});
});

describe('"Suggesties tonen" takes over "AI-functies tonen"', () => {
	it('a household that had AI switched off gets all suggestions switched off', () => {
		const s = makeStore();
		setLegacyAi(s, false);
		expect(s.snapshot().settings.suggestionsEnabled).toBe(false);
		// Unchanged until someone flips the new switch, which then wins over the old row.
		expect(setSuggestions(s, false)).toMatchObject({ status: 'noop', reason: 'unchanged' });
		expect(setSuggestions(s, true).status).toBe('applied');
		expect(s.snapshot().settings.suggestionsEnabled).toBe(true);
		setLegacyAi(s, false);
		expect(s.snapshot().settings.suggestionsEnabled).toBe(true);
	});

	it('a household that had AI on keeps suggestions on', () => {
		const s = makeStore();
		setLegacyAi(s, true);
		expect(s.snapshot().settings.suggestionsEnabled).toBe(true);
	});

	it('accepts the old op field from a device that has not updated yet', () => {
		const op = parseOp({ id: 'x', at: T0, type: 'settings.update', aiEnabled: false });
		expect(op).toMatchObject({ type: 'settings.update', suggestionsEnabled: false });
		const s = makeStore();
		expect(s.applyOps('old', [op], T0).results[0].status).toBe('applied');
		expect(s.snapshot().settings.suggestionsEnabled).toBe(false);
	});

	it('restores the old setting from a v1.3/v1.4 export', () => {
		const file = buildExport(makeStore().db, 'test') as unknown as {
			data: { settings: unknown };
		};
		file.data.settings = { aiEnabled: false, language: 'en' };
		const target = makeStore();
		const report = importFile(target, 'json', JSON.stringify(file), 'replace');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(target.snapshot().settings).toEqual({
			suggestionsEnabled: false,
			bulkAddEnabled: true,
			language: 'en'
		});
	});
});

describe('"Meerdere toevoegen tonen"', () => {
	it('switches off and on independently of the other settings, and persists', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), '8star-settings-db-'));
		const file = path.join(dir, 'db.sqlite');
		const a = makeStore(file);
		expect(setBulkAdd(a, false).status).toBe('applied');
		expect(setBulkAdd(a, false)).toMatchObject({ status: 'noop', reason: 'unchanged' });
		expect(a.snapshot().settings).toEqual({
			suggestionsEnabled: true,
			bulkAddEnabled: false,
			language: 'en'
		});
		a.db.close();
		const b = makeStore(file);
		expect(b.snapshot().settings.bulkAddEnabled).toBe(false);
		expect(setBulkAdd(b, true).status).toBe('applied');
		expect(b.snapshot().settings.bulkAddEnabled).toBe(true);
	});

	it('a replace restores it and reports it, a merge leaves it and says so', () => {
		const source = makeStore();
		setBulkAdd(source, false);
		const file = JSON.stringify(buildExport(source.db, 'test'));

		const replaced = makeStore();
		const report = importFile(replaced, 'json', file, 'replace');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(report.summary).toContain('“Add several” hidden (setting from the file)');
		expect(replaced.snapshot().settings.bulkAddEnabled).toBe(false);

		const merged = makeStore();
		const merge = importFile(merged, 'json', file, 'merge');
		expect(merge.ok, merge.errors.join('\n')).toBe(true);
		expect(merged.snapshot().settings.bulkAddEnabled).toBe(true);
		expect(merge.summary.join('\n')).toContain('The “Add several” setting from the file');
	});

	it('an export without the setting stays importable and keeps the current value', () => {
		const file = buildExport(makeStore().db, 'test') as unknown as {
			data: { settings: Record<string, unknown> };
		};
		delete file.data.settings.bulkAddEnabled;
		const target = makeStore();
		setBulkAdd(target, false);
		const report = importFile(target, 'json', JSON.stringify(file), 'replace');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(target.snapshot().settings.bulkAddEnabled).toBe(false);
	});

	it('rejects an invalid value in an import file', () => {
		const file = buildExport(makeStore().db, 'test') as unknown as {
			data: { settings: unknown };
		};
		file.data.settings = { bulkAddEnabled: 'nee' };
		const report = importFile(makeStore(), 'json', JSON.stringify(file), 'replace');
		expect(report.ok).toBe(false);
		expect(report.errors.join('\n')).toContain('settings.bulkAddEnabled');
	});
});

describe('optimistic reducer', () => {
	it('applies the setting locally and fills it in for snapshots cached by older versions', () => {
		const snap = makeStore().snapshot();
		const old = { ...snap } as Partial<Snapshot>;
		delete old.settings;
		const cloned = cloneSnapshot(old as Snapshot);
		expect(cloned.settings).toEqual({
			suggestionsEnabled: true,
			bulkAddEnabled: true,
			language: 'en'
		});
		const op = { id: 'o', at: T0, type: 'settings.update', suggestionsEnabled: false } as Op;
		expect(applyOps(cloned, [op], new Map()).settings.suggestionsEnabled).toBe(false);
		// A snapshot cached by v1.3/v1.4 and an op still queued by that version.
		const cached = cloneSnapshot({
			...snap,
			settings: { aiEnabled: false }
		} as unknown as Snapshot);
		expect(cached.settings.suggestionsEnabled).toBe(false);
		const queued = { id: 'q', at: T0, type: 'settings.update', aiEnabled: true } as unknown as Op;
		expect(applyOps(cached, [queued], new Map()).settings.suggestionsEnabled).toBe(true);
	});
});

describe('export and import', () => {
	it('exports the settings', () => {
		const s = makeStore();
		setSuggestions(s, false);
		setBulkAdd(s, false);
		expect(buildExport(s.db, 'test').data.settings).toEqual({
			suggestionsEnabled: false,
			bulkAddEnabled: false,
			language: 'en'
		});
	});

	it('a full replace restores the setting from the file and reports it', () => {
		const source = storeWithRecommendation();
		setSuggestions(source, false);
		const file = JSON.stringify(buildExport(source.db, 'test'));
		const target = makeStore();

		const preview = importFile(target, 'json', file, 'replace', true);
		expect(preview.ok, preview.errors.join('\n')).toBe(true);
		expect(preview.summary).toContain('Suggestions will be hidden (setting from the file)');
		expect(target.snapshot().settings.suggestionsEnabled).toBe(true);

		const report = importFile(target, 'json', file, 'replace');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(report.summary).toContain('Suggestions hidden (setting from the file)');
		const snap = target.snapshot();
		expect(snap.settings.suggestionsEnabled).toBe(false);
		// The AI data in the file is restored as well, just hidden.
		expect(snap.aiRecommendations).toHaveLength(1);
	});

	it('a replace with an older file without settings keeps the current setting', () => {
		const source = makeStore();
		const file = buildExport(source.db, 'test');
		delete file.data.settings;
		const target = makeStore();
		setSuggestions(target, false);
		const report = importFile(target, 'json', JSON.stringify(file), 'replace');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(target.snapshot().settings.suggestionsEnabled).toBe(false);
	});

	it('a merge never changes the setting and says so', () => {
		const source = makeStore();
		setSuggestions(source, false);
		const file = JSON.stringify(buildExport(source.db, 'test'));
		const target = makeStore();
		const report = importFile(target, 'json', file, 'merge');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(target.snapshot().settings.suggestionsEnabled).toBe(true);
		expect(report.summary.join('\n')).toContain(
			'The suggestions setting from the file was not applied'
		);
	});

	it('rejects an invalid settings value without changing anything', () => {
		const file = buildExport(makeStore().db, 'test') as unknown as {
			data: { settings: unknown };
		};
		file.data.settings = { suggestionsEnabled: 'uit' };
		const target = makeStore();
		const report = importFile(target, 'json', JSON.stringify(file), 'replace');
		expect(report.ok).toBe(false);
		expect(report.errors.join('\n')).toContain('settings.suggestionsEnabled');
		expect(target.snapshot().settings.suggestionsEnabled).toBe(true);
	});
});

describe('sync between devices', () => {
	function memoryStorage(): Storage {
		const kv = new Map<string, unknown>();
		const pending = new Map<string, PendingRecord>();
		return {
			async kvGet<T>(k: string) {
				return structuredClone(kv.get(k)) as T | undefined;
			},
			async kvSet(k: string, v: unknown) {
				kv.set(k, structuredClone(v));
			},
			async pendingAll<T>() {
				return [...pending.values()]
					.sort((a, b) => a.seq - b.seq)
					.map((r) => structuredClone(r)) as PendingRecord<T>[];
			},
			async pendingPut(records: PendingRecord[]) {
				for (const r of records) pending.set(r.id, structuredClone(r));
			},
			async pendingDelete(ids: string[]) {
				for (const id of ids) pending.delete(id);
			}
		};
	}

	it('a switch on one device reaches the other one, also after being offline', async () => {
		const store = makeStore();
		const net = { online: true };
		const fetchImpl = (async (input: string, init?: RequestInit) => {
			if (!net.online) throw new TypeError('Failed to fetch');
			const url = new URL(input, 'http://test');
			if (url.pathname === '/api/snapshot') return Response.json(store.snapshot());
			if (url.pathname === '/api/ops') {
				const body = JSON.parse(String(init?.body));
				return Response.json(store.applyOps(body.clientId, body.ops));
			}
			return new Response('not found', { status: 404 });
		}) as typeof fetch;
		const a = new SyncEngine({ fetch: fetchImpl, storage: memoryStorage(), timeoutMs: 1000 });
		const b = new SyncEngine({ fetch: fetchImpl, storage: memoryStorage(), timeoutMs: 1000 });
		await a.start();
		await b.start();

		net.online = false;
		a.enqueue({ type: 'settings.update', suggestionsEnabled: false });
		a.enqueue({ type: 'settings.update', bulkAddEnabled: false });
		expect(a.view!.settings.suggestionsEnabled).toBe(false); // optimistic, while offline
		expect(a.view!.settings.bulkAddEnabled).toBe(false);
		await a.flush();
		expect(store.snapshot().settings.suggestionsEnabled).toBe(true);

		net.online = true;
		await a.flush();
		await b.refresh();
		expect(store.snapshot().settings.suggestionsEnabled).toBe(false);
		expect(b.view!.settings.suggestionsEnabled).toBe(false);
		expect(b.view!.settings.bulkAddEnabled).toBe(false);
		// Switching back on one device shows everything again on the other one.
		b.enqueue({ type: 'settings.update', suggestionsEnabled: true, bulkAddEnabled: true });
		await b.flush();
		await a.refresh();
		expect(a.view!.settings).toMatchObject({ suggestionsEnabled: true, bulkAddEnabled: true });
		a.stop();
		b.stop();
	});
});
