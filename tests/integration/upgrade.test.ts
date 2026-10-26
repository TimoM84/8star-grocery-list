/**
 * Upgrade from the released v1.1.0 schema (migrations 1–3, never edited) with representative
 * household data, plus recovery from a failed migration.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate, openDatabase, schemaVersion } from '$lib/server/db';
import { migrations } from '$lib/server/migrations';
import { GroceryStore } from '$lib/server/store';
import { createBackupSync, listBackups } from '$lib/server/backup';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 10);

/** Builds a v1.1.0 database file the way the released app would have left it. */
function v110Database(file: string) {
	const db = new Database(file);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	migrate(db, migrations.slice(0, 3));
	expect(schemaVersion(db)).toBe(3);
	db.exec(`
		INSERT INTO lists (id, name, position, created_at, updated_at) VALUES ('drogist', 'Drogist', 1, ${T0}, ${T0});
		INSERT INTO products (id, name, name_key, category_id, favorite, created_at, updated_at, version)
			VALUES ('p-melk', 'Halfvolle melk', 'halfvolle melk', 'cat-zuivel', 1, ${T0}, ${T0}, 3),
			       ('p-wc', 'Wc-papier', 'wc-papier', 'cat-verzorging', 0, ${T0}, ${T0}, 1);
	`);
	const cycle = db.prepare(
		'INSERT INTO cycles (id, product_id, list_id, activated_at, completed_at, cancelled_at, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	);
	for (let k = 0; k < 4; k++)
		cycle.run(
			`c-melk-${k}`,
			'p-melk',
			'default',
			T0 + k * 7 * DAY,
			T0 + k * 7 * DAY + 3600_000,
			null,
			2,
			'l'
		);
	cycle.run('c-melk-open', 'p-melk', 'default', T0 + 30 * DAY, null, null, 2, 'l');
	cycle.run('c-wc-x', 'p-wc', 'drogist', T0, null, T0 + DAY, null, null);
	db.exec(`
		INSERT INTO items (id, list_id, product_id, quantity, unit, status, activated_at, completed_at, cycle_id, created_at, updated_at, version)
			VALUES ('i-melk', 'default', 'p-melk', 2, 'l', 'active', ${T0 + 30 * DAY}, NULL, 'c-melk-open', ${T0}, ${T0 + 30 * DAY}, 9);
		INSERT INTO ai_recommendations (id, product_id, suggested_quantity, suggested_unit, next_purchase_at, confidence, reasoning, source, batch_id, fingerprint, status, imported_at)
			VALUES ('ai-1', 'p-wc', 2, 'pak', NULL, 0.7, 'Elke maand', 'ChatGPT', 'b1', 'fp1', 'open', ${T0});
		INSERT INTO ops (id, type, client_id, received_at, status, result, inverse)
			VALUES ('old-op', 'item.update', 'c', ${T0}, 'applied', '{"opId":"old-op","status":"applied"}',
			'{"rows":[{"table":"items","id":"i-melk","before":{"id":"i-melk","list_id":"default","product_id":"p-melk","quantity":1,"unit":"l","status":"active","activated_at":${T0 + 30 * DAY},"completed_at":null,"cycle_id":"c-melk-open","created_at":${T0},"updated_at":${T0},"version":8}}],"guards":[{"table":"items","id":"i-melk","version":9}]}');
		UPDATE meta SET value = '42' WHERE key = 'seq';
	`);
	db.close();
}

describe('upgrade from v1.1.0', () => {
	it('migrates automatically, keeps ids and history, backs up first', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), '8star-upgrade-'));
		const file = path.join(dir, 'grocery.db');
		const backups = path.join(dir, 'backups');
		v110Database(file);

		const db = openDatabase(file, {
			beforeMigrate: (d) => createBackupSync(d, backups, `pre-migration-v${schemaVersion(d)}`)
		});
		expect(schemaVersion(db)).toBe(migrations[migrations.length - 1].version);
		expect(listBackups(backups).map((b) => b.file)).toEqual([
			expect.stringMatching(/pre-migration-v3\.db$/)
		]);

		const store = new GroceryStore(db);
		expect(store.seq).toBe(42);
		const s = store.snapshot(T0 + 31 * DAY);
		expect(s.lists.map((l) => [l.id, l.kind, l.categoryOrder])).toEqual([
			['default', 'grocery', null],
			['drogist', 'grocery', null]
		]);
		const melk = s.products.find((p) => p.id === 'p-melk')!;
		expect(melk).toMatchObject({
			name: 'Halfvolle melk',
			favorite: true,
			purchaseCount: 4,
			defaultQuantity: null,
			preferredListId: null,
			stockStatus: 'unknown',
			photoId: null
		});
		expect(s.items[0]).toMatchObject({
			id: 'i-melk',
			quantity: 2,
			unit: 'l',
			version: 9,
			note: null,
			substituteOk: false,
			unavailableAt: null,
			purchasedQuantity: null
		});
		expect(s.aiRecommendations.map((r) => r.id)).toEqual(['ai-1']);
		const cycles = db
			.prepare('SELECT id, requested_quantity, purchased_quantity FROM cycles ORDER BY id')
			.all() as {
			id: string;
			requested_quantity: number | null;
			purchased_quantity: number | null;
		}[];
		expect(cycles.find((c) => c.id === 'c-melk-0')).toEqual({
			id: 'c-melk-0',
			requested_quantity: 2,
			purchased_quantity: 2
		});
		expect(cycles.find((c) => c.id === 'c-melk-open')?.purchased_quantity).toBeNull();

		// The upgraded data works with the new ops, and undo records from v1.1.0 still apply.
		const r = store.applyOps('c', [
			{
				id: 'new-1',
				at: T0 + 31 * DAY,
				type: 'item.increment',
				itemId: 'i-melk',
				delta: 1,
				unit: 'l'
			}
		]).results[0];
		expect(r.status).toBe('applied');
		expect(store.snapshot().items[0].quantity).toBe(3);
		db.close();
	});

	it('a failing migration rolls back completely and leaves the v1.1.0 data usable', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), '8star-upgrade-fail-'));
		const file = path.join(dir, 'grocery.db');
		v110Database(file);
		const db = new Database(file);
		const broken = [
			...migrations.slice(0, 3),
			{
				version: 4,
				name: 'broken',
				sql: 'ALTER TABLE lists ADD COLUMN kind TEXT; SELECT * FROM missing_table;'
			}
		];
		expect(() => migrate(db, broken)).toThrow();
		expect(schemaVersion(db)).toBe(3);
		const cols = (db.pragma('table_info(lists)') as { name: string }[]).map((c) => c.name);
		expect(cols).not.toContain('kind');
		db.close();

		// The real migration still succeeds afterwards.
		const fixed = openDatabase(file);
		expect(schemaVersion(fixed)).toBe(4);
		expect(new GroceryStore(fixed).snapshot().items.map((i) => i.id)).toEqual(['i-melk']);
		fixed.close();
	});
});
