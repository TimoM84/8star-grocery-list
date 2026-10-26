/**
 * Server-side domain logic. SQLite is the single source of truth; every mutation arrives as an
 * idempotent operation (see src/lib/shared/ops.ts and docs/SYNC.md).
 */

import type { DB } from './db';
import { randomBytes } from 'node:crypto';
import type {
	AiRecommendation,
	Bundle,
	Category,
	Claim,
	Item,
	List,
	ListKind,
	Product,
	ProductAlias,
	Round,
	Snapshot,
	StockStatus
} from '$lib/shared/types';
import {
	parseOp,
	PROTOCOL_VERSION,
	UNDOABLE_TYPES,
	ValidationError,
	type AddManyEntry,
	type AddManySummary,
	type FieldConflict,
	type Op,
	type OpResult,
	type OpsResponse
} from '$lib/shared/ops';
import { capitaliseFirst, cleanName, compareNl, nameKey } from '$lib/shared/text';
import { convertQuantity, formatQuantity, roundQuantity } from '$lib/shared/quantity';
import { readSettings, writeSettings } from './settings';
import { householdMessages } from './i18n';
import { decimalSeparator, type Messages } from '$lib/shared/i18n';

/** Max completion timestamps per product included in snapshots (enough for local stats). */
export const SNAPSHOT_COMPLETIONS = 200;
/** Ops older than this are pruned from the idempotency log (undo is short-lived anyway). */
export const OP_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** Clients may not stamp operations further in the future than this. */
const MAX_CLOCK_SKEW_MS = 60 * 1000;

type Table =
	| 'lists'
	| 'categories'
	| 'products'
	| 'product_aliases'
	| 'bundles'
	| 'bundle_lines'
	| 'ai_recommendations'
	| 'snoozes'
	| 'cycles'
	| 'items';
type Row = Record<string, unknown>;

/** Shopping rounds without any sign of life for this long are ended automatically. */
export const ROUND_IDLE_MS = 2 * 60 * 60 * 1000;
/** "Ik pak dit" claims expire after this long (or when the round ends / the device leaves). */
export const CLAIM_TTL_MS = 20 * 60 * 1000;
/** Presence heartbeats only notify other devices when the last one is older than this. */
const PRESENCE_NOTIFY_MS = 4 * 60 * 1000;
/** An item note belongs to one need: it is cleared when the item is needed again after this. */
export const NOTE_KEEP_MS = 6 * 60 * 60 * 1000;

interface ListRow {
	id: string;
	name: string;
	position: number;
	created_at: number;
	updated_at: number;
	kind: ListKind;
	kind_changed_at: number | null;
	category_order: string | null;
}
interface CategoryRow {
	id: string;
	name: string;
	position: number;
	created_at: number;
	updated_at: number;
}
interface ProductRow {
	id: string;
	name: string;
	name_key: string;
	category_id: string | null;
	favorite: number;
	created_at: number;
	updated_at: number;
	version: number;
	default_quantity: number | null;
	default_unit: string | null;
	preferred_list_id: string | null;
	note: string | null;
	photo_id: string | null;
	stock_status: StockStatus;
	stock_updated_at: number | null;
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
	note: string | null;
	substitute_ok: number;
	substitute_note: string | null;
	unavailable_at: number | null;
	position: number;
	quantity_rev: number;
}
interface CycleRow {
	id: string;
	product_id: string;
	list_id: string | null;
	activated_at: number;
	completed_at: number | null;
	cancelled_at: number | null;
	quantity: number | null;
	unit: string | null;
	requested_quantity: number | null;
	purchased_quantity: number | null;
	last_purchase_at: number | null;
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
interface RoundRow {
	id: string;
	list_id: string;
	started_at: number;
	started_by: string | null;
	ended_at: number | null;
}

/**
 * Inverse of an applied op. Row images restore the state before the op, guarded by the
 * version stamps written by the op. Intent ops (+extra, partial purchase) store a semantic
 * inverse instead, so undoing them never reverts somebody else's later change.
 */
interface Inverse {
	rows: { table: Table; id: string; before: Row | null }[];
	guards: { table: Table; id: string; version: number | null }[];
	semantic?: SemanticInverse;
}
interface SemanticInverse {
	kind: 'increment' | 'partial';
	itemId: string;
	cycleId: string | null;
	/** Amount in the item's unit. */
	delta: number;
	unit: string | null;
	quantityRev: number;
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

/** Parents before children: restores run in this order, deletions in reverse. */
const TABLE_ORDER: Table[] = [
	'lists',
	'categories',
	'products',
	'product_aliases',
	'bundles',
	'bundle_lines',
	'ai_recommendations',
	'snoozes',
	'cycles',
	'items'
];
/** Column used to detect later changes when undoing (row versions or timestamps). */
const STAMP: Partial<Record<Table, string>> = {
	items: 'version',
	products: 'version',
	ai_recommendations: 'version',
	bundles: 'version',
	lists: 'updated_at',
	snoozes: 'updated_at',
	product_aliases: 'created_at'
};
const VERSIONED = new Set<Table>(['items', 'products', 'ai_recommendations', 'bundles']);
const PK_TABLES = new Set<string>([...TABLE_ORDER, 'rounds', 'media']);

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
	/** Semantic inverse recorded by the op currently being applied. */
	private semantic: SemanticInverse | null = null;

	constructor(public readonly db: DB) {
		const row = db.prepare("SELECT value FROM meta WHERE key = 'seq'").get() as
			{ value: string } | undefined;
		this.seqValue = row ? Number(row.value) : 0;
	}

	get seq(): number {
		return this.seqValue;
	}

	/** Messages for rejections and conflicts, in the household language. */
	private get t(): Messages {
		return householdMessages(this.db);
	}

	/** A quantity for a message, with translated unit names. */
	private qty(quantity: number | null, unit: string | null): string {
		return formatQuantity(quantity, unit, {
			units: this.t.units,
			unitsPlural: this.t.unitsPlural,
			decimal: decimalSeparator(readSettings(this.db).language)
		});
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
			).map(toCategory);

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
					...toProductFields(p),
					purchaseCount: counts.get(p.id)?.count ?? 0,
					firstCompletedAt: counts.get(p.id)?.first ?? null,
					completions: completions.get(p.id) ?? []
				}))
				.sort((a, b) => compareNl(a.name, b.name));

			const items = (
				this.db
					.prepare(
						`SELECT i.*, CASE WHEN i.status = 'active' THEN c.purchased_quantity END AS purchased_quantity
						 FROM items i LEFT JOIN cycles c ON c.id = i.cycle_id`
					)
					.all() as (ItemRow & { purchased_quantity: number | null })[]
			).map(toItem);
			const aiRecommendations = (
				this.db
					.prepare(
						"SELECT * FROM ai_recommendations WHERE status = 'open' ORDER BY confidence DESC, imported_at"
					)
					.all() as AiRecommendationRow[]
			).map(toRecommendation);
			const aliases = (
				this.db.prepare('SELECT * FROM product_aliases ORDER BY alias_key').all() as Row[]
			).map((r): ProductAlias => ({
				id: r.id as string,
				productId: r.product_id as string,
				alias: r.alias as string,
				createdAt: r.created_at as number
			}));
			return {
				seq: this.seqValue,
				epoch: this.epoch,
				serverTime: now,
				protocol: PROTOCOL_VERSION,
				lists,
				categories,
				products,
				items,
				aiRecommendations,
				aliases,
				bundles: this.bundles(),
				snoozes: (
					this.db.prepare('SELECT product_id, until FROM snoozes WHERE until > ?').all(now) as {
						product_id: string;
						until: number;
					}[]
				).map((r) => ({ productId: r.product_id, until: r.until })),
				rounds: this.activeRounds(),
				claims: this.activeClaims(now),
				settings: readSettings(this.db)
			};
		});
		return read();
	}

	private bundles(): Bundle[] {
		const lines = new Map<string, Bundle['lines']>();
		for (const l of this.db
			.prepare('SELECT * FROM bundle_lines ORDER BY bundle_id, position, id')
			.all() as Row[]) {
			const arr = lines.get(l.bundle_id as string) ?? [];
			arr.push({
				id: l.id as string,
				productId: l.product_id as string,
				quantity: (l.quantity as number | null) ?? null,
				unit: (l.unit as string | null) ?? null,
				note: (l.note as string | null) ?? null
			});
			lines.set(l.bundle_id as string, arr);
		}
		return (this.db.prepare('SELECT * FROM bundles').all() as Row[])
			.map((b): Bundle => ({
				id: b.id as string,
				name: b.name as string,
				servings: (b.servings as number | null) ?? null,
				createdAt: b.created_at as number,
				updatedAt: b.updated_at as number,
				version: b.version as number,
				lines: lines.get(b.id as string) ?? []
			}))
			.sort((a, b) => compareNl(a.name, b.name));
	}

	private activeRounds(): Round[] {
		const rounds = this.db
			.prepare('SELECT * FROM rounds WHERE ended_at IS NULL ORDER BY started_at')
			.all() as RoundRow[];
		const participants = this.db.prepare(
			'SELECT * FROM round_participants WHERE round_id = ? AND left_at IS NULL ORDER BY joined_at'
		);
		return rounds.map((r) => ({
			id: r.id,
			listId: r.list_id,
			startedAt: r.started_at,
			startedBy: r.started_by,
			participants: (participants.all(r.id) as Row[]).map((p) => ({
				deviceId: p.device_id as string,
				deviceName: (p.device_name as string | null) ?? null,
				joinedAt: p.joined_at as number,
				lastSeenAt: p.last_seen_at as number
			}))
		}));
	}

	private activeClaims(now: number): Claim[] {
		return (
			this.db
				.prepare(
					`SELECT cl.* FROM claims cl LEFT JOIN rounds r ON r.id = cl.round_id
					 WHERE cl.expires_at > ? AND (cl.round_id IS NULL OR r.ended_at IS NULL)`
				)
				.all(now) as Row[]
		).map((c) => ({
			itemId: c.item_id as string,
			roundId: (c.round_id as string | null) ?? null,
			deviceId: c.device_id as string,
			deviceName: (c.device_name as string | null) ?? null,
			claimedAt: c.claimed_at as number,
			expiresAt: c.expires_at as number
		}));
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
				message: this.t.server.invalidOp(
					e instanceof ValidationError ? e.message : this.t.server.unknown
				)
			};
		}

		const existing = this.db.prepare('SELECT result FROM ops WHERE id = ?').get(op.id) as
			{ result: string } | undefined;
		if (existing) return JSON.parse(existing.result) as OpResult;

		const ts = Math.min(op.at, now + MAX_CLOCK_SKEW_MS);
		const run = this.db.transaction((): OpResult => {
			this.captured = new Map();
			this.semantic = null;
			let outcome: Outcome;
			try {
				// Nested transaction = SAVEPOINT: a rejection rolls back any partial changes.
				outcome = this.db.transaction(() => this.handle(op, ts, now))();
			} catch (e) {
				if (!(e instanceof Rejection)) throw e;
				outcome = { status: 'rejected', reason: e.reason, message: e.message };
			}
			if (outcome.status !== 'applied') {
				this.captured.clear();
				this.semantic = null;
			}

			let inverse: Inverse | null = null;
			if (outcome.status === 'applied' && UNDOABLE_TYPES.has(op.type)) {
				if (this.semantic) inverse = { rows: [], guards: [], semantic: this.semantic };
				else if (this.captured.size) inverse = this.buildInverse();
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
					message: this.t.server.constraint
				};
			}
			throw e;
		} finally {
			this.captured = null;
			this.semantic = null;
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

	/**
	 * Presence heartbeat of a device in winkelstand. Not an op (nothing to undo or replay);
	 * other devices are only notified when the previous heartbeat is getting old.
	 */
	heartbeat(roundId: string, deviceId: string, now = Date.now()): boolean {
		const row = this.db
			.prepare(
				`SELECT p.last_seen_at FROM round_participants p JOIN rounds r ON r.id = p.round_id
				 WHERE p.round_id = ? AND p.device_id = ? AND p.left_at IS NULL AND r.ended_at IS NULL`
			)
			.get(this.resolve(roundId), deviceId) as { last_seen_at: number } | undefined;
		if (!row) return false;
		this.db
			.prepare(
				'UPDATE round_participants SET last_seen_at = ? WHERE round_id = ? AND device_id = ?'
			)
			.run(now, this.resolve(roundId), deviceId);
		if (now - row.last_seen_at > PRESENCE_NOTIFY_MS) this.touch();
		return true;
	}

	/**
	 * Ends rounds nobody showed signs of life in for ROUND_IDLE_MS and drops expired claims, so
	 * "is aan het winkelen" never shows forever. Called periodically.
	 */
	maintenance(now = Date.now()): boolean {
		const changed = this.db.transaction(() => {
			let n = this.db
				.prepare(
					`UPDATE rounds SET ended_at = ?, end_reason = 'idle'
					 WHERE ended_at IS NULL AND COALESCE(
						(SELECT MAX(last_seen_at) FROM round_participants p WHERE p.round_id = rounds.id AND p.left_at IS NULL),
						started_at) < ?`
				)
				.run(now, now - ROUND_IDLE_MS).changes;
			n += this.db
				.prepare(
					`DELETE FROM claims WHERE expires_at <= ?
					 OR round_id IN (SELECT id FROM rounds WHERE ended_at IS NOT NULL)`
				)
				.run(now).changes;
			if (n) this.bumpSeq();
			return n > 0;
		})();
		if (changed) this.notify();
		return changed;
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

	private row<T>(table: string, id: string): T | undefined {
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

	private stamp(table: Table, id: string): number | null {
		const col = STAMP[table];
		if (!col) return null;
		const r = this.db.prepare(`SELECT ${col} AS v FROM ${table} WHERE id = ?`).get(id) as
			{ v: number } | undefined;
		return r ? r.v : null;
	}

	private buildInverse(): Inverse {
		const rows = [...this.captured!.values()];
		const guards: Inverse['guards'] = [];
		for (const r of rows) {
			if (!STAMP[r.table]) continue;
			guards.push({ table: r.table, id: r.id, version: this.stamp(r.table, r.id) });
		}
		return { rows, guards };
	}

	private item(id: string): ItemRow {
		const row = this.row<ItemRow>('items', this.resolve(id));
		if (!row) throw new Rejection('not_found', this.t.server.itemGone);
		return row;
	}

	private activeItem(id: string): ItemRow {
		const item = this.item(id);
		if (item.status !== 'active')
			throw new Rejection('not_active', this.t.server.itemTicked(this.itemName(item)));
		return item;
	}

	private itemName(item: ItemRow): string {
		return this.row<ProductRow>('products', item.product_id)?.name ?? 'Item';
	}

	private list(id: string): ListRow {
		const row = this.row<ListRow>('lists', this.resolve(id));
		if (!row) throw new Rejection('list_not_found', this.t.server.listGone);
		return row;
	}

	private product(id: string): ProductRow {
		const row = this.row<ProductRow>('products', this.resolve(id));
		if (!row) throw new Rejection('not_found', this.t.server.productGone);
		return row;
	}

	private cycle(id: string | null): CycleRow | undefined {
		return id ? this.row<CycleRow>('cycles', id) : undefined;
	}

	private touchItem(item: ItemRow, now: number, extra = '') {
		this.db
			.prepare(`UPDATE items SET updated_at = ?, version = version + 1${extra} WHERE id = ?`)
			.run(now, item.id);
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
				'INSERT INTO cycles (id, product_id, list_id, activated_at, quantity, unit, requested_quantity) VALUES (?, ?, ?, ?, ?, ?, ?)'
			)
			.run(id, productId, listId, at, quantity, unit, quantity);
		return id;
	}

	/**
	 * Closes the open cycle of an item that leaves the list without being ticked off. A cycle
	 * with partial purchases was really (partly) bought: it is completed with what was bought,
	 * once, instead of cancelled.
	 */
	private cancelOpenCycle(item: ItemRow, at: number) {
		if (item.status !== 'active' || !item.cycle_id) return;
		const cycle = this.cycle(item.cycle_id);
		if (!cycle || cycle.completed_at !== null) return;
		this.capture('cycles', cycle.id);
		if (cycle.purchased_quantity) {
			this.db
				.prepare(
					'UPDATE cycles SET completed_at = ?, quantity = ?, cancelled_at = NULL WHERE id = ?'
				)
				.run(cycle.last_purchase_at ?? at, cycle.purchased_quantity, cycle.id);
		} else {
			this.db.prepare('UPDATE cycles SET cancelled_at = ? WHERE id = ?').run(at, cycle.id);
		}
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

	private nextItemPosition(listId: string): number {
		return (
			this.db
				.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM items WHERE list_id = ?')
				.get(listId) as { p: number }
		).p;
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
				table === 'lists' ? this.t.toast.listExists(name) : this.t.toast.categoryExists(name)
			);
		}
	}

	private releaseClaim(itemId: string) {
		this.db.prepare('DELETE FROM claims WHERE item_id = ?').run(itemId);
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
						'INSERT INTO lists (id, name, position, created_at, updated_at, kind) VALUES (?, ?, ?, ?, ?, ?)'
					)
					.run(op.listId, name, this.nextPosition('lists'), now, now, op.kind ?? 'grocery');
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
				if (count <= 1) throw new Rejection('last_list', this.t.server.lastList);
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
			case 'list.setKind':
				return this.setListKind(op.listId, op.kind, ts, now);
			case 'list.setCategoryOrder': {
				const list = this.list(op.listId);
				let order: string | null = null;
				if (op.categoryIds) {
					const known = new Set(
						(this.db.prepare('SELECT id FROM categories').all() as { id: string }[]).map(
							(r) => r.id
						)
					);
					const ids = op.categoryIds.filter((id, i, a) => known.has(id) && a.indexOf(id) === i);
					order = ids.length ? JSON.stringify(ids) : null;
				}
				if (order === list.category_order) return { status: 'noop', reason: 'unchanged' };
				this.capture('lists', list.id);
				this.db
					.prepare('UPDATE lists SET category_order = ?, updated_at = ? WHERE id = ?')
					.run(order, now, list.id);
				return { status: 'applied' };
			}
			case 'list.resetChecklist': {
				const list = this.list(op.listId);
				if (list.kind !== 'checklist')
					throw new Rejection('not_checklist', this.t.server.notChecklist);
				let n = 0;
				for (const rawId of op.itemIds) {
					const item = this.row<ItemRow>('items', this.resolve(rawId));
					if (!item || item.list_id !== list.id || item.status !== 'completed') continue;
					this.capture('items', item.id);
					this.db
						.prepare(
							"UPDATE items SET status = 'active', activated_at = ?, completed_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?"
						)
						.run(Math.max(ts, item.completed_at ?? 0), now, item.id);
					n++;
				}
				return n ? { status: 'applied' } : { status: 'noop', reason: 'empty' };
			}
			case 'list.retryUnavailable': {
				const list = this.list(op.listId);
				const items = this.db
					.prepare('SELECT * FROM items WHERE list_id = ? AND unavailable_at IS NOT NULL')
					.all(list.id) as ItemRow[];
				if (!items.length) return { status: 'noop', reason: 'empty' };
				for (const item of items) {
					this.capture('items', item.id);
					this.touchItem(item, now, ', unavailable_at = NULL');
				}
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
				if (!cat) throw new Rejection('not_found', this.t.server.categoryGone);
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
			case 'items.addMany':
				return this.addMany(op, ts, now);
			case 'item.increment':
				return this.increment(op, now);
			case 'item.purchasePartial':
				return this.purchasePartial(op, ts, now);

			case 'item.complete': {
				const item = this.item(op.itemId);
				if (item.status === 'completed')
					return { status: 'noop', reason: 'already_completed', itemId: item.id };
				const list = this.list(item.list_id);
				const at = Math.max(ts, item.activated_at);
				this.capture('items', item.id);
				let cycleId = item.cycle_id;
				if (list.kind === 'grocery') {
					// Ticking off a grocery item records one purchase: what was bought earlier in this
					// cycle (partial purchases) plus what was still on the list.
					let cycle = this.cycle(cycleId);
					if (!cycle || cycle.completed_at !== null) {
						cycleId = this.newCycle(
							`c-${op.id}`,
							item.product_id,
							item.list_id,
							item.activated_at,
							item.quantity,
							item.unit
						);
						cycle = this.cycle(cycleId)!;
					} else {
						this.capture('cycles', cycle.id);
					}
					const bought =
						item.quantity === null
							? cycle.purchased_quantity
							: roundQuantity((cycle.purchased_quantity ?? 0) + item.quantity);
					this.db
						.prepare(
							'UPDATE cycles SET completed_at = ?, cancelled_at = NULL, quantity = ?, unit = ?, purchased_quantity = ?, last_purchase_at = ? WHERE id = ?'
						)
						.run(at, bought, item.unit, bought, at, cycle.id);
				}
				// Checklist items never record a purchase, stock change or prediction input.
				this.releaseClaim(item.id);
				this.db
					.prepare(
						"UPDATE items SET status = 'completed', completed_at = ?, cycle_id = ?, unavailable_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?"
					)
					.run(at, cycleId, now, item.id);
				return { status: 'applied', itemId: item.id };
			}
			case 'item.reactivate': {
				const item = this.item(op.itemId);
				if (item.status === 'active')
					return { status: 'noop', reason: 'already_active', itemId: item.id };
				this.reactivate(item, op.id, ts, now, null);
				return { status: 'applied', itemId: item.id };
			}
			case 'item.update':
				return this.updateItem(op, now);
			case 'item.setUnavailable': {
				const item = this.item(op.itemId);
				if (this.list(item.list_id).kind !== 'grocery')
					throw new Rejection('not_grocery', this.t.server.groceryOnly);
				if (op.unavailable && item.status !== 'active')
					return { status: 'noop', reason: 'not_active', itemId: item.id };
				if (op.unavailable === (item.unavailable_at !== null))
					return { status: 'noop', reason: 'unchanged', itemId: item.id };
				this.capture('items', item.id);
				this.db
					.prepare(
						'UPDATE items SET unavailable_at = ?, updated_at = ?, version = version + 1 WHERE id = ?'
					)
					.run(op.unavailable ? ts : null, now, item.id);
				if (op.unavailable) this.releaseClaim(item.id);
				return { status: 'applied', itemId: item.id };
			}
			case 'item.reorder': {
				const list = this.list(op.listId);
				const all = (
					this.db
						.prepare('SELECT id FROM items WHERE list_id = ? ORDER BY position, activated_at')
						.all(list.id) as { id: string }[]
				).map((r) => r.id);
				const wanted = op.itemIds
					.map((i) => this.resolve(i))
					.filter((i, idx, arr) => all.includes(i) && arr.indexOf(i) === idx);
				const order = [...wanted, ...all.filter((i) => !wanted.includes(i))];
				let changed = false;
				order.forEach((id, i) => {
					const item = this.row<ItemRow>('items', id)!;
					if (item.position === i + 1) return;
					this.capture('items', id);
					this.db
						.prepare(
							'UPDATE items SET position = ?, updated_at = ?, version = version + 1 WHERE id = ?'
						)
						.run(i + 1, now, id);
					changed = true;
				});
				return changed ? { status: 'applied' } : { status: 'noop', reason: 'unchanged' };
			}
			case 'item.claim':
				return this.claim(op, now);
			case 'item.release': {
				const item = this.row<ItemRow>('items', this.resolve(op.itemId));
				if (!item) return { status: 'noop', reason: 'not_found' };
				const claim = this.db.prepare('SELECT * FROM claims WHERE item_id = ?').get(item.id) as
					Row | undefined;
				if (!claim) return { status: 'noop', reason: 'not_claimed', itemId: item.id };
				if (claim.device_id !== op.deviceId && (claim.expires_at as number) > now)
					return { status: 'noop', reason: 'claimed_by_other', itemId: item.id };
				this.releaseClaim(item.id);
				return { status: 'applied', itemId: item.id };
			}
			case 'item.move':
				return this.moveItem(op, ts, now);
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
				for (const [table, sql] of [
					['items', 'SELECT id FROM items WHERE product_id = ?'],
					['cycles', 'SELECT id FROM cycles WHERE product_id = ?'],
					['product_aliases', 'SELECT id FROM product_aliases WHERE product_id = ?'],
					['bundle_lines', 'SELECT id FROM bundle_lines WHERE product_id = ?'],
					['snoozes', 'SELECT id FROM snoozes WHERE product_id = ?']
				] as const)
					for (const r of this.db.prepare(sql).all(product.id) as { id: string }[])
						this.capture(table, r.id);
				this.db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
				return { status: 'applied', productId: product.id };
			}
			case 'product.setStock': {
				const product = this.product(op.productId);
				this.capture('products', product.id);
				this.db
					.prepare(
						'UPDATE products SET stock_status = ?, stock_updated_at = ?, updated_at = ?, version = version + 1 WHERE id = ?'
					)
					.run(op.status, ts, now, product.id);
				return { status: 'applied', productId: product.id };
			}
			case 'product.setPhoto': {
				const product = this.product(op.productId);
				if (op.mediaId === product.photo_id)
					return { status: 'noop', reason: 'unchanged', productId: product.id };
				if (op.mediaId && !this.row('media', op.mediaId))
					throw new Rejection('media_missing', this.t.server.mediaMissing);
				this.capture('products', product.id);
				this.db
					.prepare(
						'UPDATE products SET photo_id = ?, updated_at = ?, version = version + 1 WHERE id = ?'
					)
					.run(op.mediaId, now, product.id);
				return { status: 'applied', productId: product.id };
			}
			case 'product.snooze': {
				const product = this.product(op.productId);
				const current = this.db
					.prepare('SELECT * FROM snoozes WHERE product_id = ?')
					.get(product.id) as { id: string; until: number } | undefined;
				if (op.until <= now) {
					if (!current) return { status: 'noop', reason: 'unchanged', productId: product.id };
					this.capture('snoozes', current.id);
					this.db.prepare('DELETE FROM snoozes WHERE id = ?').run(current.id);
					return { status: 'applied', productId: product.id };
				}
				const sid = current?.id ?? `s-${product.id}`.slice(0, 64);
				this.capture('snoozes', sid);
				this.db
					.prepare(
						`INSERT INTO snoozes (id, product_id, until, updated_at) VALUES (?, ?, ?, ?)
						 ON CONFLICT(product_id) DO UPDATE SET until = excluded.until, updated_at = excluded.updated_at`
					)
					.run(sid, product.id, op.until, now);
				return { status: 'applied', productId: product.id };
			}
			case 'alias.add': {
				if (this.row('product_aliases', op.aliasId)) return { status: 'noop', reason: 'exists' };
				const product = this.product(op.productId);
				const alias = cleanName(op.alias);
				const key = nameKey(alias);
				const nameClash = this.db
					.prepare('SELECT name FROM products WHERE name_key = ?')
					.get(key) as { name: string } | undefined;
				if (nameClash)
					throw new Rejection('duplicate', this.t.server.aliasIsName(alias, nameClash.name));
				const aliasClash = this.db
					.prepare(
						'SELECT p.name FROM product_aliases a JOIN products p ON p.id = a.product_id WHERE a.alias_key = ?'
					)
					.get(key) as { name: string } | undefined;
				if (aliasClash)
					throw new Rejection('duplicate', this.t.server.aliasIsAlias(alias, aliasClash.name));
				this.capture('product_aliases', op.aliasId);
				this.db
					.prepare(
						'INSERT INTO product_aliases (id, product_id, alias, alias_key, created_at) VALUES (?, ?, ?, ?, ?)'
					)
					.run(op.aliasId, product.id, alias, key, now);
				return { status: 'applied', productId: product.id };
			}
			case 'alias.remove': {
				if (!this.row('product_aliases', op.aliasId))
					return { status: 'noop', reason: 'not_found' };
				this.capture('product_aliases', op.aliasId);
				this.db.prepare('DELETE FROM product_aliases WHERE id = ?').run(op.aliasId);
				return { status: 'applied' };
			}
			case 'bundle.save':
				return this.saveBundle(op, ts, now);
			case 'bundle.delete': {
				const bundle = this.row<Row>('bundles', op.bundleId);
				if (!bundle) return { status: 'noop', reason: 'not_found' };
				this.capture('bundles', op.bundleId);
				for (const r of this.db
					.prepare('SELECT id FROM bundle_lines WHERE bundle_id = ?')
					.all(op.bundleId) as { id: string }[])
					this.capture('bundle_lines', r.id);
				// Lines cascade; products and history stay untouched.
				this.db.prepare('DELETE FROM bundles WHERE id = ?').run(op.bundleId);
				return { status: 'applied' };
			}
			case 'round.join':
				return this.joinRound(op, ts, now);
			case 'round.leave': {
				const round = this.row<RoundRow>('rounds', this.resolve(op.roundId));
				if (!round || round.ended_at !== null) return { status: 'noop', reason: 'ended' };
				const left = this.db
					.prepare(
						'UPDATE round_participants SET left_at = ? WHERE round_id = ? AND device_id = ? AND left_at IS NULL'
					)
					.run(now, round.id, op.deviceId).changes;
				this.db
					.prepare('DELETE FROM claims WHERE round_id = ? AND device_id = ?')
					.run(round.id, op.deviceId);
				const remaining = (
					this.db
						.prepare(
							'SELECT COUNT(*) AS n FROM round_participants WHERE round_id = ? AND left_at IS NULL'
						)
						.get(round.id) as { n: number }
				).n;
				if (!remaining) this.endRound(round.id, op.deviceId, 'left', now);
				return left || !remaining
					? { status: 'applied', roundId: round.id }
					: { status: 'noop', reason: 'not_participating', roundId: round.id };
			}
			case 'round.end': {
				const round = this.row<RoundRow>('rounds', this.resolve(op.roundId));
				if (!round || round.ended_at !== null) return { status: 'noop', reason: 'ended' };
				this.endRound(round.id, op.deviceId, 'ended', now);
				return { status: 'applied', roundId: round.id };
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
			case 'settings.update':
				// Hiding features never deletes data: suggestions and history stay stored and come back as is.
				return writeSettings(this.db, {
					suggestionsEnabled: op.suggestionsEnabled,
					bulkAddEnabled: op.bulkAddEnabled,
					language: op.language
				})
					? { status: 'applied' }
					: { status: 'noop', reason: 'unchanged' };
			case 'undo':
				return this.undo(op.targetOpId, now);
		}
	}

	/**
	 * Finds the product for a typed name (exact name, then a manual alias) or creates it.
	 * Similar names or variants are never merged automatically.
	 */
	private ensureProduct(
		rawName: string,
		requestedId: string,
		categoryId: string | null,
		opKey: string,
		ts: number,
		now: number
	): ProductRow {
		const name = capitaliseFirst(cleanName(rawName));
		const key = nameKey(name);
		let product = this.db.prepare('SELECT * FROM products WHERE name_key = ?').get(key) as
			ProductRow | undefined;
		if (!product) {
			product = this.db
				.prepare(
					'SELECT p.* FROM product_aliases a JOIN products p ON p.id = a.product_id WHERE a.alias_key = ?'
				)
				.get(key) as ProductRow | undefined;
		}
		if (!product) {
			const productId = this.row('products', requestedId) ? `p-${opKey}`.slice(0, 64) : requestedId;
			const cat = categoryId && this.row('categories', categoryId) ? categoryId : null;
			this.capture('products', productId);
			this.db
				.prepare(
					'INSERT INTO products (id, name, name_key, category_id, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
				)
				.run(productId, name, key, cat, ts, now);
			product = this.row<ProductRow>('products', productId)!;
		}
		this.alias(requestedId, product.id, 'product', now);
		return product;
	}

	private createItem(
		itemIdRequested: string,
		opKey: string,
		list: ListRow,
		product: ProductRow,
		quantity: number | null,
		unit: string | null,
		note: string | null,
		ts: number,
		now: number
	): string {
		const itemId = this.row('items', itemIdRequested) ? `i-${opKey}`.slice(0, 64) : itemIdRequested;
		this.alias(itemIdRequested, itemId, 'item', now);
		const cycleId =
			list.kind === 'grocery'
				? this.newCycle(`c-${opKey}`.slice(0, 64), product.id, list.id, ts, quantity, unit)
				: null;
		this.capture('items', itemId);
		this.db
			.prepare(
				`INSERT INTO items (id, list_id, product_id, quantity, unit, status, activated_at, cycle_id, created_at, updated_at, note, position)
				 VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`
			)
			.run(
				itemId,
				list.id,
				product.id,
				quantity,
				unit,
				ts,
				cycleId,
				ts,
				now,
				note,
				this.nextItemPosition(list.id)
			);
		return itemId;
	}

	/**
	 * Puts a completed item back on its list as a new need. `quantity` replaces the remembered
	 * amount when given (an explicitly entered amount wins). The note and substitute info of the
	 * previous need are cleared unless it was ticked off only moments ago (same trip).
	 */
	private reactivate(
		item: ItemRow,
		opKey: string,
		ts: number,
		now: number,
		change: { quantity: number | null; unit: string | null; note?: string | null } | null
	) {
		const list = this.list(item.list_id);
		this.capture('items', item.id);
		const at = Math.max(ts, item.completed_at ?? 0);
		const quantity = change && change.quantity !== null ? change.quantity : item.quantity;
		const unit = change && change.quantity !== null ? change.unit : item.unit;
		const freshNeed = at - (item.completed_at ?? 0) > NOTE_KEEP_MS;
		const note =
			change?.note !== undefined && change.note !== null
				? change.note
				: freshNeed
					? null
					: item.note;
		const cycleId =
			list.kind === 'grocery'
				? this.newCycle(
						`c-${opKey}`.slice(0, 64),
						item.product_id,
						item.list_id,
						at,
						quantity,
						unit
					)
				: null;
		this.db
			.prepare(
				`UPDATE items SET status = 'active', activated_at = ?, completed_at = NULL, cycle_id = ?,
					quantity = ?, unit = ?, note = ?, substitute_ok = ?, substitute_note = ?, unavailable_at = NULL,
					quantity_rev = quantity_rev + ?, updated_at = ?, version = version + 1 WHERE id = ?`
			)
			.run(
				at,
				cycleId,
				quantity,
				unit,
				note,
				freshNeed ? 0 : item.substitute_ok,
				freshNeed ? null : item.substitute_note,
				quantity !== item.quantity || unit !== item.unit ? 1 : 0,
				now,
				item.id
			);
	}

	private addItem(op: Extract<Op, { type: 'item.add' }>, ts: number, now: number): Outcome {
		const list = this.list(op.listId);
		const product = this.ensureProduct(op.name, op.productId, op.categoryId, op.id, ts, now);

		const existing = this.db
			.prepare('SELECT * FROM items WHERE list_id = ? AND product_id = ?')
			.get(list.id, product.id) as ItemRow | undefined;

		if (existing && existing.status === 'active') {
			// Never a silent change: the quantity stays as it is (see docs/SYNC.md, intents).
			this.alias(op.itemId, existing.id, 'item', now);
			return {
				status: 'noop',
				reason: 'duplicate',
				message: this.t.server.alreadyOnList(product.name),
				itemId: existing.id,
				productId: product.id
			};
		}

		if (existing) {
			this.reactivate(existing, op.id, ts, now, {
				quantity: op.quantity,
				unit: op.quantity !== null || op.unit !== null ? op.unit : existing.unit,
				note: op.note ?? null
			});
			this.alias(op.itemId, existing.id, 'item', now);
			return {
				status: 'applied',
				reason: 'reactivated',
				itemId: existing.id,
				productId: product.id
			};
		}

		const itemId = this.createItem(
			op.itemId,
			op.id,
			list,
			product,
			op.quantity,
			op.unit,
			op.note ?? null,
			ts,
			now
		);
		return { status: 'applied', reason: 'created', itemId, productId: product.id };
	}

	/**
	 * Combined add (bulk paste, bundle, share target). All entries succeed or nothing changes:
	 * the handler runs in one savepoint and any rejection rolls the whole op back.
	 */
	private addMany(op: Extract<Op, { type: 'items.addMany' }>, ts: number, now: number): Outcome {
		const list = this.list(op.listId);
		const summary: AddManySummary = {
			added: 0,
			reactivated: 0,
			increased: 0,
			set: 0,
			unchanged: 0
		};
		op.entries.forEach((e: AddManyEntry, index) => {
			const key = `${op.id}-${index}`;
			const product = this.ensureProduct(e.name, e.productId, e.categoryId, key, ts, now);
			const existing = this.db
				.prepare('SELECT * FROM items WHERE list_id = ? AND product_id = ?')
				.get(list.id, product.id) as ItemRow | undefined;
			if (!existing) {
				this.createItem(e.itemId, key, list, product, e.quantity, e.unit, e.note, ts, now);
				summary.added++;
				return;
			}
			this.alias(e.itemId, existing.id, 'item', now);
			if (existing.status === 'completed') {
				this.reactivate(existing, key, ts, now, {
					quantity: e.quantity,
					unit: e.quantity !== null ? e.unit : existing.unit,
					note: e.note
				});
				summary.reactivated++;
				return;
			}
			const current = this.row<ItemRow>('items', existing.id)!;
			if (e.action === 'add') {
				summary.unchanged++;
				if (e.note && !current.note) {
					this.capture('items', current.id);
					this.db.prepare('UPDATE items SET note = ? WHERE id = ?').run(e.note, current.id);
					this.touchItem(current, now);
				}
				return;
			}
			if (e.action === 'extra') {
				this.applyIncrement(current, e.quantity!, e.unit, product.name, now, false);
				summary.increased++;
				return;
			}
			if (current.quantity === e.quantity && current.unit === e.unit) {
				summary.unchanged++;
				return;
			}
			this.capture('items', current.id);
			this.setItemQuantity(current, e.quantity, e.unit, now);
			summary.set++;
		});
		const changed = summary.added + summary.reactivated + summary.increased + summary.set;
		const anyNote = this.captured && this.captured.size > 0;
		return changed || anyNote
			? { status: 'applied', summary }
			: { status: 'noop', reason: 'unchanged', summary };
	}

	private setItemQuantity(
		item: ItemRow,
		quantity: number | null,
		unit: string | null,
		now: number
	) {
		this.db
			.prepare(
				'UPDATE items SET quantity = ?, unit = ?, quantity_rev = quantity_rev + 1, updated_at = ?, version = version + 1 WHERE id = ?'
			)
			.run(quantity, unit, now, item.id);
		if (item.status === 'active' && item.cycle_id) {
			this.capture('cycles', item.cycle_id);
			this.db
				.prepare('UPDATE cycles SET quantity = ?, unit = ?, requested_quantity = ? WHERE id = ?')
				.run(quantity, unit, quantity, item.cycle_id);
		}
	}

	/**
	 * Atomic, server-side "+N": two devices that each add 1 to 2 end up at 4. Only compatible
	 * units are converted (g/kg, ml/l); an unknown existing amount is never assumed to be 1.
	 */
	private applyIncrement(
		item: ItemRow,
		delta: number,
		unit: string | null,
		name: string,
		now: number,
		record: boolean
	): number {
		if (item.status !== 'active') throw new Rejection('not_active', this.t.server.notOnList(name));
		if (item.quantity === null)
			throw new Rejection('unknown_quantity', this.t.server.unknownQtyChoose(name));
		const converted = convertQuantity(delta, unit, item.unit);
		if (converted === null)
			throw new Rejection(
				'incompatible_unit',
				this.t.server.incompatibleUnit(
					name,
					this.qty(item.quantity, item.unit),
					this.qty(delta, unit)
				)
			);
		const next = roundQuantity(item.quantity + converted);
		if (next >= 100000) throw new Rejection('too_large', this.t.server.tooLarge);
		if (!record) this.capture('items', item.id);
		this.db
			.prepare('UPDATE items SET quantity = ?, updated_at = ?, version = version + 1 WHERE id = ?')
			.run(next, now, item.id);
		if (item.cycle_id) {
			if (!record) this.capture('cycles', item.cycle_id);
			this.db
				.prepare(
					'UPDATE cycles SET quantity = ?, requested_quantity = COALESCE(requested_quantity, 0) + ? WHERE id = ? AND completed_at IS NULL'
				)
				.run(next, converted, item.cycle_id);
		}
		if (record)
			this.semantic = {
				kind: 'increment',
				itemId: item.id,
				cycleId: item.cycle_id,
				delta: converted,
				unit: item.unit,
				quantityRev: item.quantity_rev
			};
		return next;
	}

	private increment(op: Extract<Op, { type: 'item.increment' }>, now: number): Outcome {
		const item = this.item(op.itemId);
		this.applyIncrement(item, op.delta, op.unit, this.itemName(item), now, true);
		return { status: 'applied', itemId: item.id };
	}

	/**
	 * "Deels gehaald": of 3 packs, 2 were bought. The 2 are recorded on the open cycle and 1
	 * stays on the list. Ticking off later adds only the remainder, so nothing is counted twice,
	 * and several partial actions remain one purchase for the statistics.
	 */
	private purchasePartial(
		op: Extract<Op, { type: 'item.purchasePartial' }>,
		ts: number,
		now: number
	): Outcome {
		const item = this.activeItem(op.itemId);
		const name = this.itemName(item);
		if (this.list(item.list_id).kind !== 'grocery')
			throw new Rejection('not_grocery', this.t.server.partialGroceryOnly);
		if (item.quantity === null)
			throw new Rejection('unknown_quantity', this.t.server.unknownQty(name));
		const bought = convertQuantity(op.quantity, op.unit, item.unit);
		if (bought === null) throw new Rejection('incompatible_unit', this.t.server.useUnitOf(name));
		if (bought >= item.quantity)
			throw new Rejection('use_complete', this.t.server.useComplete(name));
		let cycle = this.cycle(item.cycle_id);
		let cycleId = item.cycle_id;
		if (!cycle || cycle.completed_at !== null) {
			cycleId = this.newCycle(
				`c-${op.id}`,
				item.product_id,
				item.list_id,
				item.activated_at,
				item.quantity,
				item.unit
			);
			cycle = this.cycle(cycleId)!;
			this.db.prepare('UPDATE items SET cycle_id = ? WHERE id = ?').run(cycleId, item.id);
		}
		const rest = roundQuantity(item.quantity - bought);
		this.db
			.prepare(
				'UPDATE cycles SET purchased_quantity = ?, last_purchase_at = ?, quantity = ? WHERE id = ?'
			)
			.run(roundQuantity((cycle.purchased_quantity ?? 0) + bought), ts, rest, cycle.id);
		this.db
			.prepare(
				'UPDATE items SET quantity = ?, unavailable_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?'
			)
			.run(rest, now, item.id);
		this.semantic = {
			kind: 'partial',
			itemId: item.id,
			cycleId,
			delta: bought,
			unit: item.unit,
			quantityRev: item.quantity_rev
		};
		return { status: 'applied', itemId: item.id };
	}

	private updateItem(op: Extract<Op, { type: 'item.update' }>, now: number): Outcome {
		const item = this.item(op.itemId);
		const conflicts: FieldConflict[] = [];
		const current = {
			quantity: item.quantity,
			unit: item.unit,
			note: item.note,
			substituteOk: item.substitute_ok === 1,
			substituteNote: item.substitute_note
		};
		const next = { ...current };
		for (const field of Object.keys(current) as (keyof typeof current)[]) {
			if (!(field in op.changes)) continue;
			const written = op.changes[field] ?? (field === 'substituteOk' ? false : null);
			if (
				field in op.base &&
				(op.base[field] ?? null) !== current[field] &&
				current[field] !== written
			)
				conflicts.push({
					field,
					previous: current[field],
					expected: op.base[field] ?? null,
					written
				});
			(next as Record<string, unknown>)[field] = written;
		}
		const same = (Object.keys(current) as (keyof typeof current)[]).every(
			(k) => next[k] === current[k]
		);
		if (same) return { status: 'noop', reason: 'unchanged', itemId: item.id };
		this.capture('items', item.id);
		const quantityChanged = next.quantity !== item.quantity || next.unit !== item.unit;
		this.db
			.prepare(
				`UPDATE items SET quantity = ?, unit = ?, note = ?, substitute_ok = ?, substitute_note = ?,
					quantity_rev = quantity_rev + ?, updated_at = ?, version = version + 1 WHERE id = ?`
			)
			.run(
				next.quantity,
				next.unit,
				next.note,
				next.substituteOk ? 1 : 0,
				next.substituteNote,
				quantityChanged ? 1 : 0,
				now,
				item.id
			);
		if (quantityChanged && item.status === 'active' && item.cycle_id) {
			this.capture('cycles', item.cycle_id);
			this.db
				.prepare(
					'UPDATE cycles SET quantity = ?, unit = ?, requested_quantity = ? WHERE id = ? AND completed_at IS NULL'
				)
				.run(next.quantity, next.unit, next.quantity, item.cycle_id);
		}
		return {
			status: 'applied',
			itemId: item.id,
			...(conflicts.length
				? {
						conflicts,
						message: this.t.server.changedElsewhere(this.itemName(item))
					}
				: {})
		};
	}

	private moveItem(op: Extract<Op, { type: 'item.move' }>, ts: number, now: number): Outcome {
		const item = this.item(op.itemId);
		const target = this.list(op.toListId);
		const source = this.list(item.list_id);
		if (item.list_id === target.id) return { status: 'noop', reason: 'same_list', itemId: item.id };
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
		this.releaseClaim(item.id);
		let cycleId = item.cycle_id;
		if (item.status === 'active' && source.kind !== target.kind) {
			// Purchases only exist on grocery lists.
			if (target.kind === 'checklist') {
				this.cancelOpenCycle(item, ts);
				cycleId = null;
			} else {
				cycleId = this.newCycle(
					`c-${op.id}`,
					item.product_id,
					target.id,
					ts,
					item.quantity,
					item.unit
				);
			}
		} else if (item.status === 'active' && item.cycle_id) {
			this.capture('cycles', item.cycle_id);
			this.db.prepare('UPDATE cycles SET list_id = ? WHERE id = ?').run(target.id, item.cycle_id);
		}
		this.db
			.prepare(
				'UPDATE items SET list_id = ?, cycle_id = ?, unavailable_at = NULL, position = ?, updated_at = ?, version = version + 1 WHERE id = ?'
			)
			.run(target.id, cycleId, this.nextItemPosition(target.id), now, item.id);
		return { status: 'applied', itemId: item.id };
	}

	private claim(op: Extract<Op, { type: 'item.claim' }>, now: number): Outcome {
		const item = this.activeItem(op.itemId);
		const existing = this.db.prepare('SELECT * FROM claims WHERE item_id = ?').get(item.id) as
			Row | undefined;
		if (existing && existing.device_id !== op.deviceId && (existing.expires_at as number) > now) {
			return {
				status: 'noop',
				reason: 'claimed',
				itemId: item.id,
				message: this.t.server.claimedBy(
					(existing.device_name as string | null) ?? this.t.common.someoneElse,
					this.itemName(item)
				)
			};
		}
		const round = this.db
			.prepare('SELECT id FROM rounds WHERE list_id = ? AND ended_at IS NULL')
			.get(item.list_id) as { id: string } | undefined;
		this.db
			.prepare(
				`INSERT INTO claims (item_id, round_id, device_id, device_name, claimed_at, expires_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(item_id) DO UPDATE SET round_id = excluded.round_id, device_id = excluded.device_id,
					device_name = excluded.device_name, claimed_at = excluded.claimed_at, expires_at = excluded.expires_at`
			)
			.run(item.id, round?.id ?? null, op.deviceId, op.deviceName, now, now + CLAIM_TTL_MS);
		return { status: 'applied', itemId: item.id };
	}

	/**
	 * Changes a list between grocery list and checklist. Existing history is kept as is; the new
	 * behaviour applies from now on: open purchase cycles are closed without inventing purchases
	 * (grocery → checklist) or started now (checklist → grocery).
	 */
	private setListKind(listId: string, kind: ListKind, ts: number, now: number): Outcome {
		const list = this.list(listId);
		if (list.kind === kind) return { status: 'noop', reason: 'unchanged' };
		this.capture('lists', list.id);
		const active = this.db
			.prepare("SELECT * FROM items WHERE list_id = ? AND status = 'active'")
			.all(list.id) as ItemRow[];
		for (const item of active) {
			this.capture('items', item.id);
			if (kind === 'checklist') {
				this.cancelOpenCycle(item, ts);
				this.db
					.prepare(
						'UPDATE items SET cycle_id = NULL, unavailable_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?'
					)
					.run(now, item.id);
			} else {
				const cycleId = this.newCycle(
					`c-${item.id}-${ts}`.slice(0, 64),
					item.product_id,
					list.id,
					ts,
					item.quantity,
					item.unit
				);
				this.db
					.prepare(
						'UPDATE items SET cycle_id = ?, updated_at = ?, version = version + 1 WHERE id = ?'
					)
					.run(cycleId, now, item.id);
			}
		}
		if (kind === 'checklist') {
			for (const r of this.db
				.prepare('SELECT id FROM rounds WHERE list_id = ? AND ended_at IS NULL')
				.all(list.id) as { id: string }[])
				this.endRound(r.id, null, 'kind_changed', now);
		}
		this.db
			.prepare('UPDATE lists SET kind = ?, kind_changed_at = ?, updated_at = ? WHERE id = ?')
			.run(kind, ts, now, list.id);
		return { status: 'applied' };
	}

	private saveBundle(op: Extract<Op, { type: 'bundle.save' }>, ts: number, now: number): Outcome {
		const existing = this.row<Row>('bundles', op.bundleId);
		const name = capitaliseFirst(cleanName(op.name));
		this.capture('bundles', op.bundleId);
		for (const r of this.db
			.prepare('SELECT id FROM bundle_lines WHERE bundle_id = ?')
			.all(op.bundleId) as { id: string }[])
			this.capture('bundle_lines', r.id);
		if (existing) {
			this.db
				.prepare(
					'UPDATE bundles SET name = ?, servings = ?, updated_at = ?, version = version + 1 WHERE id = ?'
				)
				.run(name, op.servings, now, op.bundleId);
			this.db.prepare('DELETE FROM bundle_lines WHERE bundle_id = ?').run(op.bundleId);
		} else {
			this.db
				.prepare(
					'INSERT INTO bundles (id, name, servings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
				)
				.run(op.bundleId, name, op.servings, now, now);
		}
		const seen = new Set<string>();
		const ins = this.db.prepare(
			'INSERT INTO bundle_lines (id, bundle_id, product_id, quantity, unit, note, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
		);
		op.lines.forEach((l, i) => {
			const product = this.ensureProduct(l.name, l.productId, null, `${op.id}-${i}`, ts, now);
			if (seen.has(product.id))
				throw new Rejection('duplicate', this.t.server.bundleDuplicate(product.name));
			seen.add(product.id);
			let lineId = l.lineId;
			const clash = this.row<Row>('bundle_lines', lineId);
			if (clash) lineId = `l-${op.id}-${i}`.slice(0, 64);
			this.capture('bundle_lines', lineId);
			ins.run(
				lineId,
				op.bundleId,
				product.id,
				l.quantity,
				l.quantity === null ? null : l.unit,
				l.note,
				i
			);
		});
		return { status: 'applied' };
	}

	private joinRound(op: Extract<Op, { type: 'round.join' }>, ts: number, now: number): Outcome {
		const list = this.list(op.listId);
		if (list.kind !== 'grocery') throw new Rejection('not_grocery', this.t.server.roundGroceryOnly);
		let round = this.db
			.prepare('SELECT * FROM rounds WHERE list_id = ? AND ended_at IS NULL')
			.get(list.id) as RoundRow | undefined;
		let started = false;
		if (!round) {
			const id = this.row('rounds', op.roundId) ? `r-${op.id}`.slice(0, 64) : op.roundId;
			// The partial unique index makes a concurrent second start impossible.
			this.db
				.prepare('INSERT INTO rounds (id, list_id, started_at, started_by) VALUES (?, ?, ?, ?)')
				.run(id, list.id, Math.min(ts, now), op.deviceName);
			round = this.row<RoundRow>('rounds', id)!;
			started = true;
			// A new round: items parked as "Niet verkrijgbaar" are to be fetched normally again.
			this.db
				.prepare(
					'UPDATE items SET unavailable_at = NULL, updated_at = ?, version = version + 1 WHERE list_id = ? AND unavailable_at IS NOT NULL'
				)
				.run(now, list.id);
		}
		this.alias(op.roundId, round.id, 'round', now);
		this.db
			.prepare(
				`INSERT INTO round_participants (round_id, device_id, device_name, joined_at, last_seen_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(round_id, device_id) DO UPDATE SET device_name = excluded.device_name,
					last_seen_at = excluded.last_seen_at, left_at = NULL`
			)
			.run(round.id, op.deviceId, op.deviceName, now, now);
		return { status: 'applied', reason: started ? 'started' : 'joined', roundId: round.id };
	}

	/** Ending a round books nothing: it only clears presence and claims. */
	private endRound(roundId: string, by: string | null, reason: string, now: number) {
		this.db
			.prepare('UPDATE rounds SET ended_at = ?, ended_by = ?, end_reason = ? WHERE id = ?')
			.run(now, by, reason, roundId);
		this.db
			.prepare('UPDATE round_participants SET left_at = ? WHERE round_id = ? AND left_at IS NULL')
			.run(now, roundId);
		this.db.prepare('DELETE FROM claims WHERE round_id = ?').run(roundId);
	}

	private recommendation(id: string): AiRecommendationRow {
		const rec = this.row<AiRecommendationRow>('ai_recommendations', id);
		if (!rec) throw new Rejection('not_found', this.t.server.recGone);
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
		const product = this.product(op.productId);
		const current = {
			name: product.name,
			categoryId: product.category_id,
			favorite: product.favorite === 1,
			defaultQuantity: product.default_quantity,
			defaultUnit: product.default_unit,
			preferredListId: product.preferred_list_id,
			note: product.note
		};
		const next = { ...current };
		const conflicts: FieldConflict[] = [];

		if (op.changes.name !== undefined) {
			const name = cleanName(op.changes.name);
			const key = nameKey(name);
			const clash = this.db
				.prepare('SELECT id, name FROM products WHERE name_key = ? AND id != ?')
				.get(key, product.id) as { id: string; name: string } | undefined;
			if (clash) throw new Rejection('duplicate', this.t.server.productExists(clash.name));
			const aliasClash = this.db
				.prepare('SELECT product_id FROM product_aliases WHERE alias_key = ? AND product_id != ?')
				.get(key, product.id);
			if (aliasClash) throw new Rejection('duplicate', this.t.server.aliasOfOther(name));
			next.name = name;
		}
		if (op.changes.categoryId !== undefined) {
			const cid = op.changes.categoryId;
			if (cid !== null && !this.row('categories', cid))
				throw new Rejection('category_not_found', this.t.server.categoryGone);
			next.categoryId = cid;
		}
		if (op.changes.favorite !== undefined) next.favorite = op.changes.favorite;
		if ('defaultQuantity' in op.changes) next.defaultQuantity = op.changes.defaultQuantity ?? null;
		if ('defaultUnit' in op.changes) next.defaultUnit = op.changes.defaultUnit ?? null;
		if (next.defaultQuantity === null) next.defaultUnit = null;
		if ('preferredListId' in op.changes) {
			const lid = op.changes.preferredListId ?? null;
			if (lid !== null && !this.row('lists', this.resolve(lid)))
				throw new Rejection('list_not_found', this.t.server.listGone);
			next.preferredListId = lid === null ? null : this.resolve(lid);
		}
		if ('note' in op.changes) next.note = op.changes.note ?? null;

		for (const field of Object.keys(current) as (keyof typeof current)[]) {
			if (!(field in op.changes) || !(field in op.base)) continue;
			if ((op.base[field] ?? null) !== current[field] && current[field] !== next[field]) {
				conflicts.push({
					field,
					previous: current[field],
					expected: op.base[field],
					written: next[field]
				});
			}
		}

		if ((Object.keys(current) as (keyof typeof current)[]).every((k) => next[k] === current[k]))
			return { status: 'noop', reason: 'unchanged', productId: product.id };

		this.capture('products', product.id);
		this.db
			.prepare(
				`UPDATE products SET name = ?, name_key = ?, category_id = ?, favorite = ?, default_quantity = ?,
					default_unit = ?, preferred_list_id = ?, note = ?, updated_at = ?, version = version + 1 WHERE id = ?`
			)
			.run(
				next.name,
				nameKey(next.name),
				next.categoryId,
				next.favorite ? 1 : 0,
				next.defaultQuantity,
				next.defaultUnit,
				next.preferredListId,
				next.note,
				now,
				product.id
			);
		return {
			status: 'applied',
			productId: product.id,
			...(conflicts.length
				? {
						conflicts,
						message: this.t.server.changedElsewhere(next.name)
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
			throw new Rejection('unknown_op', this.t.common.undoUnavailable);
		}
		if (target.undone_at) return { status: 'noop', reason: 'already_undone' };
		if (!target.inverse) return { status: 'noop', reason: 'nothing_to_undo' };
		const inverse = JSON.parse(target.inverse) as Inverse;

		if (inverse.semantic) {
			this.undoSemantic(inverse.semantic, now);
			this.db.prepare('UPDATE ops SET undone_at = ? WHERE id = ?').run(now, targetOpId);
			return { status: 'applied', reason: 'undone', itemId: inverse.semantic.itemId };
		}

		for (const g of inverse.guards) {
			if (this.stamp(g.table, g.id) !== g.version) {
				throw new Rejection('conflict', this.t.server.undoChangedElsewhere);
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
						`SELECT id FROM items WHERE product_id = ? UNION ALL SELECT id FROM cycles WHERE product_id = ?
						 UNION ALL SELECT id FROM bundle_lines WHERE product_id = ? UNION ALL SELECT id FROM product_aliases WHERE product_id = ?`
					)
					.all(r.id, r.id, r.id, r.id) as { id: string }[];
				if (refs.some((x) => !capturedIds.has(x.id))) continue;
			}
			this.db.prepare(`DELETE FROM ${r.table} WHERE id = ?`).run(r.id);
		}
		for (const r of restores) {
			const before = { ...(r.before as Row) };
			const current = this.row<Row>(r.table, r.id);
			if (VERSIONED.has(r.table)) {
				before.version = Math.max(Number(before.version ?? 1), Number(current?.version ?? 0)) + 1;
				if ('updated_at' in before) before.updated_at = now;
			}
			if (r.table === 'lists' || r.table === 'snoozes') before.updated_at = now;
			if (r.table === 'items')
				before.quantity_rev =
					Math.max(Number(before.quantity_rev ?? 0), Number(current?.quantity_rev ?? 0)) + 1;
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
					throw new Rejection('conflict', this.t.server.undoSimilarExists);
				throw e;
			}
		}
		// Rows whose parent list vanished in the meantime cannot be restored.
		const fk = this.db.pragma('foreign_key_check') as unknown[];
		if (fk.length) throw new Rejection('conflict', this.t.server.undoListGone);

		this.db.prepare('UPDATE ops SET undone_at = ? WHERE id = ?').run(now, targetOpId);
		return { status: 'applied', reason: 'undone' };
	}

	/**
	 * Undo of +extra or a partial purchase as a compensating change: later increments by others
	 * stay, but an absolute change made since (quantity set, ticked off, unit changed) means a
	 * safe inverse no longer exists and the undo is refused with a clear message.
	 */
	private undoSemantic(inv: SemanticInverse, now: number) {
		const item = this.row<ItemRow>('items', inv.itemId);
		const refuse = () => {
			throw new Rejection('conflict', this.t.server.undoQtyChanged);
		};
		if (
			!item ||
			item.status !== 'active' ||
			item.unit !== inv.unit ||
			item.quantity === null ||
			item.quantity_rev !== inv.quantityRev ||
			item.cycle_id !== inv.cycleId
		)
			refuse();
		const it = item!;
		if (inv.kind === 'increment') {
			const next = roundQuantity(it.quantity! - inv.delta);
			if (next <= 0) refuse();
			this.db
				.prepare(
					'UPDATE items SET quantity = ?, updated_at = ?, version = version + 1 WHERE id = ?'
				)
				.run(next, now, it.id);
			if (it.cycle_id)
				this.db
					.prepare(
						'UPDATE cycles SET quantity = ?, requested_quantity = MAX(COALESCE(requested_quantity, 0) - ?, 0) WHERE id = ? AND completed_at IS NULL'
					)
					.run(next, inv.delta, it.cycle_id);
			return;
		}
		const cycle = this.cycle(inv.cycleId);
		if (!cycle || cycle.completed_at !== null || (cycle.purchased_quantity ?? 0) < inv.delta)
			refuse();
		const next = roundQuantity(it.quantity! + inv.delta);
		const purchased = roundQuantity(cycle!.purchased_quantity! - inv.delta);
		this.db
			.prepare('UPDATE items SET quantity = ?, updated_at = ?, version = version + 1 WHERE id = ?')
			.run(next, now, it.id);
		this.db
			.prepare(
				'UPDATE cycles SET quantity = ?, purchased_quantity = ?, last_purchase_at = CASE WHEN ? > 0 THEN last_purchase_at END WHERE id = ?'
			)
			.run(next, purchased || null, purchased, cycle!.id);
	}
}

function toList(r: ListRow): List {
	let categoryOrder: string[] | null = null;
	try {
		const parsed = r.category_order ? (JSON.parse(r.category_order) as unknown) : null;
		if (Array.isArray(parsed)) categoryOrder = parsed.filter((x) => typeof x === 'string');
	} catch {
		categoryOrder = null;
	}
	return {
		id: r.id,
		name: r.name,
		position: r.position,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		kind: r.kind ?? 'grocery',
		kindChangedAt: r.kind_changed_at ?? null,
		categoryOrder
	};
}

function toCategory(r: CategoryRow): Category {
	return {
		id: r.id,
		name: r.name,
		position: r.position,
		createdAt: r.created_at,
		updatedAt: r.updated_at
	};
}

function toProductFields(
	p: ProductRow
): Omit<Product, 'purchaseCount' | 'completions' | 'firstCompletedAt'> {
	return {
		id: p.id,
		name: p.name,
		categoryId: p.category_id,
		favorite: p.favorite === 1,
		createdAt: p.created_at,
		updatedAt: p.updated_at,
		version: p.version,
		defaultQuantity: p.default_quantity,
		defaultUnit: p.default_unit,
		preferredListId: p.preferred_list_id,
		note: p.note,
		photoId: p.photo_id,
		stockStatus: p.stock_status ?? 'unknown',
		stockUpdatedAt: p.stock_updated_at
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

function toItem(r: ItemRow & { purchased_quantity?: number | null }): Item {
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
		version: r.version,
		note: r.note ?? null,
		substituteOk: r.substitute_ok === 1,
		substituteNote: r.substitute_note ?? null,
		unavailableAt: r.unavailable_at ?? null,
		position: r.position ?? 0,
		purchasedQuantity: r.purchased_quantity ?? null
	};
}
