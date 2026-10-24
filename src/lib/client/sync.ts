/**
 * Offline-first sync engine.
 *
 *   view = server snapshot  ⊕  pending operations (optimistic)
 *
 * Operations are persisted in IndexedDB before anything is sent, posted in order in batches,
 * and only forgotten once the server acknowledged them AND a snapshot containing their effect
 * arrived. Realtime updates arrive via SSE (`/api/events`) which only carries a sequence
 * number; the engine then pulls a fresh snapshot. See docs/SYNC.md.
 */

import type { Snapshot } from '$lib/shared/types';
import type { Op, OpPayload, OpResult, OpsResponse } from '$lib/shared/ops';
import { UNDOABLE_TYPES } from '$lib/shared/ops';
import { applyOps, restoreHintFor, type LocalOp, type RestoreHint } from '$lib/shared/reducer';
import type { PendingRecord } from './idb';
import { uuid } from './id';

export type Connection = 'connecting' | 'online' | 'offline';

export interface SyncIssue {
	id: string;
	at: number;
	opType: string;
	kind: 'rejected' | 'conflict';
	message: string;
}

export interface SyncStatus {
	connection: Connection;
	syncing: boolean;
	pending: number;
	lastSyncAt: number | null;
	/** True once data (cached or fresh) is available. */
	ready: boolean;
}

export interface Storage {
	kvGet<T>(key: string): Promise<T | undefined>;
	kvSet(key: string, value: unknown): Promise<void>;
	pendingAll<T>(): Promise<PendingRecord<T>[]>;
	pendingPut(records: PendingRecord[]): Promise<void>;
	pendingDelete(ids: string[]): Promise<void>;
}

export interface EngineDeps {
	fetch: typeof fetch;
	storage: Storage;
	EventSource?: typeof EventSource;
	now?: () => number;
	baseUrl?: string;
	/** Request timeout; VPN outages often hang instead of failing fast. */
	timeoutMs?: number;
}

export type UndoOutcome = 'cancelled' | 'queued' | 'unavailable';

const BATCH = 100;
const WATCHDOG_MS = 50_000;

export class SyncEngine {
	server: Snapshot | null = null;
	view: Snapshot | null = null;
	queue: PendingRecord<LocalOp>[] = [];
	aliases = new Map<string, string>();
	issues: SyncIssue[] = [];
	status: SyncStatus = {
		connection: 'connecting',
		syncing: false,
		pending: 0,
		lastSyncAt: null,
		ready: false
	};
	clientId = '';
	/** serverTime - localTime, measured on every snapshot. */
	clockOffset = 0;

	/** Called after every state change (view, status or issues). */
	onChange: () => void = () => {};
	/** Called when another device replaced the whole dataset (restore/import). */
	onDatasetReplaced: () => void = () => {};
	/** Called for every acknowledged op that the user should hear about. */
	onResult: (op: LocalOp, result: OpResult) => void = () => {};

	private deps: Required<Omit<EngineDeps, 'EventSource'>> & { EventSource?: typeof EventSource };
	private localSeq = 0;
	private inflight = new Set<string>();
	private results = new Map<string, OpResult>();
	private undoHints = new Map<string, RestoreHint>();
	private flushing: Promise<void> | null = null;
	private refreshing: Promise<void> | null = null;
	private refreshAgain = false;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private attempts = 0;
	private es: EventSource | null = null;
	private esRetry: ReturnType<typeof setTimeout> | null = null;
	private lastEventAt = 0;
	private watchdog: ReturnType<typeof setInterval> | null = null;
	private stopped = false;

	constructor(deps: EngineDeps) {
		this.deps = {
			now: () => Date.now(),
			baseUrl: '',
			timeoutMs: 10_000,
			...deps
		};
	}

	// ------------------------------------------------------------ lifecycle

	async load(): Promise<void> {
		const { storage } = this.deps;
		try {
			this.clientId = (await storage.kvGet<string>('clientId')) ?? '';
			if (!this.clientId) {
				this.clientId = uuid();
				await storage.kvSet('clientId', this.clientId);
			}
			this.server = (await storage.kvGet<Snapshot>('snapshot')) ?? null;
			this.clockOffset = (await storage.kvGet<number>('clockOffset')) ?? 0;
			this.status.lastSyncAt = (await storage.kvGet<number>('lastSyncAt')) ?? null;
			this.aliases = new Map((await storage.kvGet<[string, string][]>('aliases')) ?? []);
			this.issues = (await storage.kvGet<SyncIssue[]>('issues')) ?? [];
			this.queue = await storage.pendingAll<LocalOp>();
			this.localSeq = this.queue.reduce((m, r) => Math.max(m, r.seq), 0);
		} catch (e) {
			console.warn('[sync] local storage unavailable, continuing in memory', e);
			if (!this.clientId) this.clientId = uuid();
		}
		this.recompute();
	}

	async start(): Promise<void> {
		this.stopped = false;
		await this.load();
		this.connectEvents();
		await this.refresh();
		void this.flush();
	}

	stop() {
		this.stopped = true;
		this.es?.close();
		this.es = null;
		for (const t of [this.retryTimer, this.flushTimer, this.esRetry]) if (t) clearTimeout(t);
		if (this.watchdog) clearInterval(this.watchdog);
	}

	/** Call when the browser reports connectivity or the page becomes visible. */
	nudge() {
		if (this.stopped) return;
		if (!this.es || this.es.readyState === 2) this.connectEvents();
		void this.refresh().then(() => this.flush());
	}

	/**
	 * Best-effort delivery when the page is being hidden or unloaded: IndexedDB already holds
	 * the queue, and the server dedupes by op id, so sending twice is harmless.
	 */
	flushOnExit() {
		const ops = this.queue.filter((r) => r.ackSeq === null && !this.inflight.has(r.id));
		if (!ops.length || this.status.connection === 'offline') return;
		try {
			void this.deps
				.fetch(this.deps.baseUrl + '/api/ops', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						clientId: this.clientId,
						ops: ops.slice(0, 50).map((r) => stripLocal(r.op))
					}),
					keepalive: true
				})
				.catch(() => {});
		} catch {
			/* ignore */
		}
	}

	/** Call when the browser reports it lost connectivity. */
	markOffline() {
		if (this.stopped) return;
		this.es?.close();
		this.es = null;
		this.setConnection('offline');
	}

	now(): number {
		return this.deps.now() + this.clockOffset;
	}

	// ------------------------------------------------------------ mutations

	/** Applies an operation optimistically and queues it durably for the server. */
	enqueue(payload: OpPayload, extra: { restore?: RestoreHint } = {}): LocalOp {
		const op = { id: uuid(), at: Math.round(this.now()), ...payload, ...extra } as LocalOp;
		if (UNDOABLE_TYPES.has(op.type) && this.view) {
			this.undoHints.set(op.id, restoreHintFor(this.view, op, this.aliases));
		}
		const record: PendingRecord<LocalOp> = { id: op.id, seq: ++this.localSeq, op, ackSeq: null };
		this.queue = [...this.queue, record];
		this.recompute();
		void this.deps.storage
			.pendingPut([record])
			.catch((e) => console.warn('[sync] persist failed', e));
		this.scheduleFlush();
		return op;
	}

	/** Undo a previously enqueued op. Cancels it locally when it never left the device. */
	undo(opId: string): UndoOutcome {
		const record = this.queue.find((r) => r.id === opId);
		if (record && record.ackSeq === null && !this.inflight.has(opId)) {
			this.queue = this.queue.filter((r) => r !== record);
			void this.deps.storage.pendingDelete([opId]);
			this.recompute();
			return 'cancelled';
		}
		const result = this.results.get(opId);
		if (result && (result.status !== 'applied' || !result.undoable)) return 'unavailable';
		const restore = this.undoHints.get(opId);
		this.enqueue({ type: 'undo', targetOpId: opId }, restore ? { restore } : {});
		return 'queued';
	}

	dismissIssue(id: string) {
		this.issues = this.issues.filter((i) => i.id !== id);
		void this.deps.storage.kvSet('issues', this.issues);
		this.emit();
	}

	clearIssues() {
		this.issues = [];
		void this.deps.storage.kvSet('issues', this.issues);
		this.emit();
	}

	// ------------------------------------------------------------ network

	private scheduleFlush() {
		if (this.flushTimer) return;
		// Tiny delay batches rapid consecutive entries into one request.
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, 30);
	}

	private async request(path: string, init?: RequestInit): Promise<Response> {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), this.deps.timeoutMs);
		try {
			return await this.deps.fetch(this.deps.baseUrl + path, { ...init, signal: ctrl.signal });
		} finally {
			clearTimeout(timer);
		}
	}

	private setConnection(c: Connection) {
		if (this.status.connection === c) return;
		this.status.connection = c;
		this.emit();
	}

	async refresh(): Promise<void> {
		if (this.refreshing) {
			this.refreshAgain = true;
			return this.refreshing;
		}
		this.refreshing = (async () => {
			do {
				this.refreshAgain = false;
				try {
					const started = this.deps.now();
					const res = await this.request('/api/snapshot', { cache: 'no-store' });
					if (!res.ok) throw new Error('HTTP ' + res.status);
					const snap = (await res.json()) as Snapshot;
					const rtt = this.deps.now() - started;
					this.clockOffset = snap.serverTime + rtt / 2 - this.deps.now();
					this.applySnapshot(snap);
				} catch (e) {
					this.onNetworkError(e);
					return;
				}
			} while (this.refreshAgain);
		})().finally(() => (this.refreshing = null));
		return this.refreshing;
	}

	private applySnapshot(snap: Snapshot) {
		// Refreshes are serialised, so a lower seq is never a stale response: it means the server
		// database was restored from a backup. Accept it and drop overlays of acknowledged ops from
		// the discarded timeline; ops that never reached the server stay queued and are resent.
		const replaced =
			this.server !== null &&
			!!this.server.epoch &&
			!!snap.epoch &&
			snap.epoch !== this.server.epoch;
		const rolledBack = replaced || (this.server !== null && snap.seq < this.server.seq);
		if (replaced) this.onDatasetReplaced();
		if (rolledBack) {
			console.warn('[sync] server data was restored or replaced; resyncing');
			this.aliases.clear();
			void this.deps.storage.kvSet('aliases', []);
		}
		this.server = snap;
		const dropped = this.queue.filter(
			(r) => r.ackSeq !== null && (rolledBack || r.ackSeq <= snap.seq)
		);
		if (dropped.length) {
			this.queue = this.queue.filter((r) => !dropped.includes(r));
			void this.deps.storage.pendingDelete(dropped.map((r) => r.id));
		}
		this.status.lastSyncAt = this.deps.now();
		this.attempts = 0;
		this.setConnection('online');
		this.recompute();
		const { storage } = this.deps;
		void Promise.all([
			storage.kvSet('snapshot', snap),
			storage.kvSet('clockOffset', this.clockOffset),
			storage.kvSet('lastSyncAt', this.status.lastSyncAt)
		]).catch((e) => console.warn('[sync] cache failed', e));
	}

	async flush(): Promise<void> {
		if (this.flushing) return this.flushing;
		this.flushing = (async () => {
			while (!this.stopped) {
				const batch = this.queue.filter((r) => r.ackSeq === null).slice(0, BATCH);
				if (!batch.length) break;
				this.status.syncing = true;
				this.emit();
				for (const r of batch) this.inflight.add(r.id);
				let response: OpsResponse;
				try {
					const res = await this.request('/api/ops', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							clientId: this.clientId,
							// `restore` is a local-only hint; strip it from the wire format.
							ops: batch.map((r) => stripLocal(r.op))
						})
					});
					if (res.status >= 500 || res.status === 408 || res.status === 429) {
						throw new Error('HTTP ' + res.status);
					}
					if (!res.ok) {
						// The whole batch was malformed. Surface it instead of retrying forever.
						const text = await res.text().catch(() => '');
						for (const r of batch) {
							this.handleResult(
								r,
								{
									opId: r.id,
									status: 'rejected',
									reason: 'bad_request',
									message: 'Wijziging geweigerd door de server: ' + (text || res.status)
								},
								0
							);
						}
						continue;
					}
					response = (await res.json()) as OpsResponse;
				} catch (e) {
					this.onNetworkError(e);
					break;
				} finally {
					for (const r of batch) this.inflight.delete(r.id);
				}
				const byId = new Map(response.results.map((x) => [x.opId, x]));
				for (const r of batch) {
					const result = byId.get(r.id) ?? {
						opId: r.id,
						status: 'rejected' as const,
						reason: 'missing',
						message: 'Geen antwoord van de server voor deze wijziging.'
					};
					this.handleResult(r, result, response.seq);
				}
				await this.deps.storage
					.pendingPut(this.queue.filter((r) => batch.some((b) => b.id === r.id)))
					.catch(() => {});
				this.attempts = 0;
				this.setConnection('online');
				this.recompute();
				if (!this.server || response.seq > this.server.seq) await this.refresh();
			}
			this.status.syncing = false;
			this.emit();
		})().finally(() => (this.flushing = null));
		return this.flushing;
	}

	private handleResult(record: PendingRecord<LocalOp>, result: OpResult, seq: number) {
		this.results.set(record.id, result);
		if (this.results.size > 500) this.results.delete(this.results.keys().next().value as string);
		const op = record.op;

		// Remember canonical ids when the server merged our entity into an existing one.
		const localItem = 'itemId' in op ? op.itemId : null;
		if (localItem && result.itemId && result.itemId !== localItem)
			this.addAlias(localItem, result.itemId);
		const localProduct = op.type === 'item.add' ? op.productId : null;
		if (localProduct && result.productId && result.productId !== localProduct)
			this.addAlias(localProduct, result.productId);

		if (result.status === 'rejected') {
			this.queue = this.queue.filter((r) => r !== record);
			void this.deps.storage.pendingDelete([record.id]);
			this.addIssue(op, 'rejected', result.message ?? 'Wijziging kon niet worden verwerkt.');
		} else {
			record.ackSeq = seq;
			if (result.conflicts?.length && result.message) this.addIssue(op, 'conflict', result.message);
		}
		this.onResult(op, result);
	}

	private addAlias(from: string, to: string) {
		this.aliases.set(from, to);
		if (this.aliases.size > 1000) this.aliases.delete(this.aliases.keys().next().value as string);
		void this.deps.storage.kvSet('aliases', [...this.aliases]);
	}

	private addIssue(op: Op, kind: SyncIssue['kind'], message: string) {
		this.issues = [
			{ id: op.id, at: this.deps.now(), opType: op.type, kind, message },
			...this.issues.filter((i) => i.id !== op.id)
		].slice(0, 50);
		void this.deps.storage.kvSet('issues', this.issues);
	}

	private onNetworkError(e: unknown) {
		if (this.stopped) return;
		console.info('[sync] offline:', (e as Error)?.message ?? e);
		this.setConnection('offline');
		this.scheduleRetry();
	}

	private scheduleRetry() {
		if (this.retryTimer || this.stopped) return;
		const delay = Math.min(30_000, 1000 * 2 ** this.attempts) * (0.8 + Math.random() * 0.4);
		this.attempts = Math.min(this.attempts + 1, 6);
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			void this.refresh().then(() => this.flush());
		}, delay);
	}

	private connectEvents() {
		const ES = this.deps.EventSource;
		if (!ES || this.stopped) return;
		this.es?.close();
		const es = new ES(this.deps.baseUrl + '/api/events');
		this.es = es;
		this.lastEventAt = this.deps.now();
		const onSeq = (ev: MessageEvent) => {
			this.lastEventAt = this.deps.now();
			try {
				const { seq } = JSON.parse(ev.data) as { seq: number };
				if (!this.server || seq !== this.server.seq) void this.refresh();
			} catch {
				/* ignore malformed */
			}
		};
		es.addEventListener('hello', (ev) => {
			onSeq(ev as MessageEvent);
			this.setConnection('online');
			void this.flush();
		});
		es.addEventListener('change', (ev) => onSeq(ev as MessageEvent));
		es.onmessage = () => (this.lastEventAt = this.deps.now());
		es.onerror = () => {
			if (es !== this.es) return;
			this.setConnection('offline');
			if (es.readyState === 2) {
				// The browser gave up; reconnect ourselves with backoff.
				if (this.esRetry) clearTimeout(this.esRetry);
				this.esRetry = setTimeout(() => this.connectEvents(), 3000);
			}
		};
		if (!this.watchdog) {
			// Detect silently dead connections (e.g. VPN dropped without closing sockets).
			this.watchdog = setInterval(() => {
				if (this.stopped || !this.es) return;
				if (this.deps.now() - this.lastEventAt > WATCHDOG_MS) {
					this.setConnection('offline');
					this.connectEvents();
				}
			}, 15_000);
		}
	}

	// ------------------------------------------------------------ derived state

	private recompute() {
		if (this.server) {
			this.view = applyOps(
				this.server,
				this.queue.map((r) => r.op),
				this.aliases
			);
		}
		this.status.pending = this.queue.filter((r) => r.ackSeq === null).length;
		this.status.ready = this.view !== null;
		this.emit();
	}

	private emit() {
		this.onChange();
	}
}

function stripLocal(op: LocalOp): Op {
	if (!('restore' in op)) return op;
	const copy = { ...op } as LocalOp;
	delete copy.restore;
	return copy;
}
