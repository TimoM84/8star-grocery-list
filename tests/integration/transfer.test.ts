import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { openDatabase } from '$lib/server/db';
import { GroceryStore } from '$lib/server/store';
import { buildExport, exportData } from '$lib/server/transfer/format';
import { runImport, type ImportKind, type ImportMode } from '$lib/server/transfer/importer';
import { csvFor, exportZip } from '$lib/server/export';
import { parseCsv } from '$lib/server/transfer/csv';
import type { Op, OpPayload } from '$lib/shared/ops';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 9, 30, 15, 123);
let opSeq = 0;

function makeStore() {
	return new GroceryStore(openDatabase(':memory:'));
}

function apply(store: GroceryStore, payload: OpPayload, at: number) {
	const op = { id: `op-${++opSeq}`, at, ...payload } as Op;
	return store.applyOps('test', [op], at).results[0];
}

function add(store: GroceryStore, name: string, at: number, extra: Record<string, unknown> = {}) {
	return apply(
		store,
		{
			type: 'item.add',
			itemId: `item-${++opSeq}`,
			productId: `prod-${opSeq}`,
			listId: 'default',
			name,
			quantity: null,
			unit: null,
			categoryId: null,
			...extra
		} as OpPayload,
		at
	);
}

const backupDir = () => fs.mkdtempSync(path.join(os.tmpdir(), '8star-bk-'));

function run(
	store: GroceryStore,
	kind: ImportKind,
	text: string,
	mode: ImportMode = 'merge',
	preview = false
) {
	return runImport(store, {
		kind,
		mode,
		text,
		preview,
		backupDir: backupDir(),
		now: T0 + 400 * DAY
	});
}

/** A realistic dataset covering every entity type and state. */
function richStore() {
	const s = makeStore();
	apply(s, { type: 'list.create', listId: 'markt', name: 'Markt' }, T0);
	apply(s, { type: 'category.create', categoryId: 'cat-baby', name: 'Baby' }, T0);
	const melk = add(s, 'Halfvolle melk', T0, { quantity: 2, unit: 'l', categoryId: 'cat-zuivel' });
	for (let i = 1; i <= 5; i++) {
		apply(s, { type: 'item.complete', itemId: melk.itemId! }, T0 + i * 7 * DAY);
		apply(s, { type: 'item.reactivate', itemId: melk.itemId! }, T0 + i * 7 * DAY + 3600_000);
	}
	const brood = add(s, 'Brood', T0 + DAY);
	apply(s, { type: 'item.complete', itemId: brood.itemId! }, T0 + 2 * DAY);
	const luiers = add(s, 'Luiers', T0 + DAY, { listId: 'markt', categoryId: 'cat-baby' });
	apply(s, { type: 'item.delete', itemId: luiers.itemId! }, T0 + 3 * DAY); // cancelled cycle
	add(s, 'Tomaten', T0 + 4 * DAY, { listId: 'markt' });
	const prod = s.snapshot().products.find((p) => p.name === 'Brood')!;
	apply(
		s,
		{ type: 'product.update', productId: prod.id, changes: { favorite: true }, base: {} },
		T0 + 5 * DAY
	);

	const ids = Object.fromEntries(s.snapshot().products.map((p) => [p.name, p.id]));
	const ai = run(
		s,
		'ai',
		JSON.stringify({
			format: '8star-ai-recommendations',
			formatVersion: 1,
			source: 'Test-AI',
			recommendations: [
				{
					productId: ids['Brood'],
					suggestedQuantity: 2,
					confidence: 0.9,
					reasoning: 'Elke 2 dagen.'
				},
				{
					productId: ids['Tomaten'],
					suggestedQuantity: 500,
					unit: 'g',
					nextPurchaseDate: '2027-02-10',
					confidence: 0.4,
					reasoning: 'Seizoen.'
				}
			]
		})
	);
	expect(ai.ok).toBe(true);
	const recs = s.snapshot().aiRecommendations;
	apply(
		s,
		{ type: 'ai.dismiss', recommendationId: recs.find((r) => r.productId === ids['Tomaten'])!.id },
		T0 + 6 * DAY
	);
	return s;
}

describe('JSON export', () => {
	it('is versioned and contains every entity with ISO timestamps', () => {
		const s = richStore();
		const file = buildExport(s.db, '1.1.0', T0 + 10 * DAY);
		expect(file).toMatchObject({
			format: '8star-grocery-export',
			formatVersion: 1,
			databaseSchemaVersion: 3
		});
		expect(file.exportedAt).toBe(new Date(T0 + 10 * DAY).toISOString());
		const d = file.data;
		expect(d.lists.map((l) => l.id)).toEqual(['default', 'markt']);
		expect(d.purchaseEvents.filter((e) => e.status === 'purchased')).toHaveLength(6);
		expect(d.purchaseEvents.filter((e) => e.status === 'cancelled')).toHaveLength(1);
		expect(d.purchaseEvents.filter((e) => e.status === 'open')).toHaveLength(2);
		expect(d.aiRecommendations.map((r) => r.status).sort()).toEqual(['dismissed', 'open']);
		expect(d.purchaseEvents[0].activatedAt).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
		);
		const melk = file.statistics!.find(
			(x) => (x as { name: string }).name === 'Halfvolle melk'
		) as {
			purchaseCount: number;
			avgIntervalDays: number;
		};
		expect(melk.purchaseCount).toBe(5);
		expect(melk.avgIntervalDays).toBeCloseTo(7, 1);
	});
});

describe('JSON restore (replace)', () => {
	it('round-trips the complete dataset: export → restore → export is identical', () => {
		const source = richStore();
		const first = buildExport(source.db, '1.1.0');
		const target = makeStore();
		add(target, 'Iets anders', T0);
		const report = run(target, 'json', JSON.stringify(first), 'replace');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(report.backupFile).toMatch(/pre-import/);
		const second = buildExport(target.db, '1.1.0');
		expect(second.data).toEqual(first.data);
		// And the restored data behaves: the open melk item can be completed with history intact.
		const melkItem = target
			.snapshot()
			.items.find((i) => i.status === 'active' && i.listId === 'default')!;
		apply(target, { type: 'item.complete', itemId: melkItem.id }, T0 + 60 * DAY);
		expect(target.snapshot().products.find((p) => p.name === 'Halfvolle melk')!.purchaseCount).toBe(
			6
		);
	});

	it('preview changes nothing and reports what would be removed', () => {
		const target = richStore();
		const before = JSON.stringify(exportData(target.db));
		const seq = target.seq;
		const epoch = target.epoch;
		const file = buildExport(makeStore().db, '1.1.0');
		const report = run(target, 'json', JSON.stringify(file), 'replace', true);
		expect(report.ok).toBe(true);
		expect(report.preview).toBe(true);
		expect(report.counts.products.removed).toBe(4);
		expect(report.summary.join(' ')).toMatch(/worden verwijderd/);
		expect(JSON.stringify(exportData(target.db))).toBe(before);
		expect(target.seq).toBe(seq);
		expect(target.epoch).toBe(epoch);
	});

	it('starts a new epoch, bumps seq and disables undo of earlier ops', () => {
		const s = makeStore();
		const added = add(s, 'Kaas', T0);
		const done = apply(s, { type: 'item.complete', itemId: added.itemId! }, T0 + 1000);
		void done;
		const file = buildExport(s.db, '1.1.0');
		const epoch = s.epoch;
		const seq = s.seq;
		expect(run(s, 'json', JSON.stringify(file), 'replace').ok).toBe(true);
		expect(s.epoch).not.toBe(epoch);
		expect(s.seq).toBe(seq + 1);
		const undo = apply(s, { type: 'undo', targetOpId: `op-${opSeq}` }, T0 + 2000);
		expect(undo.status).toBe('noop');
		expect(s.snapshot().items[0].status).toBe('completed');
	});

	it('rejects invalid files completely, with readable errors', () => {
		const s = richStore();
		const before = JSON.stringify(exportData(s.db));
		const file = buildExport(s.db, '1.1.0');
		file.data.listItems[0].productId = 'does-not-exist';
		file.data.purchaseEvents[1].completedAt = 'gisteren';
		file.data.products.push({ ...file.data.products[0] });
		const report = run(s, 'json', JSON.stringify(file), 'replace');
		expect(report.ok).toBe(false);
		expect(report.errors.join('\n')).toMatch(/onbekend product/);
		expect(report.errors.join('\n')).toMatch(/ongeldige datum/);
		expect(report.errors.join('\n')).toMatch(/dubbele id/);
		expect(JSON.stringify(exportData(s.db))).toBe(before);
		expect(run(s, 'json', '{nope', 'replace').errors[0]).toMatch(/geen geldige JSON/);
		expect(run(s, 'json', JSON.stringify({ format: 'x' }), 'replace').errors[0]).toMatch(
			/geen 8star-export/
		);
		expect(
			run(s, 'json', JSON.stringify({ ...file, formatVersion: 99 }), 'replace').errors[0]
		).toMatch(/niet ondersteund/);
	});

	it('rolls back completely when something fails halfway', () => {
		const s = richStore();
		const before = JSON.stringify(exportData(s.db));
		const seq = s.seq;
		const file = buildExport(makeStore().db, '1.1.0');
		const spy = vi.spyOn(s, 'markDatasetReplaced').mockImplementation(() => {
			throw new Error('disk full');
		});
		const report = run(s, 'json', JSON.stringify(file), 'replace');
		spy.mockRestore();
		expect(report.ok).toBe(false);
		expect(report.errors[0]).toMatch(/teruggedraaid.*disk full/);
		expect(JSON.stringify(exportData(s.db))).toBe(before);
		expect(s.seq).toBe(seq);
	});

	it('imports the legacy v1.0.0 JSON export', () => {
		const s = richStore();
		const db = s.db;
		const legacy = {
			app: '8star-grocery-list',
			version: '1.0.0',
			exportedAt: new Date().toISOString(),
			lists: db.prepare('SELECT * FROM lists').all(),
			categories: db.prepare('SELECT * FROM categories').all(),
			products: db.prepare('SELECT * FROM products').all(),
			items: db.prepare('SELECT * FROM items').all(),
			cycles: db.prepare('SELECT * FROM cycles').all(),
			statistics: []
		};
		const target = makeStore();
		const report = run(target, 'json', JSON.stringify(legacy), 'replace');
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(report.warnings[0]).toMatch(/v1\.0\.0/);
		const a = exportData(s.db);
		const b = exportData(target.db);
		expect(b.purchaseEvents).toEqual(a.purchaseEvents);
		expect(b.listItems).toEqual(a.listItems);
		expect(b.products).toEqual(a.products);
	});
});

describe('JSON merge', () => {
	it('adds new data, keeps existing data, and is idempotent', () => {
		const source = richStore();
		const file = JSON.stringify(buildExport(source.db, '1.1.0'));
		const target = makeStore();
		// Target already has "brood" (different id, different case) with one purchase.
		const b = add(target, 'brood', T0 + 2 * DAY);
		apply(target, { type: 'item.complete', itemId: b.itemId! }, T0 + 2 * DAY);
		add(target, 'Koffie', T0);

		const report = run(target, 'json', file);
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(report.counts.products).toMatchObject({ added: 3, updated: 1 }); // brood gets favourite
		expect(report.counts.lists).toMatchObject({ matched: 1, added: 1 });
		const snap = target.snapshot();
		expect(snap.products.map((p) => p.name).sort()).toEqual(
			['Brood', 'Halfvolle melk', 'Koffie', 'Luiers', 'Tomaten'].sort()
		);
		expect(snap.products.find((p) => p.name === 'Brood')!.favorite).toBe(true);
		// Brood purchase at the same moment already existed → duplicate, not double-counted.
		expect(snap.products.find((p) => p.name === 'Brood')!.purchaseCount).toBe(1);
		expect(snap.products.find((p) => p.name === 'Halfvolle melk')!.purchaseCount).toBe(5);
		// Existing brood item stays as it was; new items arrive on the right lists.
		expect(snap.items.filter((i) => i.listId === 'markt')).toHaveLength(1);

		const again = run(target, 'json', file);
		expect(again.ok).toBe(true);
		const added = Object.values(again.counts).reduce((n, c) => n + c.added, 0);
		expect(added).toBe(0);
		expect(again.summary.join(' ')).toMatch(/al aanwezig/);
	});
});

function unzip(buf: Buffer): Map<string, string> {
	const files = new Map<string, string>();
	const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	const count = buf.readUInt16LE(end + 10);
	let p = buf.readUInt32LE(end + 16);
	for (let i = 0; i < count; i++) {
		const size = buf.readUInt32LE(p + 20);
		const nameLen = buf.readUInt16LE(p + 28);
		const offset = buf.readUInt32LE(p + 42);
		const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
		const localNameLen = buf.readUInt16LE(offset + 26);
		const data = buf.subarray(offset + 30 + localNameLen, offset + 30 + localNameLen + size);
		files.set(name, inflateRawSync(data).toString('utf8'));
		p += 46 + nameLen;
	}
	return files;
}

describe('CSV export', () => {
	it('builds a ZIP with all datasets', () => {
		const s = richStore();
		const files = unzip(exportZip(s.db));
		expect([...files.keys()].sort()).toEqual(
			[
				'README.txt',
				'categories.csv',
				'list-items.csv',
				'lists.csv',
				'products.csv',
				'purchases.csv',
				'statistics.csv'
			].sort()
		);
		const purchases = parseCsv(files.get('purchases.csv')!);
		expect(purchases[0]).toEqual([
			'purchase_id',
			'product_id',
			'product',
			'categorie',
			'lijst_id',
			'lijst',
			'status',
			'geactiveerd',
			'gekocht',
			'geannuleerd',
			'aantal',
			'eenheid'
		]);
		expect(purchases.filter((r) => r[6] === 'gekocht')).toHaveLength(6);
		const stats = parseCsv(files.get('statistics.csv')!);
		const melk = stats.find((r) => r[1] === 'Halfvolle melk')!;
		expect(melk[2]).toBe('5');
		expect(melk[5]).toBe('7');
	});
});

describe('CSV import', () => {
	it('imports products, creates categories, fills in missing data and detects duplicates', () => {
		const s = makeStore();
		add(s, 'Melk', T0);
		const csv = [
			'product;categorie;favoriet',
			'melk;Zuivel & eieren;ja',
			'Pindakaas;Ontbijt;nee',
			'"Rode wijn; Merlot";Dranken;ja',
			'pindakaas;;'
		].join('\r\n');
		const preview = run(s, 'products-csv', csv, 'merge', true);
		expect(preview.ok).toBe(true);
		expect(s.snapshot().products).toHaveLength(1);
		const report = run(s, 'products-csv', csv);
		expect(report.ok, report.errors.join()).toBe(true);
		expect(report.counts.products).toMatchObject({ added: 2, updated: 1, duplicates: 1 });
		expect(report.counts.categories.added).toBe(1);
		const snap = s.snapshot();
		expect(snap.products.find((p) => p.name === 'Melk')).toMatchObject({
			favorite: true,
			categoryId: 'cat-zuivel'
		});
		expect(snap.products.find((p) => p.name === 'Rode wijn; Merlot')!.favorite).toBe(true);
		expect(snap.categories.some((c) => c.name === 'Ontbijt')).toBe(true);
	});

	it('rejects a products CSV with invalid rows without changing anything', () => {
		const s = makeStore();
		const report = run(s, 'products-csv', 'product;categorie\nMelk;Zuivel\n;Leeg\n');
		expect(report.ok).toBe(false);
		expect(report.errors.join()).toMatch(/Regel 3/);
		expect(s.snapshot().products).toHaveLength(0);
		expect(run(s, 'products-csv', 'naam_fout\nx').errors[0]).toMatch(/product/);
	});

	it('round-trips purchases.csv and skips duplicates on re-import', () => {
		const source = richStore();
		const purchases = csvFor('purchases', exportData(source.db));
		const products = csvFor('products', exportData(source.db));
		const target = makeStore();
		apply(target, { type: 'list.create', listId: 'markt', name: 'Markt' }, T0);
		expect(run(target, 'products-csv', products).ok).toBe(true);
		const report = run(target, 'purchases-csv', purchases);
		expect(report.ok, report.errors.join()).toBe(true);
		expect(report.counts.purchaseEvents).toMatchObject({ added: 7, skipped: 2 });
		const src = exportData(source.db).purchaseEvents.filter((e) => e.status !== 'open');
		const dst = exportData(target.db).purchaseEvents;
		expect(
			dst
				.map((e) => [e.id, e.productId, e.listId, e.completedAt, e.cancelledAt, e.quantity, e.unit])
				.sort()
		).toEqual(
			src
				.map((e) => [e.id, e.productId, e.listId, e.completedAt, e.cancelledAt, e.quantity, e.unit])
				.sort()
		);
		const again = run(target, 'purchases-csv', purchases);
		expect(again.counts.purchaseEvents).toMatchObject({ added: 0, duplicates: 7 });
	});

	it('accepts hand-made purchase files with Dutch dates and creates missing products', () => {
		const s = makeStore();
		const csv = [
			'product,gekocht,aantal,eenheid,lijst',
			'Koffie,24-10-2026 18:30,"1,5",kg,Boodschappen',
			'Koffie,2026-10-10,1,pak,Onbekend',
			'Koffie,2026-10-10 12:00:30,,,'
		].join('\n');
		const report = run(s, 'purchases-csv', csv);
		expect(report.ok, report.errors.join()).toBe(true);
		expect(report.counts.products.added).toBe(1);
		// The third row is within a minute of the second → duplicate.
		expect(report.counts.purchaseEvents).toMatchObject({ added: 2, duplicates: 1 });
		expect(report.warnings.join()).toMatch(/Onbekend/);
		const events = exportData(s.db).purchaseEvents;
		expect(events.map((e) => e.quantity).sort()).toEqual([1, 1.5]);
		expect(events.find((e) => e.quantity === 1.5)!.listId).toBe('default');
		expect(s.snapshot().products[0].purchaseCount).toBe(2);
	});

	it('reports bad dates per line', () => {
		const s = makeStore();
		const report = run(s, 'purchases-csv', 'product;gekocht\nMelk;morgen\nKaas;2026-13-45');
		expect(report.ok).toBe(false);
		expect(report.errors.filter((e) => e.startsWith('Regel'))).toHaveLength(2);
	});
});

describe('AI recommendations', () => {
	function aiFile(recommendations: unknown[]) {
		return JSON.stringify({
			format: '8star-ai-recommendations',
			formatVersion: 1,
			source: 'ChatGPT',
			recommendations
		});
	}

	it('validates entries, imports valid ones and prevents duplicates', () => {
		const s = makeStore();
		add(s, 'Melk', T0);
		add(s, 'Brood', T0);
		const ids = Object.fromEntries(s.snapshot().products.map((p) => [p.name, p.id]));
		const file = aiFile([
			{
				productId: ids.Melk,
				suggestedQuantity: 2,
				unit: 'liter',
				nextPurchaseDate: '2026-11-02',
				confidence: 0.82,
				reasoning: 'Wekelijks.'
			},
			{ productId: 'onbekend', confidence: 0.5, reasoning: 'x' },
			{ productId: ids.Brood, confidence: 85, reasoning: 'Te zeker.' },
			{ productId: ids.Brood, productName: 'Kaas', confidence: 0.6, reasoning: 'Elke 3 dagen.' }
		]);
		const report = run(s, 'ai', file);
		expect(report.ok).toBe(true);
		expect(report.counts.aiRecommendations).toMatchObject({ added: 2, skipped: 2 });
		expect(report.warnings.join('\n')).toMatch(/bestaat niet/);
		expect(report.warnings.join('\n')).toMatch(/tussen 0 en 1/);
		expect(report.warnings.join('\n')).toMatch(/hoort niet bij/);
		const recs = s.snapshot().aiRecommendations;
		expect(recs[0]).toMatchObject({
			productId: ids.Melk,
			suggestedQuantity: 2,
			suggestedUnit: 'l',
			confidence: 0.82,
			source: 'ChatGPT'
		});
		expect(new Date(recs[0].nextPurchaseAt!).toISOString().slice(0, 10)).toBe('2026-11-02');

		const again = run(s, 'ai', file);
		expect(again.counts.aiRecommendations).toMatchObject({ added: 0, duplicates: 2 });

		const newer = run(
			s,
			'ai',
			aiFile([
				{ productId: ids.Melk, suggestedQuantity: 3, confidence: 0.9, reasoning: 'Nieuwe analyse.' }
			])
		);
		expect(newer.counts.aiRecommendations).toMatchObject({ updated: 1 });
		expect(s.snapshot().aiRecommendations).toHaveLength(2);

		expect(run(s, 'ai', aiFile([{ productId: 'x', confidence: 1, reasoning: 'r' }])).ok).toBe(
			false
		);
		expect(run(s, 'ai', JSON.stringify({ format: 'nope' })).errors[0]).toMatch(
			/Geen AI-suggestiebestand/
		);
	});

	it('accepting adds the product to a list without touching purchase history; undo and dismiss work', () => {
		const s = makeStore();
		const melk = add(s, 'Melk', T0);
		apply(s, { type: 'item.complete', itemId: melk.itemId! }, T0 + DAY);
		const pid = s.snapshot().products[0].id;
		run(
			s,
			'ai',
			aiFile([
				{ productId: pid, suggestedQuantity: 2, unit: 'l', confidence: 0.7, reasoning: 'Bijna op.' }
			])
		);
		const rec = s.snapshot().aiRecommendations[0];
		const accepted = apply(
			s,
			{ type: 'ai.accept', recommendationId: rec.id, listId: 'default', itemId: 'new-item' },
			T0 + 2 * DAY
		);
		expect(accepted).toMatchObject({ status: 'applied', undoable: true });
		let snap = s.snapshot();
		expect(snap.aiRecommendations).toHaveLength(0);
		expect(snap.items[0]).toMatchObject({ status: 'active', quantity: 2, unit: 'l' });
		expect(snap.products[0].purchaseCount).toBe(1);
		expect(
			apply(s, { type: 'ai.accept', recommendationId: rec.id, listId: 'default', itemId: 'x2' }, T0)
				.status
		).toBe('noop');

		apply(s, { type: 'undo', targetOpId: `op-${opSeq - 1}` }, T0 + 3 * DAY);
		snap = s.snapshot();
		expect(snap.aiRecommendations).toHaveLength(1);
		expect(snap.items[0].status).toBe('completed');

		apply(s, { type: 'ai.dismiss', recommendationId: rec.id }, T0 + 4 * DAY);
		expect(s.snapshot().aiRecommendations).toHaveLength(0);
		const row = s.db.prepare('SELECT status FROM ai_recommendations').get() as { status: string };
		expect(row.status).toBe('dismissed');
	});

	it('removes recommendations together with their product', () => {
		const s = makeStore();
		add(s, 'Melk', T0);
		const pid = s.snapshot().products[0].id;
		run(s, 'ai', aiFile([{ productId: pid, confidence: 0.7, reasoning: 'r' }]));
		apply(s, { type: 'product.delete', productId: pid }, T0);
		expect(
			(s.db.prepare('SELECT COUNT(*) n FROM ai_recommendations').get() as { n: number }).n
		).toBe(0);
	});
});
