import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { openDatabase } from '$lib/server/db';
import { GroceryStore } from '$lib/server/store';
import { writeSettings } from '$lib/server/settings';
import { SyncEngine, type Storage } from '$lib/client/sync';
import type { PendingRecord } from '$lib/client/idb';
import * as idb from '$lib/client/idb';
import { applyOps, cloneSnapshot } from '$lib/shared/reducer';
import { runImport } from '$lib/server/transfer/importer';
import { buildExport } from '$lib/server/transfer/format';
import os from 'node:os';
import type { OpPayload } from '$lib/shared/ops';

/** In-process "server" reachable through a fake fetch that can be switched off. */
function makeServer() {
	const net = { online: true };
	const db = openDatabase(':memory:');
	// These tests check the Dutch wording; the household language decides it.
	writeSettings(db, { language: 'nl' });
	const srv = { store: new GroceryStore(db) };
	const fetchImpl = (async (input: string, init?: RequestInit) => {
		if (!net.online) throw new TypeError('Failed to fetch');
		const url = new URL(input, 'http://test');
		if (url.pathname === '/api/snapshot') return Response.json(srv.store.snapshot());
		if (url.pathname === '/api/ops') {
			const body = JSON.parse(String(init?.body));
			const r = srv.store.applyOps(body.clientId, body.ops);
			return Response.json(r);
		}
		return new Response('not found', { status: 404 });
	}) as typeof fetch;
	return {
		get store() {
			return srv.store;
		},
		set store(s: GroceryStore) {
			srv.store = s;
		},
		net,
		fetch: fetchImpl
	};
}

function memoryStorage(): Storage & {
	kv: Map<string, unknown>;
	pending: Map<string, PendingRecord>;
} {
	const kv = new Map<string, unknown>();
	const pending = new Map<string, PendingRecord>();
	return {
		kv,
		pending,
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

const tick = () => new Promise((r) => setTimeout(r, 60));

async function settle(engine: SyncEngine) {
	await tick();
	await engine.flush();
	await engine.refresh();
}

let server: ReturnType<typeof makeServer>;
beforeEach(() => {
	server = makeServer();
});

function engine(storage = memoryStorage()) {
	const e = new SyncEngine({ fetch: server.fetch, storage, timeoutMs: 1000 });
	return { e, storage };
}

const uid = () => Math.random().toString(36).slice(2, 12);

const add = (
	name: string,
	extra: Partial<Extract<OpPayload, { type: 'item.add' }>> = {}
): OpPayload => ({
	type: 'item.add',
	itemId: `i-${uid()}`,
	productId: `p-${uid()}`,
	listId: 'default',
	name,
	quantity: null,
	unit: null,
	categoryId: null,
	...extra
});

describe('SyncEngine', () => {
	it('applies ops optimistically, then syncs and empties the queue', async () => {
		const { e } = engine();
		await e.start();
		e.enqueue(add('Melk'));
		expect(e.view!.items).toHaveLength(1);
		expect(e.status.pending).toBe(1);
		await settle(e);
		expect(server.store.snapshot().items).toHaveLength(1);
		expect(e.queue).toHaveLength(0);
		expect(e.status.pending).toBe(0);
		expect(e.view!.items).toHaveLength(1);
		e.stop();
	});

	it('queues while offline, survives a reload and syncs on reconnect', async () => {
		const storage = memoryStorage();
		const { e } = engine(storage);
		await e.start();
		server.net.online = false;
		e.enqueue(add('Kaas'));
		e.enqueue(add('Brood'));
		await tick();
		await e.flush();
		expect(e.status.connection).toBe('offline');
		expect(e.status.pending).toBe(2);
		expect(server.store.snapshot().items).toHaveLength(0);
		e.stop();

		// "Reload" the app while still offline: state comes from local storage.
		const { e: e2 } = engine(storage);
		await e2.load();
		expect(e2.view!.items).toHaveLength(2);
		expect(e2.status.pending).toBe(2);

		server.net.online = true;
		await e2.refresh();
		await e2.flush();
		expect(server.store.snapshot().items).toHaveLength(2);
		expect(e2.status.pending).toBe(0);
		expect(storage.pending.size).toBe(0);
		e2.stop();
	});

	it('cancels an op locally when undone before it was sent', async () => {
		const { e } = engine();
		await e.start();
		server.net.online = false;
		const op = e.enqueue(add('Chips'));
		expect(e.undo(op.id)).toBe('cancelled');
		expect(e.view!.items).toHaveLength(0);
		server.net.online = true;
		await settle(e);
		expect(server.store.snapshot().products).toHaveLength(0);
		e.stop();
	});

	it('undoes an acknowledged completion on the server without counting a purchase', async () => {
		const { e } = engine();
		await e.start();
		const addOp = e.enqueue(add('Yoghurt'));
		await settle(e);
		const itemId = server.store.snapshot().items[0].id;
		expect(itemId).toBe((addOp as { itemId: string }).itemId);
		const done = e.enqueue({ type: 'item.complete', itemId });
		await settle(e);
		expect(server.store.snapshot().products[0].purchaseCount).toBe(1);
		expect(e.undo(done.id)).toBe('queued');
		// Optimistic: immediately active again locally.
		expect(e.view!.items[0].status).toBe('active');
		expect(e.view!.products[0].purchaseCount).toBe(0);
		await settle(e);
		const snap = server.store.snapshot();
		expect(snap.items[0].status).toBe('active');
		expect(snap.products[0].purchaseCount).toBe(0);
		e.stop();
	});

	it('records rejected ops as issues and reverts the optimistic change', async () => {
		const { e } = engine();
		await e.start();
		const results: string[] = [];
		e.onResult = (_op, r) => results.push(r.status);
		e.enqueue({ type: 'list.delete', listId: 'default' });
		await settle(e);
		expect(results).toEqual(['rejected']);
		await vi.waitFor(() => expect(e.issues).toHaveLength(1));
		expect(e.issues[0]).toMatchObject({ kind: 'rejected' });
		expect(e.view!.lists).toHaveLength(1);
		e.stop();
	});

	it('merges concurrent offline duplicates across devices via aliases', async () => {
		const { e: a } = engine();
		const { e: b } = engine();
		await a.start();
		await b.start();
		server.net.online = false;
		a.enqueue(add('Bananen'));
		const bAdd = b.enqueue(add('bananen'));
		b.enqueue({ type: 'item.complete', itemId: (bAdd as { itemId: string }).itemId });
		server.net.online = true;
		await settle(a);
		await settle(b);
		await a.refresh();
		const snap = server.store.snapshot();
		expect(snap.items).toHaveLength(1);
		expect(snap.items[0].status).toBe('completed');
		expect(a.view!.items).toHaveLength(1);
		expect(b.view!.items).toHaveLength(1);
		expect(b.view!.items[0].status).toBe('completed');
		a.stop();
		b.stop();
	});

	it('reports last-writer-wins conflicts', async () => {
		const { e: a } = engine();
		const { e: b } = engine();
		await a.start();
		a.enqueue(add('Bier'));
		await settle(a);
		await b.start();
		const id = server.store.snapshot().items[0].id;
		a.enqueue({
			type: 'item.update',
			itemId: id,
			changes: { quantity: 6 },
			base: { quantity: null }
		});
		b.enqueue({
			type: 'item.update',
			itemId: id,
			changes: { quantity: 12 },
			base: { quantity: null }
		});
		await settle(a);
		await settle(b);
		expect(server.store.snapshot().items[0].quantity).toBe(12);
		expect(b.issues[0]).toMatchObject({ kind: 'conflict' });
		a.stop();
		b.stop();
	});

	it('accepts a rolled-back server (backup restore) and keeps unsent edits', async () => {
		const { e } = engine();
		await e.start();
		e.enqueue(add('Melk'));
		await settle(e);
		const backup = server.store.db.serialize();
		e.enqueue(add('Kaas'));
		await settle(e);
		expect(e.view!.products.map((p) => p.name)).toEqual(['Kaas', 'Melk']);

		// Restore the backup on the "server" while this device has an unsent edit.
		server.net.online = false;
		e.enqueue(add('Brood'));
		await tick();
		await e.flush();
		const { default: Database } = await import('better-sqlite3');
		const restored = new GroceryStore(new Database(backup));
		server.store = restored;
		server.net.online = true;
		await e.refresh();
		await e.flush();
		expect(server.store.snapshot().products.map((p) => p.name)).toEqual(['Brood', 'Melk']);
		expect(e.view!.products.map((p) => p.name)).toEqual(['Brood', 'Melk']);
		e.stop();
	});

	it('reconciles with a full restore done elsewhere and keeps unsent offline edits', async () => {
		const { e } = engine();
		await e.start();
		let replacedEvents = 0;
		e.onDatasetReplaced = () => replacedEvents++;
		e.enqueue(add('Melk'));
		await settle(e);
		const backup = JSON.stringify(buildExport(server.store.db, 'test'));
		e.enqueue(add('Kaas'));
		await settle(e);

		// This device goes offline and keeps editing; meanwhile someone restores the backup.
		server.net.online = false;
		const offlineAdd = e.enqueue(add('Brood'));
		const melkId = e.view!.items.find(
			(i) => e.view!.products.find((p) => p.id === i.productId)!.name === 'Melk'
		)!.id;
		e.enqueue({ type: 'item.complete', itemId: melkId });
		await tick();
		await e.flush();
		const report = runImport(server.store, {
			kind: 'json',
			mode: 'replace',
			text: backup,
			preview: false,
			backupDir: os.tmpdir()
		});
		expect(report.ok).toBe(true);

		server.net.online = true;
		await e.refresh();
		expect(replacedEvents).toBe(1);
		await e.flush();
		await e.refresh();
		const snap = server.store.snapshot();
		// Kaas came after the backup → gone; the queued offline edits were applied, not lost.
		expect(snap.products.map((p) => p.name).sort()).toEqual(['Brood', 'Melk']);
		expect(snap.items.find((i) => i.id === melkId)!.status).toBe('completed');
		expect(e.view!.products.map((p) => p.name).sort()).toEqual(['Brood', 'Melk']);
		expect(e.queue).toHaveLength(0);
		expect(e.issues).toHaveLength(0);
		void offlineAdd;
		e.stop();
	});

	it('surfaces queued edits that no longer apply after a restore', async () => {
		const { e } = engine();
		await e.start();
		const backup = JSON.stringify(buildExport(server.store.db, 'test'));
		e.enqueue(add('Kaas'));
		await settle(e);
		const kaasId = e.view!.items[0].id;
		server.net.online = false;
		e.enqueue({ type: 'item.complete', itemId: kaasId });
		await tick();
		await e.flush();
		runImport(server.store, {
			kind: 'json',
			mode: 'replace',
			text: backup,
			preview: false,
			backupDir: os.tmpdir()
		});
		server.net.online = true;
		await e.refresh();
		await e.flush();
		await vi.waitFor(() => expect(e.issues).toHaveLength(1));
		expect(e.issues[0]).toMatchObject({ kind: 'rejected' });
		expect(e.issues[0].message).toMatch(/bestaat niet meer/);
		expect(e.view!.items).toHaveLength(0);
		e.stop();
	});

	it('measures the server clock offset', async () => {
		const { e } = engine();
		await e.start();
		expect(Math.abs(e.clockOffset)).toBeLessThan(1000);
		e.stop();
	});
});

describe('reducer', () => {
	it('is idempotent so rebasing never double-applies', async () => {
		const snap = server.store.snapshot();
		const ops = [
			{ id: '1', at: 1, ...add('Appel', { itemId: 'i1', productId: 'p1' }) },
			{ id: '2', at: 2, type: 'item.complete' as const, itemId: 'i1' },
			{ id: '3', at: 3, type: 'list.create' as const, listId: 'l2', name: 'Markt' }
		];
		const once = applyOps(snap, ops);
		const twice = applyOps(once, ops);
		expect(twice.items).toEqual(once.items);
		expect(twice.lists).toEqual(once.lists);
		expect(twice.products[0].purchaseCount).toBe(1);
		// The base snapshot is never mutated.
		expect(cloneSnapshot(snap)).toEqual(server.store.snapshot(snap.serverTime));
	});
});

describe('IndexedDB storage', () => {
	it('persists kv values and the ordered pending queue', async () => {
		await idb.kvSet('x', { a: 1 });
		expect(await idb.kvGet('x')).toEqual({ a: 1 });
		await idb.pendingPut([
			{ id: 'b', seq: 2, op: { n: 2 }, ackSeq: null },
			{ id: 'a', seq: 1, op: { n: 1 }, ackSeq: null }
		]);
		expect((await idb.pendingAll()).map((r) => r.id)).toEqual(['a', 'b']);
		await idb.pendingDelete(['a']);
		expect((await idb.pendingAll()).map((r) => r.id)).toEqual(['b']);
	});
});
