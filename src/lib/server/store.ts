/**
 * Server-side domain logic. SQLite is the single source of truth; every mutation arrives as an
 * idempotent operation (see src/lib/shared/ops.ts and docs/SYNC.md).
 */

import type { DB } from './db';
import { randomBytes } from 'node:crypto';
import type { AiRecommendation, Category, Item, List, Product, Snapshot } from '$lib/shared/types';
import {
	parseOp,
	UNDOABLE_TYPES,
	ValidationError,
	type FieldConflict,
	type Op,
	type OpResult,
	type OpsResponse
} from '$lib/shared/ops';
import { capitaliseFirst, cleanName, compareNl, nameKey } from '$lib/shared/text';

/** Max completion timestamps per product included in snapshots (enough for local stats). */
export const SNAPSHOT_COMPLETIONS = 200;
/** Ops older than this are pruned from the idempotency log (undo is short-lived anyway). */
export const OP_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** Clients may not stamp operations further in the future than this. */
const MAX_CLOCK_SKEW_MS = 60 * 1000;

type Table = 'lists' | 'categories' | 'products' | 'ai_recommendations' | 'cycles' | 'items';
type VersionedTable = 'items' | 'products' | 'ai_recommendations';
type Row = Record<string, unknown>;

interface ListRow {
	id: string;
	name: string;
	position: number;
	created_at: number;
	updated_at: number;
}
type CategoryRow = ListRow;
interface ProductRow {
	id: string;
	name: string;
	name_key: string;
	category_id: string | null;
	favorite: number;
	created_at: number;
	updated_at: number;
	version: number;
}
interface ItemRow {
	id: string;
	list_id: string;
	product_id: string;
	quantity: number | null;
	unit: string | null;
	status: 'active' | 'completed';
	activated_at: number;
	completed_at: number | null;
	cycle_id: string | null;
	created_at: number;
	updated_at: number;
	version: number;
}
interface AiRecommendationRow {
	id: string;
	product_id: string;
	suggested_quantity: number | null;
	suggested_unit: string | null;
	next_purchase_at: number | null;
	confidence: number;
	reasoning: string;
	source: string | null;
	batch_id: string;
	fingerprint: string;
	status: 'open' | 'accepted' | 'dismissed';
	imported_at: number;
	resolved_at: number | null;
	version: number;
}

interface Inverse {
	rows: { table: Table; id: string; before: Row | null }[];
	guards: { table: VersionedTable; id: string; version: number | null }[];
}

type Outcome = Omit<OpResult, 'opId' | 'undoable'>;

class Rejection extends Error {
	constructor(
		public reason: string,
		message: string
	) {
		super(message);
	}
}

const TABLE_ORDER: Table[] = [
	'lists',
	'categories',
	'products',
	'ai_recommendations',
	'cycles',
	'items'
];
const VERSIONED = new Set<Table>(['items', 'products', 'ai_recommendations']);
const PK_TABLES = new Set<Table>(TABLE_ORDER);

export interface HistoryEntry {
	cycleId: string;
	productId: string;
	productName: string;
	listId: string | null;
	listName: string | null;
	activatedAt: number;
	completedAt: number | null;
	cancelledAt: number | null;
	quantity: number | null;
	unit: string | null;
}

export class GroceryStore {
	private seqValue: number;
	private listeners = new Set<(seq: number) => void>();
	/** Rows captured (before-images) during the op currently being applied. */
	private captured: Map<string, { table: Table; id: string; before: Row | null }> | null = null;

	constructor(public readonly db: DB) {
		const row = db.prepare("SELECT value FROM meta WHERE key = 'seq'").get() as
			{ value: string } | undefined;
		this.seqValue = row ? Number(row.value) : 0;
	}

	get seq(): number {
		return this.seqValue;
	}

	/** Identifies the current dataset; changes when everything is replaced (restore/import). */
	get epoch(): string {
		const row = this.db.prepare("SELECT value FROM meta WHERE key = 'epoch'").get() as
			{ value: string } | undefined;
		return row?.value ?? '';
	}

	/**
	 * Called inside a transaction that replaced the whole dataset: starts a new epoch and makes
	 * every recorded op non-undoable (their before-images belong to the old data).
	 */
	markDatasetReplaced(now = Date.now()) {
		const epoch = randomBytes(8).toString('hex');
		this.db
			.prepare(
				"INSERT INTO meta (key, value) VALUES ('epoch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
			)
			.run(epoch);
		this.db.prepare('UPDATE ops SET undone_at = ? WHERE undone_at IS NULL').run(now);
		this.db.prepare('DELETE FROM id_aliases').run();
	}

	onChange(listener: (seq: number) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// ---------------------------------------------------------------- reads

	snapshot(now = Date.now()): Snapshot {
		const read = this.db.transaction(() => {
			const lists = (
				this.db.prepare('SELECT * FROM lists ORDER BY position, created_at').all() as ListRow[]
			).map(toList);
			const categories = (
				this.db
					.prepare('SELECT * FROM categories ORDER BY position, created_at')
					.all() as CategoryRow[]
			).map(toList) as Category[];

			const counts = new Map<string, { count: number; first: number }>();
			for (const r of this.db
				.prepare(
					`SELECT product_id, COUNT(*) AS n, MIN(completed_at) AS first
					 FROM cycles WHERE completed_at IS NOT NULL GROUP BY product_id`
				)
				.all() as { product_id: string; n: number; first: number }[]) {
				counts.set(r.product_id, { count: r.n, first: r.first });
			}
			const completions = new Map<string, number[]>();
			for (const r of this.db
				.prepare(
					`SELECT product_id, completed_at FROM (
						SELECT product_id, completed_at,
							ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY completed_at DESC) AS rn
						FROM cycles WHERE completed_at IS NOT NULL
					) WHERE rn <= ? ORDER BY product_id, completed_at`
				)
				.all(SNAPSHOT_COMPLETIONS) as { product_id: string; completed_at: number }[]) {
				const arr = completions.get(r.product_id);
				if (arr) arr.push(r.completed_at);
				else completions.set(r.product_id, [r.completed_at]);
			}

			const products = (this.db.prepare('SELECT * FROM products').all() as ProductRow[])
				.map((p): Product => ({
					id: p.id,
					name: p.name,
					categoryId: p.category_id,
					favorite: p.favorite === 1,
					createdAt: p.created_at,
					updatedAt: p.updated_at,
					version: p.version,
					purchaseCount: counts.get(p.id)?.count ?? 0,
					firstCompletedAt: counts.get(p.id)?.first ?? null,
					completions: completions.get(p.id) ?? []
				}))
				.sort((a, b) => compareNl(a.name, b.name));

			const items = (this.db.prepare('SELECT * FROM items').all() as ItemRow[]).map(toItem);
			const aiRecommendations = (
				this.db
					.prepare(
						"SELECT * FROM ai_recommendations WHERE status = 'open' ORDER BY confidence DESC, imported_at"
					)
					.all() as AiRecommendationRow[]
			).map(toRecommendation);
			return {
				seq: this.seqValue,
				epoch: this.epoch,
				serverTime: now,
				lists,
				categories,
				products,
				items,
				aiRecommendations
			};
		});
		return read();
	}

	history(options: { query?: string; before?: number; limit?: number; productId?: string } = {}) {
		const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
		const where = ['c.completed_at IS NOT NULL'];
		const params: unknown[] = [];
		if (options.productId) {
			where.push('c.product_id = ?');
			params.push(this.resolve(options.productId));
		}
		if (options.before) {
			where.push('c.completed_at < ?');
			params.push(options.before);
		}
		if (options.query) {
			where.push("p.name_key LIKE ? ESCAPE '\\'");
			params.push('%' + nameKey(options.query).replace(/[\\%_]/g, (m) => '\\' + m) + '%');
		}
		params.push(limit);
		return this.db
			.prepare(
				`SELECT c.id AS cycleId, c.product_id AS productId, p.name AS productName,
					c.list_id AS listId, l.name AS listName, c.activated_at AS activatedAt,
					c.completed_at AS completedAt, c.cancelled_at AS cancelledAt,
					c.quantity AS quantity, c.unit AS unit
				 FROM cycles c
				 JOIN products p ON p.id = c.product_id
				 LEFT JOIN lists l ON l.id = c.list_id
				 WHERE ${where.join(' AND ')}
				 ORDER BY c.completed_at DESC LIMIT ?`
			)
			.all(...params) as HistoryEntry[];
	}

	/** All cycles of one product, newest first (activations, purchases and cancellations). */
	productCycles(productId: string): HistoryEntry[] {
		return this.db
			.prepare(
				`SELECT c.id AS cycleId, c.product_id AS productId, p.name AS productName,
					c.list_id AS listId, l.name AS listName, c.activated_at AS activatedAt,
					c.completed_at AS completedAt, c.cancelled_at AS cancelledAt,
					c.quantity AS quantity, c.unit AS unit
				 FROM cycles c
				 JOIN products p ON p.id = c.product_id
				 LEFT JOIN lists l ON l.id = c.list_id
				 WHERE c.product_id = ?
				 ORDER BY c.activated_at DESC LIMIT 500`
			)
			.all(this.resolve(productId)) as HistoryEntry[];
	}

	// ---------------------------------------------------------------- writes

	applyOps(clientId: string, rawOps: unknown[], now = Date.now()): OpsResponse {
		const results: OpResult[] = [];
		let changed = false;
		for (const raw of rawOps) {
			const result = this.applyOne(clientId, raw, now);
			if (result.status === 'applied') changed = true;
			results.push(result);
		}
		if (changed) for (const l of this.listeners) l(this.seqValue);
		return { results, seq: this.seqValue };
	}

	private applyOne(clientId: string, raw: unknown, now: number): OpResult {
		let op: Op;
		try {
			op = parseOp(raw);
		} catch (e) {
			const rawId =
				typeof raw === 'object' && raw && 'id' in raw ? String((raw as { id: unknown }).id) : '';
			return {
				opId: rawId,
				status: 'rejected',
				reason: 'invalid',
				message: 'Ongeldige wijziging: ' + (e instanceof ValidationError ? e.message : 'onbekend')
			};
		}

		const existing = this.db.prepare('SELECT result FROM ops WHERE id = ?').get(op.id) as
			{ result: string } | undefined;
		if (existing) return JSON.parse(existing.result) as OpResult;

		const ts = Math.min(op.at, now + MAX_CLOCK_SKEW_MS);
		const run = this.db.transaction((): OpResult => {
			this.captured = new Map();
			let outcome: Outcome;
			try {
				// Nested transaction = SAVEPOINT: a rejection rolls back any partial changes.
				outcome = this.db.transaction(() => this.handle(op, ts, now))();
			} catch (e) {
				if (!(e instanceof Rejection)) throw e;
				outcome = { status: 'rejected', reason: e.reason, message: e.message };
			}
			if (outcome.status !== 'applied') this.captured.clear();

			let inverse: Inverse | null = null;
			if (outcome.status === 'applied' && UNDOABLE_TYPES.has(op.type) && this.captured.size) {
				inverse = this.buildInverse();
			}
			const result: OpResult = { opId: op.id, ...outcome, undoable: inverse !== null };
			if (outcome.status === 'applied') this.bumpSeq();
			this.db
				.prepare(
					'INSERT INTO ops (id, type, client_id, received_at, status, result, inverse) VALUES (?, ?, ?, ?, ?, ?, ?)'
				)
				.run(
					op.id,
					op.type,
					clientId,
					now,
					result.status,
					JSON.stringify(result),
					inverse ? JSON.stringify(inverse) : null
				);
			return result;
		});

		try {
			return run();
		} catch (e) {
			// Unexpected failure: keep the client's op queued by surfacing a server error,
			// unless it is a constraint problem that would fail forever.
			const code = (e as { code?: string }).code ?? '';
			if (code.startsWith('SQLITE_CONSTRAINT')) {
				return {
					opId: op.id,
					status: 'rejected',
					reason: 'constraint',
					message: 'Wijziging kon niet worden opgeslagen (conflict met bestaande gegevens).'
				};
			}
			throw e;
		} finally {
			this.captured = null;
		}
	}

	private bumpSeq() {
		this.seqValue += 1;
		this.db.prepare("UPDATE meta SET value = ? WHERE key = 'seq'").run(String(this.seqValue));
	}

	/** Marks data as changed outside of ops (maintenance/test reset) and notifies clients. */
	touch() {
		this.bumpSeq();
		this.notify();
	}

	/**
	 * Runs a bulk change (import/restore) in one transaction and bumps the sequence once.
	 * Throwing inside `fn` rolls everything back, including the sequence number.
	 */
	bulkChange<T>(fn: () => T): T {
		try {
			const result = this.db.transaction(() => {
				const r = fn();
				this.bumpSeq();
				return r;
			})();
			this.notify();
			return result;
		} catch (e) {
			this.reloadSeq();
			throw e;
		}
	}

	private reloadSeq() {
		const row = this.db.prepare("SELECT value FROM meta WHERE key = 'seq'").get() as
			{ value: string } | undefined;
		this.seqValue = row ? Number(row.value) : 0;
	}

	private notify() {
		for (const l of this.listeners) l(this.seqValue);
	}

	/** Removes old idempotency records. Called periodically. */
	pruneOps(now = Date.now()): number {
		return this.db.prepare('DELETE FROM ops WHERE received_at < ?').run(now - OP_RETENTION_MS)
			.changes;
	}

	// ---------------------------------------------------------------- helpers

	private resolve(id: string): string {
		const row = this.db.prepare('SELECT target FROM id_aliases WHERE alias = ?').get(id) as
			{ target: string } | undefined;
		return row ? row.target : id;
	}

	private alias(alias: string, target: string, kind: string, now: number) {
		if (alias === target) return;
		this.db
			.prepare(
				'INSERT OR REPLACE INTO id_aliases (alias, target, kind, created_at) VALUES (?, ?, ?, ?)'
			)
			.run(alias, target, kind, now);
	}

	private row<T>(table: Table, id: string): T | undefined {
		if (!PK_TABLES.has(table)) throw new Error('bad table');
		return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as T | undefined;
	}

	/** Records the before-image of a row (first capture per op wins). */
	private capture(table: Table, id: string) {
		if (!this.captured) return;
		const key = table + ':' + id;
		if (this.captured.has(key)) return;
		const before = (this.row<Row>(table, id) ?? null) as Row | null;
		this.captured.set(key, { table, id, before });
	}

	private buildInverse(): Inverse {
		const rows = [...this.captured!.values()];
		const guards: Inverse['guards'] = [];
		for (const r of rows) {
			if (!VERSIONED.has(r.table)) continue;
			const current = this.row<{ version: number }>(r.table, r.id);
			guards.push({
				table: r.table as VersionedTable,
				id: r.id,
				version: current ? current.version : null
			});
		}
		return { rows, guards };
	}

	private item(id: string): ItemRow {
		const row = this.row<ItemRow>('items', this.resolve(id));
		if (!row)
			throw new Rejection(
				'not_found',
				'Dit item bestaat niet meer (verwijderd op een ander apparaat).'
			);
		return row;
	}

	private itemName(item: ItemRow): string {
		return this.row<ProductRow>('products', item.product_id)?.name ?? 'Item';
	}

	private list(id: string): ListRow {
		const row = this.row<ListRow>('lists', this.resolve(id));
		if (!row) throw new Rejection('list_not_found', 'Deze lijst bestaat niet meer.');
		return row;
	}

	private newCycle(
		id: string,
		productId: string,
		listId: string,
		at: number,
		quantity: number | null,
		unit: string | null
	): string {
		this.capture('cycles', id);
		this.db
			.prepare(
				'INSERT INTO cycles (id, product_id, list_id, activated_at, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)'
			)
			.run(id, productId, listId, at, quantity, unit);
		return id;
	}

	private cancelOpenCycle(item: ItemRow, at: number) {
		if (item.status !== 'active' || !item.cycle_id) return;
		this.capture('cycles', item.cycle_id);
		this.db
			.prepare('UPDATE cycles SET cancelled_at = ? WHERE id = ? AND completed_at IS NULL')
			.run(at, item.cycle_id);
	}

	private deleteItem(item: ItemRow, at: number) {
		this.capture('items', item.id);
		this.cancelOpenCycle(item, at);
		this.db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
	}

	private nextPosition(table: 'lists' | 'categories'): number {
		const r = this.db
			.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${table}`)
			.get() as {
			p: number;
		};
		return r.p;
	}

	private reorder(table: 'lists' | 'categories', ids: string[], now: number): boolean {
		const all = (
			this.db.prepare(`SELECT id, position FROM ${table} ORDER BY position, created_at`).all() as {
				id: string;
				position: number;
			}[]
		).map((r) => r.id);
		const wanted = ids
			.map((i) => this.resolve(i))
			.filter((i, idx, arr) => all.includes(i) && arr.indexOf(i) === idx);
		const rest = all.filter((i) => !wanted.includes(i));
		const order = [...wanted, ...rest];
		let changed = false;
		const stmt = this.db.prepare(
			`UPDATE ${table} SET position = ?, updated_at = ? WHERE id = ? AND position != ?`
		);
		order.forEach((id, position) => {
			if (stmt.run(position, now, id, position).changes) changed = true;
		});
		return changed;
	}

	private uniqueName(table: 'lists' | 'categories', name: string, exceptId?: string) {
		const key = nameKey(name);
		const rows = this.db.prepare(`SELECT id, name FROM ${table}`).all() as {
			id: string;
			name: string;
		}[];
		if (rows.some((r) => r.id !== exceptId && nameKey(r.name) === key)) {
			throw new Rejection(
				'duplicate',
				table === 'lists'
					? `Er bestaat al een lijst “${name}”.`
					: `Er bestaat al een categorie “${name}”.`
			);
		}
	}

	// ---------------------------------------------------------------- handlers

	private handle(op: Op, ts: number, now: number): Outcome {
		switch (op.type) {
			case 'list.create': {
				if (this.row('lists', op.listId)) return { status: 'noop', reason: 'exists' };
				const name = capitaliseFirst(cleanName(op.name));
				this.uniqueName('lists', name);
				this.db
					.prepare(
						'INSERT INTO lists (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
					)
					.run(op.listId, name, this.nextPosition('lists'), now, now);
				return { status: 'applied' };
			}
			case 'list.rename': {
				const list = this.list(op.listId);
				const name = cleanName(op.name);
				if (list.name === name) return { status: 'noop', reason: 'unchanged' };
				this.uniqueName('lists', name, list.id);
				this.db
					.prepare('UPDATE lists SET name = ?, updated_at = ? WHERE id = ?')
					.run(name, now, list.id);
				return { status: 'applied' };
			}
			case 'list.delete': {
				const list = this.row<ListRow>('lists', this.resolve(op.listId));
				if (!list) return { status: 'noop', reason: 'not_found' };
				const count = (this.db.prepare('SELECT COUNT(*) AS n FROM lists').get() as { n: number }).n;
				if (count <= 1)
					throw new Rejection('last_list', 'De laatste lijst kan niet worden verwijderd.');
				for (const item of this.db
					.prepare("SELECT * FROM items WHERE list_id = ? AND status = 'active'")
					.all(list.id) as ItemRow[]) {
					this.cancelOpenCycle(item, ts);
				}
				this.db.prepare('DELETE FROM lists WHERE id = ?').run(list.id);
				return { status: 'applied' };
			}
			case 'list.reorder':
				return this.reorder('lists', op.listIds, now)
					? { status: 'applied' }
					: { status: 'noop', reason: 'unchanged' };
			case 'list.clearCompleted': {
				const list = this.list(op.listId);
				const items = this.db
					.prepare("SELECT * FROM items WHERE list_id = ? AND status = 'completed'")
					.all(list.id) as ItemRow[];
				if (!items.length) return { status: 'noop', reason: 'empty' };
				for (const item of items) this.deleteItem(item, ts);
				return { status: 'applied' };
			}
			case 'category.create': {
				if (this.row('categories', op.categoryId)) return { status: 'noop', reason: 'exists' };
				const name = capitaliseFirst(cleanName(op.name));
				this.uniqueName('categories', name);
				this.db
					.prepare(
						'INSERT INTO categories (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
					)
					.run(op.categoryId, name, this.nextPosition('categories'), now, now);
				return { status: 'applied' };
			}
			case 'category.rename': {
				const cat = this.row<CategoryRow>('categories', op.categoryId);
				if (!cat) throw new Rejection('not_found', 'Deze categorie bestaat niet meer.');
				const name = cleanName(op.name);
				if (cat.name === name) return { status: 'noop', reason: 'unchanged' };
				this.uniqueName('categories', name, cat.id);
				this.db
					.prepare('UPDATE categories SET name = ?, updated_at = ? WHERE id = ?')
					.run(name, now, cat.id);
				return { status: 'applied' };
			}
			case 'category.delete': {
				if (!this.row('categories', op.categoryId)) return { status: 'noop', reason: 'not_found' };
				this.db
					.prepare(
						'UPDATE products SET category_id = NULL, version = version + 1, updated_at = ? WHERE category_id = ?'
					)
					.run(now, op.categoryId);
				this.db.prepare('DELETE FROM categories WHERE id = ?').run(op.categoryId);
				return { status: 'applied' };
			}
			case 'category.reorder':
				return this.reorder('categories', op.categoryIds, now)
					? { status: 'applied' }
					: { status: 'noop', reason: 'unchanged' };

			case 'item.add':
				return this.addItem(op, ts, now);

			case 'item.complete': {
				const item = this.item(op.itemId);
				if (item.status === 'completed')
					return { status: 'noop', reason: 'already_completed', itemId: item.id };
				const at = Math.max(ts, item.activated_at);
				this.capture('items', item.id);
				let cycleId = item.cycle_id;
				if (!cycleId || !this.row('cycles', cycleId)) {
					cycleId = this.newCycle(
						`c-${op.id}`,
						item.product_id,
						item.list_id,
						item.activated_at,
						item.quantity,
						item.unit
					);
				} else {
					this.capture('cycles', cycleId);
				}
				this.db
					.prepare(
						'UPDATE cycles SET completed_at = ?, cancelled_at = NULL, quantity = ?, unit = ? WHERE id = ?'
					)
					.run(at, item.quantity, item.unit, cycleId);
				this.db
					.prepare(
						"UPDATE items SET status = 'completed', completed_at = ?, cycle_id = ?, updated_at = ?, version = version + 1 WHERE id = ?"
					)
					.run(at, cycleId, now, item.id);
				return { status: 'applied', itemId: item.id };
			}
			case 'item.reactivate': {
				const item = this.item(op.itemId);
				if (item.status === 'active')
					return { status: 'noop', reason: 'already_active', itemId: item.id };
				this.capture('items', item.id);
				const at = Math.max(ts, item.completed_at ?? 0);
				const cycleId = this.newCycle(
					`c-${op.id}`,
					item.product_id,
					item.list_id,
					at,
					item.quantity,
					item.unit
				);
				this.db
					.prepare(
						"UPDATE items SET status = 'active', activated_at = ?, completed_at = NULL, cycle_id = ?, updated_at = ?, version = version + 1 WHERE id = ?"
					)
					.run(at, cycleId, now, item.id);
				return { status: 'applied', itemId: item.id };
			}
			case 'item.update': {
				const item = this.item(op.itemId);
				const conflicts: FieldConflict[] = [];
				const next = { quantity: item.quantity, unit: item.unit };
				for (const field of ['quantity', 'unit'] as const) {
					if (!(field in op.changes)) continue;
					const written = op.changes[field] ?? null;
					if (
						field in op.base &&
						(op.base[field] ?? null) !== item[field] &&
						item[field] !== written
					) {
						conflicts.push({
							field,
							previous: item[field],
							expected: op.base[field] ?? null,
							written
						});
					}
					(next as Record<string, unknown>)[field] = written;
				}
				if (next.quantity === item.quantity && next.unit === item.unit)
					return { status: 'noop', reason: 'unchanged', itemId: item.id };
				this.capture('items', item.id);
				this.db
					.prepare(
						'UPDATE items SET quantity = ?, unit = ?, updated_at = ?, version = version + 1 WHERE id = ?'
					)
					.run(next.quantity, next.unit, now, item.id);
				if (item.status === 'active' && item.cycle_id) {
					this.capture('cycles', item.cycle_id);
					this.db
						.prepare('UPDATE cycles SET quantity = ?, unit = ? WHERE id = ?')
						.run(next.quantity, next.unit, item.cycle_id);
				}
				return {
					status: 'applied',
					itemId: item.id,
					...(conflicts.length
						? {
								conflicts,
								message: `“${this.itemName(item)}” was intussen op een ander apparaat gewijzigd. Jouw wijziging is opgeslagen.`
							}
						: {})
				};
			}
			case 'item.move': {
				const item = this.item(op.itemId);
				const target = this.list(op.toListId);
				if (item.list_id === target.id)
					return { status: 'noop', reason: 'same_list', itemId: item.id };
				const other = this.db
					.prepare('SELECT * FROM items WHERE list_id = ? AND product_id = ?')
					.get(target.id, item.product_id) as ItemRow | undefined;
				if (other) {
					// The product is already on the target list: keep a single row (prefer the active one).
					if (other.status === 'active' || item.status === 'completed') {
						this.deleteItem(item, ts);
						this.alias(item.id, other.id, 'item', now);
						return { status: 'applied', reason: 'merged', itemId: other.id };
					}
					this.deleteItem(other, ts);
				}
				this.capture('items', item.id);
				this.db
					.prepare(
						'UPDATE items SET list_id = ?, updated_at = ?, version = version + 1 WHERE id = ?'
					)
					.run(target.id, now, item.id);
				if (item.status === 'active' && item.cycle_id) {
					this.capture('cycles', item.cycle_id);
					this.db
						.prepare('UPDATE cycles SET list_id = ? WHERE id = ?')
						.run(target.id, item.cycle_id);
				}
				return { status: 'applied', itemId: item.id };
			}
			case 'item.delete': {
				const row = this.row<ItemRow>('items', this.resolve(op.itemId));
				if (!row) return { status: 'noop', reason: 'not_found' };
				this.deleteItem(row, ts);
				return { status: 'applied', itemId: row.id };
			}
			case 'product.update':
				return this.updateProduct(op, now);
			case 'product.delete': {
				const product = this.row<ProductRow>('products', this.resolve(op.productId));
				if (!product) return { status: 'noop', reason: 'not_found' };
				this.capture('products', product.id);
				for (const r of this.db
					.prepare('SELECT id FROM items WHERE product_id = ?')
					.all(product.id) as {
					id: string;
				}[])
					this.capture('items', r.id);
				for (const r of this.db
					.prepare('SELECT id FROM cycles WHERE product_id = ?')
					.all(product.id) as {
					id: string;
				}[])
					this.capture('cycles', r.id);
				this.db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
				return { status: 'applied', productId: product.id };
			}
			case 'ai.accept':
				return this.acceptRecommendation(op, ts, now);
			case 'ai.dismiss': {
				const rec = this.recommendation(op.recommendationId);
				if (rec.status !== 'open') return { status: 'noop', reason: 'already_resolved' };
				this.capture('ai_recommendations', rec.id);
				this.db
					.prepare(
						"UPDATE ai_recommendations SET status = 'dismissed', resolved_at = ?, version = version + 1 WHERE id = ?"
					)
					.run(now, rec.id);
				return { status: 'applied', productId: rec.product_id };
			}
			case 'undo':
				return this.undo(op.targetOpId, now);
		}
	}

	private addItem(op: Extract<Op, { type: 'item.add' }>, ts: number, now: number): Outcome {
		const list = this.list(op.listId);
		const name = capitaliseFirst(cleanName(op.name));
		const key = nameKey(name);

		let product = this.db.prepare('SELECT * FROM products WHERE name_key = ?').get(key) as
			ProductRow | undefined;
		if (!product) {
			const productId = this.row('products', op.productId) ? `p-${op.id}` : op.productId;
			const categoryId =
				op.categoryId && this.row('categories', op.categoryId) ? op.categoryId : null;
			this.capture('products', productId);
			this.db
				.prepare(
					'INSERT INTO products (id, name, name_key, category_id, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
				)
				.run(productId, name, key, categoryId, ts, now);
			product = this.row<ProductRow>('products', productId)!;
		}
		this.alias(op.productId, product.id, 'product', now);

		const existing = this.db
			.prepare('SELECT * FROM items WHERE list_id = ? AND product_id = ?')
			.get(list.id, product.id) as ItemRow | undefined;

		if (existing && existing.status === 'active') {
			this.alias(op.itemId, existing.id, 'item', now);
			return {
				status: 'noop',
				reason: 'duplicate',
				message: `“${product.name}” staat al op de lijst.`,
				itemId: existing.id,
				productId: product.id
			};
		}

		if (existing) {
			this.capture('items', existing.id);
			const quantity = op.quantity ?? existing.quantity;
			const unit = op.quantity !== null || op.unit !== null ? op.unit : existing.unit;
			const at = Math.max(ts, existing.completed_at ?? 0);
			const cycleId = this.newCycle(`c-${op.id}`, product.id, list.id, at, quantity, unit);
			this.db
				.prepare(
					"UPDATE items SET status = 'active', activated_at = ?, completed_at = NULL, cycle_id = ?, quantity = ?, unit = ?, updated_at = ?, version = version + 1 WHERE id = ?"
				)
				.run(at, cycleId, quantity, unit, now, existing.id);
			this.alias(op.itemId, existing.id, 'item', now);
			return {
				status: 'applied',
				reason: 'reactivated',
				itemId: existing.id,
				productId: product.id
			};
		}

		const itemId = this.row('items', op.itemId) ? `i-${op.id}` : op.itemId;
		this.alias(op.itemId, itemId, 'item', now);
		const cycleId = this.newCycle(`c-${op.id}`, product.id, list.id, ts, op.quantity, op.unit);
		this.capture('items', itemId);
		this.db
			.prepare(
				`INSERT INTO items (id, list_id, product_id, quantity, unit, status, activated_at, cycle_id, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
			)
			.run(itemId, list.id, product.id, op.quantity, op.unit, ts, cycleId, ts, now);
		return { status: 'applied', reason: 'created', itemId, productId: product.id };
	}

	private recommendation(id: string): AiRecommendationRow {
		const rec = this.row<AiRecommendationRow>('ai_recommendations', id);
		if (!rec) throw new Rejection('not_found', 'Deze AI-suggestie bestaat niet meer.');
		return rec;
	}

	/**
	 * Accepting a recommendation is an explicit user action: it puts the product on the chosen
	 * list (with the suggested quantity) exactly like a manual add. Purchase history is untouched.
	 */
	private acceptRecommendation(
		op: Extract<Op, { type: 'ai.accept' }>,
		ts: number,
		now: number
	): Outcome {
		const rec = this.recommendation(op.recommendationId);
		if (rec.status !== 'open') return { status: 'noop', reason: 'already_resolved' };
		const product = this.row<ProductRow>('products', rec.product_id)!;
		const added = this.addItem(
			{
				id: op.id,
				at: op.at,
				type: 'item.add',
				itemId: op.itemId,
				productId: product.id,
				listId: op.listId,
				name: product.name,
				quantity: rec.suggested_quantity,
				unit: rec.suggested_quantity === null ? null : rec.suggested_unit,
				categoryId: null
			},
			ts,
			now
		);
		this.capture('ai_recommendations', rec.id);
		this.db
			.prepare(
				"UPDATE ai_recommendations SET status = 'accepted', resolved_at = ?, version = version + 1 WHERE id = ?"
			)
			.run(now, rec.id);
		return {
			status: 'applied',
			reason: added.reason === 'duplicate' ? 'already_on_list' : added.reason,
			message: added.reason === 'duplicate' ? added.message : undefined,
			itemId: added.itemId,
			productId: product.id
		};
	}

	private updateProduct(op: Extract<Op, { type: 'product.update' }>, now: number): Outcome {
		const product = this.row<ProductRow>('products', this.resolve(op.productId));
		if (!product) throw new Rejection('not_found', 'Dit product bestaat niet meer.');
		const current = {
			name: product.name,
			categoryId: product.category_id,
			favorite: product.favorite === 1
		};
		const next = { ...current };
		const conflicts: FieldConflict[] = [];

		if (op.changes.name !== undefined) {
			const name = cleanName(op.changes.name);
			const key = nameKey(name);
			const clash = this.db
				.prepare('SELECT id, name FROM products WHERE name_key = ? AND id != ?')
				.get(key, product.id) as { id: string; name: string } | undefined;
			if (clash) throw new Rejection('duplicate', `Er bestaat al een product “${clash.name}”.`);
			next.name = name;
		}
		if (op.changes.categoryId !== undefined) {
			const cid = op.changes.categoryId;
			if (cid !== null && !this.row('categories', cid))
				throw new Rejection('category_not_found', 'Deze categorie bestaat niet meer.');
			next.categoryId = cid;
		}
		if (op.changes.favorite !== undefined) next.favorite = op.changes.favorite;

		for (const field of ['name', 'categoryId', 'favorite'] as const) {
			if (!(field in op.changes) || !(field in op.base)) continue;
			if (op.base[field] !== current[field] && current[field] !== next[field]) {
				conflicts.push({
					field,
					previous: current[field],
					expected: op.base[field],
					written: next[field]
				});
			}
		}

		if (
			next.name === current.name &&
			next.categoryId === current.categoryId &&
			next.favorite === current.favorite
		)
			return { status: 'noop', reason: 'unchanged', productId: product.id };

		this.capture('products', product.id);
		this.db
			.prepare(
				'UPDATE products SET name = ?, name_key = ?, category_id = ?, favorite = ?, updated_at = ?, version = version + 1 WHERE id = ?'
			)
			.run(next.name, nameKey(next.name), next.categoryId, next.favorite ? 1 : 0, now, product.id);
		return {
			status: 'applied',
			productId: product.id,
			...(conflicts.length
				? {
						conflicts,
						message: `“${next.name}” was intussen op een ander apparaat gewijzigd. Jouw wijziging is opgeslagen.`
					}
				: {})
		};
	}

	private undo(targetOpId: string, now: number): Outcome {
		const target = this.db
			.prepare('SELECT type, inverse, undone_at FROM ops WHERE id = ?')
			.get(targetOpId) as
			{ type: string; inverse: string | null; undone_at: number | null } | undefined;
		if (!target) {
			throw new Rejection('unknown_op', 'Ongedaan maken is niet meer mogelijk.');
		}
		if (target.undone_at) return { status: 'noop', reason: 'already_undone' };
		if (!target.inverse) return { status: 'noop', reason: 'nothing_to_undo' };
		const inverse = JSON.parse(target.inverse) as Inverse;

		for (const g of inverse.guards) {
			const current = this.row<{ version: number }>(g.table, g.id);
			const version = current ? current.version : null;
			if (version !== g.version) {
				throw new Rejection(
					'conflict',
					'Ongedaan maken kan niet: dit is intussen op een ander apparaat gewijzigd.'
				);
			}
		}

		this.db.pragma('defer_foreign_keys = ON');
		const byOrder = (a: { table: Table }, b: { table: Table }) =>
			TABLE_ORDER.indexOf(a.table) - TABLE_ORDER.indexOf(b.table);
		const deletions = inverse.rows
			.filter((r) => r.before === null)
			.sort(byOrder)
			.reverse();
		const restores = inverse.rows.filter((r) => r.before !== null).sort(byOrder);

		const capturedIds = new Set(inverse.rows.map((r) => r.id));
		for (const r of deletions) {
			if (r.table === 'products') {
				// Only remove a product created by the undone op if nothing else uses it by now.
				const refs = this.db
					.prepare(
						'SELECT id FROM items WHERE product_id = ? UNION ALL SELECT id FROM cycles WHERE product_id = ?'
					)
					.all(r.id, r.id) as { id: string }[];
				if (refs.some((x) => !capturedIds.has(x.id))) continue;
			}
			this.db.prepare(`DELETE FROM ${r.table} WHERE id = ?`).run(r.id);
		}
		for (const r of restores) {
			const before = { ...(r.before as Row) };
			if (VERSIONED.has(r.table)) {
				const current = this.row<{ version: number }>(r.table, r.id);
				before.version = Math.max(Number(before.version ?? 1), current?.version ?? 0) + 1;
				if ('updated_at' in before) before.updated_at = now;
			}
			const cols = Object.keys(before);
			const sql = `INSERT INTO ${r.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
				ON CONFLICT(id) DO UPDATE SET ${cols
					.filter((c) => c !== 'id')
					.map((c) => `${c} = excluded.${c}`)
					.join(', ')}`;
			try {
				this.db.prepare(sql).run(...cols.map((c) => before[c] as never));
			} catch (e) {
				if (String((e as { code?: string }).code).startsWith('SQLITE_CONSTRAINT'))
					throw new Rejection(
						'conflict',
						'Ongedaan maken kan niet: er bestaat inmiddels iets vergelijkbaars.'
					);
				throw e;
			}
		}
		// Rows whose parent list vanished in the meantime cannot be restored.
		const fk = this.db.pragma('foreign_key_check') as unknown[];
		if (fk.length)
			throw new Rejection('conflict', 'Ongedaan maken kan niet: de lijst bestaat niet meer.');

		this.db.prepare('UPDATE ops SET undone_at = ? WHERE id = ?').run(now, targetOpId);
		return { status: 'applied', reason: 'undone' };
	}
}

function toList(r: ListRow): List {
	return {
		id: r.id,
		name: r.name,
		position: r.position,
		createdAt: r.created_at,
		updatedAt: r.updated_at
	};
}

function toRecommendation(r: AiRecommendationRow): AiRecommendation {
	return {
		id: r.id,
		productId: r.product_id,
		suggestedQuantity: r.suggested_quantity,
		suggestedUnit: r.suggested_unit,
		nextPurchaseAt: r.next_purchase_at,
		confidence: r.confidence,
		reasoning: r.reasoning,
		source: r.source,
		importedAt: r.imported_at,
		version: r.version
	};
}

function toItem(r: ItemRow): Item {
	return {
		id: r.id,
		listId: r.list_id,
		productId: r.product_id,
		quantity: r.quantity,
		unit: r.unit,
		status: r.status,
		activatedAt: r.activated_at,
		completedAt: r.completed_at,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		version: r.version
	};
}
