/**
 * v1.2 domain behaviour on the server store: explicit quantity intents, partial purchases,
 * unavailable items, product memory, shared snoozes, rounds and claims, bundles, checklists
 * and stock. Every scenario runs through the real op pipeline (validation, idempotency, undo).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { openDatabase } from '$lib/server/db';
import { CLAIM_TTL_MS, GroceryStore, ROUND_IDLE_MS } from '$lib/server/store';
import type { AddManyEntry, Op, OpPayload } from '$lib/shared/ops';
import { computeStats, DAY } from '$lib/shared/stats';

let n = 0;
const uid = (p = 'id') => `${p}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

function setup() {
	const db = openDatabase(':memory:');
	const store = new GroceryStore(db);
	let clock = Date.UTC(2026, 0, 1, 12);
	const apply = (payload: OpPayload, opts: { id?: string; client?: string } = {}) => {
		const op = { id: opts.id ?? uid('op'), at: clock, ...payload } as Op;
		const res = store.applyOps(opts.client ?? 'client-a', [op], clock);
		return { op, result: res.results[0] };
	};
	const add = (
		name: string,
		quantity: number | null = null,
		unit: string | null = null,
		listId = 'default'
	) =>
		apply({
			type: 'item.add',
			itemId: uid('item'),
			productId: uid('prod'),
			listId,
			name,
			quantity,
			unit,
			categoryId: null
		}).result.itemId!;
	const snap = () => store.snapshot(clock);
	const item = (id: string) => snap().items.find((i) => i.id === id)!;
	const productOf = (id: string) => snap().products.find((p) => p.id === item(id).productId)!;
	const cycles = (productId: string) =>
		db
			.prepare('SELECT * FROM cycles WHERE product_id = ? ORDER BY activated_at')
			.all(productId) as {
			completed_at: number | null;
			cancelled_at: number | null;
			quantity: number | null;
			purchased_quantity: number | null;
			requested_quantity: number | null;
		}[];
	return {
		db,
		store,
		apply,
		add,
		snap,
		item,
		productOf,
		cycles,
		tick: (ms: number) => (clock += ms),
		now: () => clock
	};
}

let t: ReturnType<typeof setup>;
beforeEach(() => {
	t = setup();
});

describe('quantity intents (no silent replacement)', () => {
	it('re-adding an active product never changes its quantity', () => {
		const id = t.add('Melk', 2);
		const { result } = t.apply({
			type: 'item.add',
			itemId: uid('item'),
			productId: uid('prod'),
			listId: 'default',
			name: 'melk',
			quantity: 1,
			unit: null,
			categoryId: null
		});
		expect(result.status).toBe('noop');
		expect(result.reason).toBe('duplicate');
		expect(t.item(id).quantity).toBe(2);
	});

	it('two devices each adding 1 to 2 give 4; a resent op counts once', () => {
		const id = t.add('Melk', 2);
		const a = t.apply({ type: 'item.increment', itemId: id, delta: 1, unit: null });
		t.apply({ type: 'item.increment', itemId: id, delta: 1, unit: null }, { client: 'client-b' });
		expect(t.item(id).quantity).toBe(4);
		// Network retry of device A's op: same id, same result, no change.
		const again = t.store.applyOps('client-a', [a.op], t.now()).results[0];
		expect(again).toEqual(a.result);
		expect(t.item(id).quantity).toBe(4);
	});

	it('converts only compatible units and refuses everything else', () => {
		const kg = t.add('Aardappelen', 1, 'kg');
		t.apply({ type: 'item.increment', itemId: kg, delta: 500, unit: 'g' });
		expect(t.item(kg)).toMatchObject({ quantity: 1.5, unit: 'kg' });

		const ml = t.add('Room', 250, 'ml');
		t.apply({ type: 'item.increment', itemId: ml, delta: 0.5, unit: 'l' });
		expect(t.item(ml)).toMatchObject({ quantity: 750, unit: 'ml' });

		const pak = t.add('Rijst', 2, 'pak');
		const bad = t.apply({ type: 'item.increment', itemId: pak, delta: 1, unit: 'kg' }).result;
		expect(bad.status).toBe('rejected');
		expect(bad.reason).toBe('incompatible_unit');
		expect(t.item(pak).quantity).toBe(2);
	});

	it('never treats an unknown existing quantity as 1', () => {
		const id = t.add('Brood');
		const r = t.apply({ type: 'item.increment', itemId: id, delta: 1, unit: null }).result;
		expect(r).toMatchObject({ status: 'rejected', reason: 'unknown_quantity' });
		expect(t.item(id).quantity).toBeNull();
	});

	it('replacing is an explicit absolute change', () => {
		const id = t.add('Melk', 2);
		t.apply({
			type: 'item.update',
			itemId: id,
			changes: { quantity: 1, unit: null },
			base: { quantity: 2, unit: null }
		});
		expect(t.item(id).quantity).toBe(1);
	});

	it('undo of +1 keeps somebody else’s later +1', () => {
		const id = t.add('Melk', 2);
		const mine = t.apply({ type: 'item.increment', itemId: id, delta: 1, unit: null });
		t.apply({ type: 'item.increment', itemId: id, delta: 1, unit: null }, { client: 'client-b' });
		const undo = t.apply({ type: 'undo', targetOpId: mine.op.id }).result;
		expect(undo.status).toBe('applied');
		expect(t.item(id).quantity).toBe(3);
	});

	it('undo of +1 is refused after a later absolute change by someone else', () => {
		const id = t.add('Melk', 2);
		const mine = t.apply({ type: 'item.increment', itemId: id, delta: 1, unit: null });
		t.apply(
			{
				type: 'item.update',
				itemId: id,
				changes: { quantity: 6 },
				base: { quantity: 3 }
			},
			{ client: 'client-b' }
		);
		const undo = t.apply({ type: 'undo', targetOpId: mine.op.id }).result;
		expect(undo).toMatchObject({ status: 'rejected', reason: 'conflict' });
		expect(t.item(id).quantity).toBe(6);
	});
});

describe('partial purchases and unavailable items', () => {
	it('3 packs, 2 bought: 1 remains; ticking off books one purchase of 3', () => {
		const id = t.add('Melk', 3, 'pak');
		const partial = t.apply({ type: 'item.purchasePartial', itemId: id, quantity: 2, unit: 'pak' });
		expect(partial.result.status).toBe('applied');
		expect(t.item(id)).toMatchObject({ status: 'active', quantity: 1, purchasedQuantity: 2 });
		expect(t.productOf(id).purchaseCount).toBe(0);

		t.tick(60_000);
		t.apply({ type: 'item.complete', itemId: id });
		const p = t.productOf(id);
		expect(p.purchaseCount).toBe(1);
		const [c] = t.cycles(p.id);
		expect(c).toMatchObject({ quantity: 3, purchased_quantity: 3, requested_quantity: 3 });

		// Undo of the tick-off restores exactly the remaining need.
		const last = t.db.prepare("SELECT id FROM ops WHERE type = 'item.complete'").get() as {
			id: string;
		};
		t.apply({ type: 'undo', targetOpId: last.id });
		expect(t.item(id)).toMatchObject({ status: 'active', quantity: 1, purchasedQuantity: 2 });
		expect(t.productOf(id).purchaseCount).toBe(0);
	});

	it('several partial actions in one round stay one purchase', () => {
		const id = t.add('Water', 6, 'fles');
		t.apply({ type: 'item.purchasePartial', itemId: id, quantity: 2, unit: 'fles' });
		t.apply({ type: 'item.purchasePartial', itemId: id, quantity: 2, unit: 'fles' });
		expect(t.item(id).quantity).toBe(2);
		t.apply({ type: 'item.complete', itemId: id });
		const p = t.productOf(id);
		expect(p.purchaseCount).toBe(1);
		expect(computeStats(p.completions, p.purchaseCount, t.now()).purchaseCount).toBe(1);
		expect(t.cycles(p.id)[0].quantity).toBe(6);
	});

	it('undo of a partial purchase puts the amount back', () => {
		const id = t.add('Melk', 3, 'pak');
		const partial = t.apply({ type: 'item.purchasePartial', itemId: id, quantity: 2, unit: 'pak' });
		t.apply({ type: 'undo', targetOpId: partial.op.id });
		expect(t.item(id)).toMatchObject({ quantity: 3, purchasedQuantity: null });
	});

	it('refuses a "partial" purchase of everything or of an unknown amount', () => {
		const id = t.add('Melk', 2, 'pak');
		expect(
			t.apply({ type: 'item.purchasePartial', itemId: id, quantity: 2, unit: 'pak' }).result.reason
		).toBe('use_complete');
		const unknown = t.add('Kaas');
		expect(
			t.apply({ type: 'item.purchasePartial', itemId: unknown, quantity: 1, unit: null }).result
				.reason
		).toBe('unknown_quantity');
	});

	it('removing a partly bought item books what was bought, once', () => {
		const id = t.add('Melk', 3, 'pak');
		const pid = t.item(id).productId;
		t.apply({ type: 'item.purchasePartial', itemId: id, quantity: 2, unit: 'pak' });
		t.apply({ type: 'item.delete', itemId: id });
		const [c] = t.cycles(pid);
		expect(c.completed_at).not.toBeNull();
		expect(c.cancelled_at).toBeNull();
		expect(c.quantity).toBe(2);
	});

	it('"Niet verkrijgbaar" records no purchase and is reset by a new round', () => {
		const id = t.add('Basilicum');
		t.apply({ type: 'item.setUnavailable', itemId: id, unavailable: true });
		expect(t.item(id).unavailableAt).not.toBeNull();
		expect(t.item(id).status).toBe('active');
		expect(t.productOf(id).purchaseCount).toBe(0);

		t.apply({
			type: 'round.join',
			roundId: uid('round'),
			listId: 'default',
			deviceId: 'dev-a',
			deviceName: 'Timo'
		});
		expect(t.item(id).unavailableAt).toBeNull();
	});

	it('"Opnieuw proberen" without a round clears the flags explicitly', () => {
		const id = t.add('Basilicum');
		t.apply({ type: 'item.setUnavailable', itemId: id, unavailable: true });
		t.apply({ type: 'list.retryUnavailable', listId: 'default' });
		expect(t.item(id).unavailableAt).toBeNull();
	});
});

describe('combined adds (bulk, bundle, share)', () => {
	const entry = (name: string, extra: Partial<AddManyEntry> = {}): AddManyEntry => ({
		itemId: uid('item'),
		productId: uid('prod'),
		name,
		quantity: null,
		unit: null,
		categoryId: null,
		note: null,
		action: 'add',
		...extra
	});

	it('adds, skips and increments per explicit intent', () => {
		const melk = t.add('Melk', 2);
		const brood = t.add('Brood');
		const r = t.apply({
			type: 'items.addMany',
			listId: 'default',
			entries: [
				entry('Melk', { quantity: 1, action: 'extra' }),
				entry('Brood', { quantity: 3 }),
				entry('Komkommer', { quantity: 2 }),
				entry('Gehakt', { quantity: 500, unit: 'g' })
			]
		}).result;
		expect(r.status).toBe('applied');
		expect(r.summary).toEqual({ added: 2, reactivated: 0, increased: 1, set: 0, unchanged: 1 });
		expect(t.item(melk).quantity).toBe(3);
		expect(t.item(brood).quantity).toBeNull();
	});

	it('is all-or-nothing: one invalid intent rolls back every entry', () => {
		const brood = t.add('Brood'); // unknown quantity: +extra is impossible
		const before = t.snap().items.length;
		const r = t.apply({
			type: 'items.addMany',
			listId: 'default',
			entries: [entry('Komkommer'), entry('Brood', { quantity: 1, action: 'extra' })]
		}).result;
		expect(r.status).toBe('rejected');
		expect(t.snap().items.length).toBe(before);
		expect(t.snap().products.some((p) => p.name === 'Komkommer')).toBe(false);
		expect(t.item(brood).quantity).toBeNull();
	});

	it('a double-sent confirmation doubles nothing', () => {
		const melk = t.add('Melk', 2);
		const payload: OpPayload = {
			type: 'items.addMany',
			listId: 'default',
			entries: [entry('Melk', { quantity: 1, action: 'extra' }), entry('Eieren', { quantity: 10 })]
		};
		const first = t.apply(payload, { id: 'confirm-1' });
		const second = t.apply(payload, { id: 'confirm-1' });
		expect(second.result).toEqual(first.result);
		expect(t.item(melk).quantity).toBe(3);
		expect(t.snap().items.filter((i) => i.status === 'active').length).toBe(2);
	});
});

describe('product memory', () => {
	it('stores usual quantity, preferred list and note; aliases point to the same product', () => {
		t.apply({ type: 'list.create', listId: 'drogist', name: 'Drogist' });
		const id = t.add('Wc-papier', null, null, 'drogist');
		const pid = t.item(id).productId;
		t.apply({
			type: 'product.update',
			productId: pid,
			changes: {
				defaultQuantity: 2,
				defaultUnit: 'pak',
				preferredListId: 'drogist',
				note: 'zacht'
			},
			base: {}
		});
		t.apply({ type: 'alias.add', aliasId: 'a1', productId: pid, alias: 'toiletpapier' });
		const p = t.snap().products.find((x) => x.id === pid)!;
		expect(p).toMatchObject({
			defaultQuantity: 2,
			defaultUnit: 'pak',
			preferredListId: 'drogist',
			note: 'zacht'
		});
		expect(t.snap().aliases).toEqual([
			expect.objectContaining({ id: 'a1', productId: pid, alias: 'toiletpapier' })
		]);

		// Adding by alias finds the same product id; no new product is created.
		const count = t.snap().products.length;
		const other = t.apply({
			type: 'item.add',
			itemId: uid('item'),
			productId: uid('prod'),
			listId: 'default',
			name: 'Toiletpapier',
			quantity: null,
			unit: null,
			categoryId: null
		}).result;
		expect(other.productId).toBe(pid);
		expect(t.snap().products.length).toBe(count);
	});

	it('refuses an alias that is another product’s name or alias', () => {
		const a = t.item(t.add('Wc-papier')).productId;
		t.add('Keukenpapier');
		expect(
			t.apply({ type: 'alias.add', aliasId: 'x', productId: a, alias: 'keukenpapier' }).result
				.status
		).toBe('rejected');
	});

	it('per-list walking route falls back to the global order', () => {
		t.apply({
			type: 'list.setCategoryOrder',
			listId: 'default',
			categoryIds: ['cat-zuivel', 'cat-groente', 'unknown']
		});
		expect(t.snap().lists[0].categoryOrder).toEqual(['cat-zuivel', 'cat-groente']);
		t.apply({ type: 'list.setCategoryOrder', listId: 'default', categoryIds: null });
		expect(t.snap().lists[0].categoryOrder).toBeNull();
	});

	it('notes: item note is per purchase, product note stays', () => {
		const id = t.add('Boter');
		t.apply({
			type: 'item.update',
			itemId: id,
			changes: { note: 'voor zaterdag', substituteOk: true, substituteNote: 'ander merk ok' },
			base: {}
		});
		expect(t.item(id)).toMatchObject({
			note: 'voor zaterdag',
			substituteOk: true,
			substituteNote: 'ander merk ok'
		});
		t.apply({ type: 'item.complete', itemId: id });
		t.tick(3 * DAY);
		t.apply({ type: 'item.reactivate', itemId: id });
		expect(t.item(id)).toMatchObject({ note: null, substituteOk: false, substituteNote: null });
	});

	it('shared snooze with an end time', () => {
		const pid = t.item(t.add('Koffie')).productId;
		t.apply({ type: 'product.snooze', productId: pid, until: t.now() + 2 * DAY });
		expect(t.snap().snoozes).toEqual([{ productId: pid, until: t.now() + 2 * DAY }]);
		t.tick(3 * DAY);
		expect(t.snap().snoozes).toEqual([]);
	});

	it('stock status is manual, timestamped and never touched by checklists or predictions', () => {
		const id = t.add('Koffie');
		const pid = t.item(id).productId;
		t.apply({ type: 'product.setStock', productId: pid, status: 'low' });
		expect(t.productOf(id)).toMatchObject({ stockStatus: 'low', stockUpdatedAt: t.now() });
		t.apply({ type: 'item.complete', itemId: id });
		expect(t.productOf(id).stockStatus).toBe('low');
	});
});

describe('checklists', () => {
	it('ticking off and resetting never records purchases; the grocery list keeps working', () => {
		t.apply({ type: 'list.create', listId: 'kamperen', name: 'Kamperen', kind: 'checklist' });
		const camp = t.add('Zaklamp', null, null, 'kamperen');
		const shop = t.add('Zaklamp', null, null, 'default');
		const pid = t.item(camp).productId;
		expect(t.item(shop).productId).toBe(pid);

		t.apply({ type: 'item.complete', itemId: camp });
		expect(t.item(camp).status).toBe('completed');
		expect(t.productOf(camp).purchaseCount).toBe(0);
		expect(t.cycles(pid).filter((c) => c.completed_at).length).toBe(0);

		const reset = t.apply({ type: 'list.resetChecklist', listId: 'kamperen', itemIds: [camp] });
		expect(t.item(camp).status).toBe('active');
		expect(t.productOf(camp).purchaseCount).toBe(0);
		t.apply({ type: 'undo', targetOpId: reset.op.id });
		expect(t.item(camp).status).toBe('completed');

		t.apply({ type: 'item.complete', itemId: shop });
		expect(t.productOf(shop).purchaseCount).toBe(1);
		expect(t.productOf(shop).stockStatus).toBe('unknown');
	});

	it('changing the kind keeps history and invents no purchases', () => {
		const id = t.add('Tent');
		t.apply({ type: 'item.complete', itemId: id });
		t.apply({ type: 'item.reactivate', itemId: id });
		const pid = t.item(id).productId;
		t.apply({ type: 'list.setKind', listId: 'default', kind: 'checklist' });
		const c = t.cycles(pid);
		expect(c.filter((x) => x.completed_at).length).toBe(1);
		expect(c.filter((x) => x.cancelled_at).length).toBe(1);
		expect(t.snap().lists[0]).toMatchObject({ kind: 'checklist', kindChangedAt: t.now() });
		t.apply({ type: 'item.complete', itemId: id });
		expect(t.productOf(id).purchaseCount).toBe(1);
	});
});

describe('bundles', () => {
	it('save, copy and delete without touching products or history', () => {
		const id = t.add('Eieren', 6);
		t.apply({ type: 'item.complete', itemId: id });
		t.apply({
			type: 'bundle.save',
			bundleId: 'b1',
			name: 'Pannenkoeken',
			servings: 4,
			lines: [
				{ lineId: 'l1', productId: uid('p'), name: 'Eieren', quantity: 3, unit: null, note: null },
				{
					lineId: 'l2',
					productId: uid('p'),
					name: 'Bloem',
					quantity: 500,
					unit: 'g',
					note: 'zelfrijzend'
				}
			]
		});
		const b = t.snap().bundles[0];
		expect(b).toMatchObject({ name: 'Pannenkoeken', servings: 4 });
		expect(b.lines.map((l) => l.note)).toEqual([null, 'zelfrijzend']);
		expect(b.lines[0].productId).toBe(t.item(id).productId);

		const dupe = t.apply({
			type: 'bundle.save',
			bundleId: 'b2',
			name: 'Pannenkoeken (kopie)',
			servings: 4,
			lines: b.lines.map((l, i) => ({
				lineId: `copy-${i}`,
				productId: l.productId,
				name: t.snap().products.find((p) => p.id === l.productId)!.name,
				quantity: l.quantity,
				unit: l.unit,
				note: l.note
			}))
		}).result;
		expect(dupe.status).toBe('applied');
		t.apply({ type: 'bundle.delete', bundleId: 'b1' });
		expect(t.snap().bundles.map((x) => x.id)).toEqual(['b2']);
		expect(t.productOf(id).purchaseCount).toBe(1);
	});
});

describe('shared shopping rounds and claims', () => {
	const join = (deviceId: string, name: string, roundId = uid('round')) =>
		t.apply({ type: 'round.join', roundId, listId: 'default', deviceId, deviceName: name }).result;

	it('a second device joins instead of starting a competing round', () => {
		const a = join('dev-a', 'Timo');
		const b = join('dev-b', 'Sam');
		expect(b.roundId).toBe(a.roundId);
		const rounds = t.snap().rounds;
		expect(rounds).toHaveLength(1);
		expect(rounds[0].participants.map((p) => p.deviceName)).toEqual(['Timo', 'Sam']);
	});

	it('ending books nothing; leaving last ends the round', () => {
		const id = t.add('Melk');
		const r = join('dev-a', 'Timo');
		t.apply({ type: 'round.leave', roundId: r.roundId!, deviceId: 'dev-a' });
		expect(t.snap().rounds).toHaveLength(0);
		expect(t.item(id).status).toBe('active');
		expect(t.productOf(id).purchaseCount).toBe(0);
	});

	it('claims show who picks what, expire, and never block buying', () => {
		const id = t.add('Melk');
		join('dev-a', 'Timo');
		join('dev-b', 'Sam');
		t.apply({ type: 'item.claim', itemId: id, deviceId: 'dev-a', deviceName: 'Timo' });
		const other = t.apply({
			type: 'item.claim',
			itemId: id,
			deviceId: 'dev-b',
			deviceName: 'Sam'
		}).result;
		expect(other).toMatchObject({ status: 'noop', reason: 'claimed' });
		expect(other.message).toContain('Timo');
		// Buying is never blocked by a claim.
		expect(
			t.apply({ type: 'item.complete', itemId: id }, { client: 'client-b' }).result.status
		).toBe('applied');
		expect(t.snap().claims).toHaveLength(0);

		const id2 = t.add('Kaas');
		t.apply({ type: 'item.claim', itemId: id2, deviceId: 'dev-a', deviceName: 'Timo' });
		t.tick(CLAIM_TTL_MS + 1);
		expect(t.snap().claims).toHaveLength(0);
		expect(
			t.apply({ type: 'item.claim', itemId: id2, deviceId: 'dev-b', deviceName: 'Sam' }).result
				.status
		).toBe('applied');
	});

	it('idle rounds end so nobody is "shopping" forever', () => {
		join('dev-a', 'Timo');
		t.tick(ROUND_IDLE_MS + 1);
		expect(t.store.maintenance(t.now())).toBe(true);
		expect(t.snap().rounds).toHaveLength(0);
	});

	it('items added after the start are recognisable', () => {
		join('dev-a', 'Timo');
		const startedAt = t.snap().rounds[0].startedAt;
		t.tick(60_000);
		const id = t.add('Chips');
		expect(t.item(id).activatedAt).toBeGreaterThan(startedAt);
	});
});
