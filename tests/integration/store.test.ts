import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, schemaVersion, latestSchemaVersion } from '$lib/server/db';
import { GroceryStore } from '$lib/server/store';
import type { Op, OpPayload } from '$lib/shared/ops';
import { computeStats, DAY } from '$lib/shared/stats';

let n = 0;
const uid = (p = 'id') => `${p}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

function setup() {
	const db = openDatabase(':memory:');
	const store = new GroceryStore(db);
	let clock = Date.UTC(2026, 0, 1, 12);
	const apply = (payload: OpPayload, opts: { id?: string; at?: number } = {}) => {
		const op = { id: opts.id ?? uid('op'), at: opts.at ?? clock, ...payload } as Op;
		const res = store.applyOps('test-client', [op], opts.at ?? clock);
		return { op, result: res.results[0] };
	};
	const add = (name: string, extra: Partial<Extract<OpPayload, { type: 'item.add' }>> = {}) =>
		apply({
			type: 'item.add',
			itemId: uid('item'),
			productId: uid('prod'),
			listId: 'default',
			name,
			quantity: null,
			unit: null,
			categoryId: null,
			...extra
		});
	const tick = (ms: number) => (clock += ms);
	const snap = () => store.snapshot(clock);
	const itemByName = (name: string, listId = 'default') => {
		const s = snap();
		const p = s.products.find((x) => x.name.toLowerCase() === name.toLowerCase());
		return s.items.find((i) => i.productId === p?.id && i.listId === listId);
	};
	return { db, store, apply, add, tick, snap, itemByName, now: () => clock };
}

type Ctx = ReturnType<typeof setup>;
let t: Ctx;
beforeEach(() => {
	t = setup();
});

describe('migrations', () => {
	it('creates the schema, default list and categories', () => {
		expect(schemaVersion(t.db)).toBe(latestSchemaVersion());
		const s = t.snap();
		expect(s.lists.map((l) => l.name)).toEqual(['Boodschappen']);
		expect(s.categories.length).toBeGreaterThan(5);
		expect(t.db.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('persists data across reopen and uses WAL', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), '8star-'));
		const file = path.join(dir, 'test.db');
		const db1 = openDatabase(file);
		expect(db1.pragma('journal_mode', { simple: true })).toBe('wal');
		const s1 = new GroceryStore(db1);
		s1.applyOps('c', [
			{
				id: 'op-persist',
				at: Date.now(),
				type: 'item.add',
				itemId: 'i1',
				productId: 'p1',
				listId: 'default',
				name: 'Melk',
				quantity: 2,
				unit: 'l',
				categoryId: null
			}
		]);
		const seq = s1.seq;
		db1.close();
		const db2 = openDatabase(file);
		const s2 = new GroceryStore(db2);
		expect(s2.seq).toBe(seq);
		const snap = s2.snapshot();
		expect(snap.items).toHaveLength(1);
		expect(snap.items[0]).toMatchObject({ quantity: 2, unit: 'l', status: 'active' });
		// Replaying the same op after restart is still idempotent.
		const replay = s2.applyOps('c', [
			{
				id: 'op-persist',
				at: Date.now(),
				type: 'item.add',
				itemId: 'i1',
				productId: 'p1',
				listId: 'default',
				name: 'Melk',
				quantity: 2,
				unit: 'l',
				categoryId: null
			}
		]);
		expect(replay.seq).toBe(seq);
		db2.close();
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe('items CRUD', () => {
	it('adds an item with a new product', () => {
		const { result } = t.add('halfvolle melk', { quantity: 2, unit: 'l' });
		expect(result).toMatchObject({ status: 'applied', reason: 'created', undoable: true });
		const s = t.snap();
		expect(s.products[0].name).toBe('Halfvolle melk');
		expect(s.items[0]).toMatchObject({ status: 'active', quantity: 2, unit: 'l' });
	});

	it('prevents duplicates ignoring case and whitespace', () => {
		t.add('Halfvolle melk');
		const { result } = t.add('  HALFVOLLE    melk ');
		expect(result).toMatchObject({ status: 'noop', reason: 'duplicate' });
		expect(t.snap().items).toHaveLength(1);
		expect(t.snap().products).toHaveLength(1);
	});

	it('is idempotent for replayed op ids', () => {
		const { op } = t.add('Brood');
		const seq = t.store.seq;
		const again = t.store.applyOps('x', [op]);
		expect(again.results[0].status).toBe('applied');
		expect(again.seq).toBe(seq);
		expect(t.snap().items).toHaveLength(1);
	});

	it('completes and reactivates, counting purchases correctly', () => {
		const { result } = t.add('Eieren');
		const id = result.itemId!;
		t.tick(1000);
		expect(t.apply({ type: 'item.complete', itemId: id }).result.status).toBe('applied');
		// Completing twice (e.g. two devices) never double-counts.
		expect(t.apply({ type: 'item.complete', itemId: id }).result).toMatchObject({
			status: 'noop',
			reason: 'already_completed'
		});
		let p = t.snap().products[0];
		expect(p.purchaseCount).toBe(1);
		const firstActivated = t.snap().items[0].activatedAt;

		t.tick(DAY);
		expect(t.apply({ type: 'item.reactivate', itemId: id }).result.status).toBe('applied');
		const item = t.snap().items[0];
		expect(item.status).toBe('active');
		expect(item.activatedAt).toBeGreaterThan(firstActivated);
		expect(item.completedAt).toBeNull();
		p = t.snap().products[0];
		expect(p.purchaseCount).toBe(1);

		const cycles = t.db.prepare('SELECT * FROM cycles ORDER BY activated_at').all() as {
			completed_at: number | null;
		}[];
		expect(cycles).toHaveLength(2);
		expect(cycles[0].completed_at).not.toBeNull();
		expect(cycles[1].completed_at).toBeNull();
	});

	it('re-adding a completed product reactivates it', () => {
		const id = t.add('Kaas').result.itemId!;
		t.apply({ type: 'item.complete', itemId: id });
		t.tick(5000);
		const { result } = t.add('kaas', { quantity: 3 });
		expect(result).toMatchObject({ status: 'applied', reason: 'reactivated', itemId: id });
		expect(t.snap().items[0]).toMatchObject({ status: 'active', quantity: 3 });
	});

	it('updates quantity and unit', () => {
		const id = t.add('Appels').result.itemId!;
		const { result } = t.apply({
			type: 'item.update',
			itemId: id,
			changes: { quantity: 6, unit: 'stuks' },
			base: { quantity: null, unit: null }
		});
		expect(result.status).toBe('applied');
		expect(result.conflicts).toBeUndefined();
		expect(t.snap().items[0]).toMatchObject({ quantity: 6, unit: 'stuks' });
	});

	it('renames products and rejects duplicate names', () => {
		t.add('Appel');
		t.add('Peer');
		const peer = t.snap().products.find((p) => p.name === 'Peer')!;
		expect(
			t.apply({ type: 'product.update', productId: peer.id, changes: { name: 'appel' }, base: {} })
				.result
		).toMatchObject({ status: 'rejected', reason: 'duplicate' });
		expect(
			t.apply({
				type: 'product.update',
				productId: peer.id,
				changes: { name: 'Handpeer' },
				base: {}
			}).result.status
		).toBe('applied');
		expect(t.snap().products.map((p) => p.name)).toContain('Handpeer');
	});

	it('deletes items while preserving history', () => {
		const id = t.add('Rijst').result.itemId!;
		t.apply({ type: 'item.complete', itemId: id });
		expect(t.apply({ type: 'item.delete', itemId: id }).result.status).toBe('applied');
		const s = t.snap();
		expect(s.items).toHaveLength(0);
		expect(s.products[0].purchaseCount).toBe(1);
		expect(t.apply({ type: 'item.delete', itemId: id }).result.status).toBe('noop');
	});

	it('cancels the open cycle when deleting an active item (no purchase counted)', () => {
		const id = t.add('Pasta').result.itemId!;
		t.apply({ type: 'item.delete', itemId: id });
		const c = t.db.prepare('SELECT * FROM cycles').get() as {
			completed_at: number | null;
			cancelled_at: number | null;
		};
		expect(c.completed_at).toBeNull();
		expect(c.cancelled_at).not.toBeNull();
		expect(t.snap().products[0].purchaseCount).toBe(0);
	});

	it('deletes products including their history', () => {
		const id = t.add('Chips').result.itemId!;
		t.apply({ type: 'item.complete', itemId: id });
		const pid = t.snap().products[0].id;
		expect(t.apply({ type: 'product.delete', productId: pid }).result.status).toBe('applied');
		expect(t.snap().products).toHaveLength(0);
		expect(t.snap().items).toHaveLength(0);
		expect((t.db.prepare('SELECT COUNT(*) n FROM cycles').get() as { n: number }).n).toBe(0);
	});

	it('clears completed items of a list', () => {
		const a = t.add('A').result.itemId!;
		t.add('B');
		t.apply({ type: 'item.complete', itemId: a });
		expect(t.apply({ type: 'list.clearCompleted', listId: 'default' }).result.status).toBe(
			'applied'
		);
		expect(t.snap().items.map((i) => i.status)).toEqual(['active']);
		expect(t.snap().products.find((p) => p.name === 'A')!.purchaseCount).toBe(1);
	});

	it('rejects invalid ops without blocking the batch', () => {
		const res = t.store.applyOps('c', [
			{ id: 'bad', type: 'item.complete' },
			{ id: 'ok-1', at: t.now(), type: 'list.create', listId: 'l2', name: 'Weekend' }
		]);
		expect(res.results[0]).toMatchObject({ status: 'rejected', reason: 'invalid' });
		expect(res.results[1].status).toBe('applied');
	});

	it('clamps timestamps from clients with clocks far in the future', () => {
		t.add('Toekomst', {});
		const { result } = t.apply({ type: 'list.create', listId: 'x', name: 'X' });
		expect(result.status).toBe('applied');
		const future = t.add('Klok', {});
		void future;
		const { result: r2 } = t.apply(
			{
				type: 'item.add',
				itemId: 'clock-item',
				productId: 'clock-prod',
				listId: 'default',
				name: 'Klokvooruit',
				quantity: null,
				unit: null,
				categoryId: null
			},
			{ at: t.now() + 365 * DAY }
		);
		expect(r2.status).toBe('applied');
	});
});

describe('undo', () => {
	it('undoes a completion without counting a purchase', () => {
		const id = t.add('Yoghurt').result.itemId!;
		const before = t.snap().items[0];
		const { op } = t.apply({ type: 'item.complete', itemId: id });
		expect(t.snap().products[0].purchaseCount).toBe(1);
		const { result } = t.apply({ type: 'undo', targetOpId: op.id });
		expect(result).toMatchObject({ status: 'applied', reason: 'undone' });
		const item = t.snap().items[0];
		expect(item.status).toBe('active');
		expect(item.activatedAt).toBe(before.activatedAt);
		expect(t.snap().products[0].purchaseCount).toBe(0);
		// Undo twice is harmless.
		expect(t.apply({ type: 'undo', targetOpId: op.id }).result.status).toBe('noop');
	});

	it('undoes an add of a brand new product completely', () => {
		const { op } = t.add('Nieuw ding');
		t.apply({ type: 'undo', targetOpId: op.id });
		expect(t.snap().items).toHaveLength(0);
		expect(t.snap().products).toHaveLength(0);
	});

	it('undoes a reactivation and restores the completed state', () => {
		const id = t.add('Thee').result.itemId!;
		t.apply({ type: 'item.complete', itemId: id });
		const completed = t.snap().items[0];
		t.tick(DAY);
		const { op } = t.apply({ type: 'item.reactivate', itemId: id });
		t.apply({ type: 'undo', targetOpId: op.id });
		const item = t.snap().items[0];
		expect(item.status).toBe('completed');
		expect(item.completedAt).toBe(completed.completedAt);
		expect((t.db.prepare('SELECT COUNT(*) n FROM cycles').get() as { n: number }).n).toBe(1);
	});

	it('undoes a delete', () => {
		const id = t.add('Koffie', { quantity: 2 }).result.itemId!;
		const { op } = t.apply({ type: 'item.delete', itemId: id });
		t.apply({ type: 'undo', targetOpId: op.id });
		expect(t.snap().items[0]).toMatchObject({ id, quantity: 2, status: 'active' });
		const c = t.db.prepare('SELECT cancelled_at FROM cycles').get() as { cancelled_at: null };
		expect(c.cancelled_at).toBeNull();
	});

	it('undoes a product deletion with all history', () => {
		const id = t.add('Hagelslag').result.itemId!;
		t.apply({ type: 'item.complete', itemId: id });
		const pid = t.snap().products[0].id;
		const { op } = t.apply({ type: 'product.delete', productId: pid });
		t.apply({ type: 'undo', targetOpId: op.id });
		expect(t.snap().products[0]).toMatchObject({ id: pid, purchaseCount: 1 });
		expect(t.snap().items).toHaveLength(1);
	});

	it('refuses to undo when the item changed afterwards on another device', () => {
		const id = t.add('Sap').result.itemId!;
		const { op } = t.apply({ type: 'item.complete', itemId: id });
		t.apply({ type: 'item.reactivate', itemId: id });
		const { result } = t.apply({ type: 'undo', targetOpId: op.id });
		expect(result).toMatchObject({ status: 'rejected', reason: 'conflict' });
		expect(t.snap().items[0].status).toBe('active');
	});

	it('does not delete a product that another list started using', () => {
		t.apply({ type: 'list.create', listId: 'l2', name: 'Markt' });
		const { op } = t.add('Bloemen');
		t.add('bloemen', { listId: 'l2' });
		t.apply({ type: 'undo', targetOpId: op.id });
		const s = t.snap();
		expect(s.products).toHaveLength(1);
		expect(s.items.map((i) => i.listId)).toEqual(['l2']);
	});
});

describe('conflicts and aliases', () => {
	it('resolves offline-created duplicate ids via aliases', () => {
		// Device A and B both add "Bananen" while offline.
		const a = t.add('Bananen');
		const bItemId = uid('item');
		const b = t.apply({
			type: 'item.add',
			itemId: bItemId,
			productId: uid('prod'),
			listId: 'default',
			name: 'bananen',
			quantity: null,
			unit: null,
			categoryId: null
		});
		expect(b.result).toMatchObject({
			status: 'noop',
			reason: 'duplicate',
			itemId: a.result.itemId
		});
		// Device B then completes its local (aliased) id.
		const c = t.apply({ type: 'item.complete', itemId: bItemId });
		expect(c.result).toMatchObject({ status: 'applied', itemId: a.result.itemId });
		expect(t.snap().items[0].status).toBe('completed');
	});

	it('applies last-writer-wins for concurrent edits and reports the conflict', () => {
		const id = t.add('Bier').result.itemId!;
		t.apply({
			type: 'item.update',
			itemId: id,
			changes: { quantity: 6 },
			base: { quantity: null }
		});
		const { result } = t.apply({
			type: 'item.update',
			itemId: id,
			changes: { quantity: 12 },
			base: { quantity: null }
		});
		expect(result.status).toBe('applied');
		expect(result.conflicts).toEqual([
			{ field: 'quantity', previous: 6, expected: null, written: 12 }
		]);
		expect(result.message).toMatch(/ander apparaat/);
		expect(t.snap().items[0].quantity).toBe(12);
	});

	it('rejects edits to items deleted elsewhere with a clear message', () => {
		const id = t.add('Wijn').result.itemId!;
		t.apply({ type: 'item.delete', itemId: id });
		const { result } = t.apply({ type: 'item.complete', itemId: id });
		expect(result.status).toBe('rejected');
		expect(result.reason).toBe('not_found');
		expect(result.message).toMatch(/verwijderd/);
	});

	it('rejects adding to a deleted list', () => {
		t.apply({ type: 'list.create', listId: 'tmp', name: 'Tijdelijk' });
		t.apply({ type: 'list.delete', listId: 'tmp' });
		const { result } = t.add('Melk', { listId: 'tmp' });
		expect(result).toMatchObject({ status: 'rejected', reason: 'list_not_found' });
	});
});

describe('lists and categories', () => {
	it('creates, renames, reorders and deletes lists', () => {
		t.apply({ type: 'list.create', listId: 'l2', name: 'drogist' });
		t.apply({ type: 'list.create', listId: 'l3', name: 'Markt' });
		expect(t.apply({ type: 'list.create', listId: 'l4', name: 'DROGIST' }).result.reason).toBe(
			'duplicate'
		);
		t.apply({ type: 'list.rename', listId: 'l2', name: 'Drogist' });
		t.apply({ type: 'list.reorder', listIds: ['l3', 'default', 'l2'] });
		expect(t.snap().lists.map((l) => l.name)).toEqual(['Markt', 'Boodschappen', 'Drogist']);
		t.add('Shampoo', { listId: 'l2' });
		t.apply({ type: 'list.delete', listId: 'l2' });
		expect(t.snap().lists.map((l) => l.id)).toEqual(['l3', 'default']);
		expect(t.snap().items).toHaveLength(0);
		expect(t.snap().products).toHaveLength(1);
	});

	it('never deletes the last list', () => {
		const { result } = t.apply({ type: 'list.delete', listId: 'default' });
		expect(result).toMatchObject({ status: 'rejected', reason: 'last_list' });
	});

	it('keeps lists independent and moves items between them', () => {
		t.apply({ type: 'list.create', listId: 'l2', name: 'Markt' });
		const a = t.add('Tomaten').result.itemId!;
		t.add('Tomaten', { listId: 'l2' });
		expect(t.snap().items).toHaveLength(2);
		// Moving onto a list that already has the active product merges.
		const r = t.apply({ type: 'item.move', itemId: a, toListId: 'l2' }).result;
		expect(r).toMatchObject({ status: 'applied', reason: 'merged' });
		expect(t.snap().items.map((i) => i.listId)).toEqual(['l2']);
		const b = t.add('Sla').result.itemId!;
		t.apply({ type: 'item.move', itemId: b, toListId: 'l2' });
		expect(t.itemByName('Sla', 'l2')).toBeDefined();
		const cycle = t.db
			.prepare(
				'SELECT list_id FROM cycles WHERE completed_at IS NULL AND cancelled_at IS NULL AND product_id = ?'
			)
			.get(t.snap().products.find((p) => p.name === 'Sla')!.id) as { list_id: string };
		expect(cycle.list_id).toBe('l2');
	});

	it('manages categories and their order', () => {
		t.apply({ type: 'category.create', categoryId: 'c-x', name: 'Baby' });
		const ids = t.snap().categories.map((c) => c.id);
		t.apply({ type: 'category.reorder', categoryIds: ['c-x', ...ids.filter((i) => i !== 'c-x')] });
		expect(t.snap().categories[0].name).toBe('Baby');
		t.apply({ type: 'category.rename', categoryId: 'c-x', name: 'Baby & kind' });
		t.add('Luiers', { categoryId: 'c-x' });
		expect(t.snap().products[0].categoryId).toBe('c-x');
		t.apply({ type: 'category.delete', categoryId: 'c-x' });
		expect(t.snap().products[0].categoryId).toBeNull();
		expect(t.snap().categories.find((c) => c.id === 'c-x')).toBeUndefined();
	});

	it('toggles favorites and sets categories on products', () => {
		t.add('Olijfolie');
		const p = t.snap().products[0];
		t.apply({
			type: 'product.update',
			productId: p.id,
			changes: { favorite: true, categoryId: 'cat-houdbaar' },
			base: { favorite: false, categoryId: null }
		});
		expect(t.snap().products[0]).toMatchObject({ favorite: true, categoryId: 'cat-houdbaar' });
	});
});

describe('history and statistics', () => {
	it('tracks cycles and computes frequency stats', () => {
		const id = t.add('Melk').result.itemId!;
		for (let i = 0; i < 4; i++) {
			t.tick(1000);
			t.apply({ type: 'item.complete', itemId: id });
			t.tick(7 * DAY);
			t.apply({ type: 'item.reactivate', itemId: id });
		}
		t.apply({ type: 'item.complete', itemId: id });
		const p = t.snap().products[0];
		expect(p.purchaseCount).toBe(5);
		expect(p.completions).toHaveLength(5);
		const stats = computeStats(p.completions, p.purchaseCount, t.now(), p.firstCompletedAt);
		expect(stats.avgIntervalDays).toBeCloseTo(7, 1);
		expect(stats.hasEnoughHistory).toBe(true);
		const hist = t.store.history({ query: 'mel' });
		expect(hist).toHaveLength(5);
		expect(t.store.history({ query: 'kaas' })).toHaveLength(0);
		expect(t.store.productCycles(p.id)).toHaveLength(5);
	});
});
