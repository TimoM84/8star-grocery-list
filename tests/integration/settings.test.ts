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
import { DEFAULT_SETTINGS } from '$lib/shared/settings';
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

const setAi = (store: GroceryStore, aiEnabled: boolean) =>
	apply(store, { type: 'settings.update', aiEnabled });

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
	it('defaults to AI on, so existing installations keep their behaviour', () => {
		expect(DEFAULT_SETTINGS.aiEnabled).toBe(true);
		expect(makeStore().snapshot().settings).toEqual({ aiEnabled: true, language: 'en' });
	});

	it('switches AI off and on, shared through the snapshot, and is a no-op when unchanged', () => {
		const s = makeStore();
		const seq = s.seq;
		expect(setAi(s, false).status).toBe('applied');
		expect(s.seq).toBe(seq + 1);
		expect(s.snapshot().settings.aiEnabled).toBe(false);
		const again = setAi(s, false);
		expect(again).toMatchObject({ status: 'noop', reason: 'unchanged' });
		expect(s.seq).toBe(seq + 1);
		expect(setAi(s, true).status).toBe('applied');
		expect(s.snapshot().settings.aiEnabled).toBe(true);
	});

	it('is idempotent per op id', () => {
		const s = makeStore();
		const op = { id: 'same', at: T0, type: 'settings.update', aiEnabled: false } as Op;
		expect(s.applyOps('a', [op], T0).results[0].status).toBe('applied');
		setAi(s, true);
		// A resent op returns the stored result and does not switch AI off again.
		expect(s.applyOps('a', [op], T0).results[0].status).toBe('applied');
		expect(s.snapshot().settings.aiEnabled).toBe(true);
	});

	it('persists across a server restart', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), '8star-settings-db-'));
		const file = path.join(dir, 'db.sqlite');
		const a = makeStore(file);
		setAi(a, false);
		a.db.close();
		expect(makeStore(file).snapshot().settings.aiEnabled).toBe(false);
	});

	it('never deletes AI data: recommendations are kept and come back when switched on', () => {
		const s = storeWithRecommendation();
		setAi(s, false);
		expect(s.snapshot().aiRecommendations).toHaveLength(1);
		setAi(s, true);
		expect(s.snapshot().aiRecommendations).toHaveLength(1);
	});

	it('rejects malformed values', () => {
		expect(() => parseOp({ id: 'x', at: T0, type: 'settings.update', aiEnabled: 'nee' })).toThrow(
			/aiEnabled/
		);
		expect(() => parseOp({ id: 'x', at: T0, type: 'settings.update' })).toThrow();
		const r = makeStore().applyOps('a', [{ id: 'bad', at: T0, type: 'settings.update' }], T0);
		expect(r.results[0].status).toBe('rejected');
	});
});

describe('optimistic reducer', () => {
	it('applies the setting locally and fills it in for snapshots cached by older versions', () => {
		const snap = makeStore().snapshot();
		const old = { ...snap } as Partial<Snapshot>;
		delete old.settings;
		const cloned = cloneSnapshot(old as Snapshot);
		expect(cloned.settings).toEqual({ aiEnabled: true, language: 'en' });
		const op = { id: 'o', at: T0, type: 'settings.update', aiEnabled: false } as Op;
		expect(applyOps(cloned, [op], new Map()).settings.aiEnabled).toBe(false);
	});
});

describe('export and import', () => {
	it('exports the settings', () => {
		const s = makeStore();
		setAi(s, false);
		expect(buildExport(s.db, 'test').data.settings).toEqual({ aiEnabled: false, language: 'en' });
	});

	it('a full replace restores the setting from the file and reports it', () => {
		const source = storeWithRecommendation();
		setAi(source, false);
		const file = JSON.stringify(buildExport(source.db, 'test'));
		const target = makeStore();

		const preview = importFile(target, 'json', file, 'replace', true);
		expect(preview.ok, preview.errors.join('\n')).toBe(true);
		expect(preview.summary).toContain('AI features will be turned off (setting from the file)');
		expect(target.snapshot().settings.aiEnabled).toBe(true);

		const report = importFile(target, 'json', file, 'replace');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(report.summary).toContain('AI features turned off (setting from the file)');
		const snap = target.snapshot();
		expect(snap.settings.aiEnabled).toBe(false);
		// The AI data in the file is restored as well, just hidden.
		expect(snap.aiRecommendations).toHaveLength(1);
	});

	it('a replace with an older file without settings keeps the current setting', () => {
		const source = makeStore();
		const file = buildExport(source.db, 'test');
		delete file.data.settings;
		const target = makeStore();
		setAi(target, false);
		const report = importFile(target, 'json', JSON.stringify(file), 'replace');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(target.snapshot().settings.aiEnabled).toBe(false);
	});

	it('a merge never changes the setting and says so', () => {
		const source = makeStore();
		setAi(source, false);
		const file = JSON.stringify(buildExport(source.db, 'test'));
		const target = makeStore();
		const report = importFile(target, 'json', file, 'merge');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(target.snapshot().settings.aiEnabled).toBe(true);
		expect(report.summary.join('\n')).toContain('The AI setting from the file was not applied');
	});

	it('rejects an invalid settings value without changing anything', () => {
		const file = buildExport(makeStore().db, 'test') as unknown as {
			data: { settings: unknown };
		};
		file.data.settings = { aiEnabled: 'uit' };
		const target = makeStore();
		const report = importFile(target, 'json', JSON.stringify(file), 'replace');
		expect(report.ok).toBe(false);
		expect(report.errors.join('\n')).toContain('settings.aiEnabled');
		expect(target.snapshot().settings.aiEnabled).toBe(true);
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
		a.enqueue({ type: 'settings.update', aiEnabled: false });
		expect(a.view!.settings.aiEnabled).toBe(false); // optimistic, while offline
		await a.flush();
		expect(store.snapshot().settings.aiEnabled).toBe(true);

		net.online = true;
		await a.flush();
		await b.refresh();
		expect(store.snapshot().settings.aiEnabled).toBe(false);
		expect(b.view!.settings.aiEnabled).toBe(false);
		a.stop();
		b.stop();
	});
});
