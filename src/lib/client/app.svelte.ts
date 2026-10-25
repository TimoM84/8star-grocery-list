/**
 * Reactive application state for the UI. Wraps the SyncEngine and exposes user actions with
 * Dutch feedback (toasts with undo). Every mutation is an explicit intent: entering something
 * that is already on the list never changes it silently, it opens a choice instead.
 */

import type {
	AiRecommendation,
	Bundle,
	Claim,
	Item,
	List,
	ListKind,
	Product,
	Round,
	Snapshot,
	SortMode,
	StockStatus
} from '$lib/shared/types';
import type {
	AddManyEntry,
	BundleLineInput,
	ItemChanges,
	OpPayload,
	OpResult,
	ProductChanges
} from '$lib/shared/ops';
import type { LocalOp } from '$lib/shared/reducer';
import { SyncEngine, type SyncIssue, type SyncStatus } from './sync';
import * as idb from './idb';
import { uuid } from './id';
import { toasts } from './toast.svelte';
import { ui } from './ui.svelte';
import { preparePhoto, PhotoError } from './image';
import { formatQuantity, parseEntry } from '$lib/shared/quantity';
import { cleanName, MAX_NOTE_LENGTH, nameKey } from '$lib/shared/text';
import { guessCategory } from '$lib/shared/categorize';
import {
	activeCount,
	productViews,
	suggestions as suggestionsFor,
	type ProductView
} from '$lib/shared/selectors';
import {
	planEntry,
	productsForList,
	targetListFor,
	type EntryInput,
	type EntryPlan
} from '$lib/shared/planning';
import { DAY } from '$lib/shared/stats';

const LS = {
	list: '8star.list',
	sort: '8star.sort',
	group: '8star.groupByCategory',
	completedOpen: '8star.completedOpen',
	/** v1.1 kept "Niet nu" per device; migrated to shared snoozes on first start. */
	snoozed: '8star.snoozed',
	deviceId: '8star.deviceId',
	deviceName: '8star.deviceName',
	wakeLock: '8star.wakeLock',
	shareRound: '8star.shareRound',
	shopping: '8star.shopping'
};

/** Presence heartbeat while in winkelstand. */
const HEARTBEAT_MS = 60_000;

function lsGet<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

function lsSet(key: string, value: unknown) {
	try {
		if (value === undefined) localStorage.removeItem(key);
		else localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* private mode / quota: preference just isn't remembered */
	}
}

function haptic() {
	try {
		navigator.vibrate?.(8);
	} catch {
		/* unsupported */
	}
}

function cleanNote(note: string | null | undefined): string | null {
	const n = (note ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LENGTH);
	return n || null;
}

export type AddOutcome =
	{ kind: 'empty' } | { kind: 'prompt' } | { kind: 'added' | 'reactivated'; itemId: string };

/** Data for the "Staat er al op" / "Staat op een andere lijst" sheet. */
export interface AddPromptData {
	listId: string;
	entry: EntryInput;
}

export interface ShoppingSession {
	listId: string;
	enteredAt: number;
	/** Shared round this device joined, `null` when sharing is off or for checklists. */
	roundId: string | null;
}

class AppState {
	view = $state.raw<Snapshot | null>(null);
	status = $state.raw<SyncStatus>({
		connection: 'connecting',
		syncing: false,
		pending: 0,
		pendingMedia: 0,
		serverNewer: false,
		lastSyncAt: null,
		ready: false
	});
	issues = $state.raw<SyncIssue[]>([]);

	selectedListId = $state('default');
	sort = $state<SortMode>('newest');
	groupByCategory = $state(false);
	completedOpen = $state(true);
	/** Ticks every minute so relative dates and suggestions stay fresh. */
	now = $state(Date.now());
	/** Item to briefly highlight (e.g. after a duplicate add). */
	highlightId = $state<string | null>(null);

	/** Stable, local-only device id (no account). */
	deviceId = $state('');
	/** Optional name shown to others in a shared round ("Timo doet boodschappen"). */
	deviceName = $state<string | null>(null);
	/** Keep the screen on during winkelstand. */
	wakeLockEnabled = $state(true);
	/** Join the shared round when entering winkelstand. */
	shareRound = $state(true);
	shopping = $state<ShoppingSession | null>(null);

	engine: SyncEngine | null = null;
	private started = false;
	private snoozesMigrated = false;
	private photoUrls = new Map<string, string>();

	lists = $derived<List[]>(this.view?.lists ?? []);
	currentList = $derived<List | null>(
		this.lists.find((l) => l.id === this.selectedListId) ?? this.lists[0] ?? null
	);
	listId = $derived(this.currentList?.id ?? 'default');
	isChecklist = $derived(this.currentList?.kind === 'checklist');
	groceryLists = $derived(this.lists.filter((l) => l.kind !== 'checklist'));
	activeCount = $derived(this.view ? activeCount(this.view, this.listId) : 0);
	products = $derived<ProductView[]>(
		this.view ? productViews(this.view, this.listId, this.now) : []
	);
	/** Products that belong to the current list for suggestions (see planning.productsForList). */
	listScope = $derived<Set<string>>(
		this.view ? productsForList(this.view, this.listId) : new Set()
	);
	snoozed = $derived<Record<string, number>>(
		Object.fromEntries((this.view?.snoozes ?? []).map((s) => [s.productId, s.until]))
	);
	suggestions = $derived<ProductView[]>(
		suggestionsFor(
			this.products.filter((v) => this.listScope.has(v.product.id)),
			this.snoozed,
			this.now
		)
	);
	/** Household-wide switch (Beheer → Functies): off hides every AI feature, data is kept. */
	aiEnabled = $derived(this.view?.settings.aiEnabled ?? true);
	/** Open recommendations imported from an external AI tool (separate from local predictions). */
	aiRecommendations = $derived<AiRecommendation[]>(this.view?.aiRecommendations ?? []);
	bundles = $derived<Bundle[]>(this.view?.bundles ?? []);
	/** Active shared round on the current list. */
	round = $derived<Round | null>(this.view?.rounds.find((r) => r.listId === this.listId) ?? null);
	claims = $derived<Map<string, Claim>>(
		new Map(
			(this.view?.claims ?? []).filter((c) => c.expiresAt > this.now).map((c) => [c.itemId, c])
		)
	);
	inShopping = $derived(!!this.shopping && this.shopping.listId === this.listId);

	start() {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;
		this.selectedListId = lsGet(LS.list, 'default');
		this.sort = lsGet<SortMode>(LS.sort, 'newest');
		if (!['newest', 'oldest', 'az'].includes(this.sort)) this.sort = 'newest';
		this.groupByCategory = lsGet(LS.group, false);
		this.completedOpen = lsGet(LS.completedOpen, true);
		this.deviceId = lsGet<string>(LS.deviceId, '');
		if (!this.deviceId) {
			this.deviceId = uuid();
			lsSet(LS.deviceId, this.deviceId);
		}
		this.deviceName = lsGet<string | null>(LS.deviceName, null);
		this.wakeLockEnabled = lsGet(LS.wakeLock, true);
		this.shareRound = lsGet(LS.shareRound, true);
		this.shopping = lsGet<ShoppingSession | null>(LS.shopping, null);

		const engine = new SyncEngine({
			fetch: window.fetch.bind(window),
			storage: idb,
			EventSource: window.EventSource
		});
		engine.onChange = () => {
			this.view = engine.view;
			this.status = { ...engine.status };
			this.issues = engine.issues;
			if (engine.status.ready) this.migrateLocalSnoozes();
		};
		engine.onResult = (op, result) => this.onResult(op, result);
		engine.onDatasetReplaced = () =>
			toasts.show(
				'De gegevens zijn vervangen door een import of herstel. Je lijst is bijgewerkt.',
				{
					kind: 'warn',
					duration: 7000
				}
			);
		this.engine = engine;
		void engine.start();

		window.addEventListener('online', () => engine.nudge());
		window.addEventListener('offline', () => engine.markOffline());
		window.addEventListener('pagehide', () => engine.flushOnExit());
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') engine.flushOnExit();
			if (document.visibilityState === 'visible') {
				this.now = Date.now();
				engine.nudge();
				this.heartbeat();
			}
		});
		setInterval(() => (this.now = Date.now()), 60_000);
		setInterval(() => this.heartbeat(), HEARTBEAT_MS);
	}

	private onResult(op: LocalOp, result: OpResult) {
		if (op.type === 'round.join' && result.roundId && this.shopping?.roundId === op.roundId) {
			// Another device started the round first: we joined theirs.
			this.setShopping({ ...this.shopping, roundId: result.roundId });
		}
		if (result.status === 'rejected') {
			toasts.show(result.message ?? 'Wijziging kon niet worden verwerkt.', {
				kind: 'error',
				duration: 6000
			});
		} else if (result.status === 'noop' && result.message && op.type === 'item.claim') {
			toasts.show(result.message, { kind: 'info' });
		} else if (result.conflicts?.length && result.message) {
			toasts.show(result.message, { kind: 'warn', duration: 6000 });
		}
	}

	private run(payload: OpPayload): LocalOp | null {
		if (!this.engine) return null;
		return this.engine.enqueue(payload);
	}

	private undoable(
		op: LocalOp | null,
		message: string,
		secondary?: { label: string; run: () => void }
	) {
		if (!op) return;
		toasts.show(message, {
			kind: 'success',
			secondary,
			action: {
				label: 'Ongedaan maken',
				run: () => {
					const outcome = this.engine?.undo(op.id);
					if (outcome === 'unavailable')
						toasts.show('Ongedaan maken is niet meer mogelijk.', { kind: 'warn' });
					else toasts.dismiss();
				}
			}
		});
	}

	// --------------------------------------------------------------- preferences

	setSort(mode: SortMode) {
		this.sort = mode;
		lsSet(LS.sort, mode);
	}

	setGroupByCategory(on: boolean) {
		this.groupByCategory = on;
		lsSet(LS.group, on);
	}

	setCompletedOpen(open: boolean) {
		this.completedOpen = open;
		lsSet(LS.completedOpen, open);
	}

	selectList(id: string) {
		this.selectedListId = id;
		lsSet(LS.list, id);
	}

	setDeviceName(name: string) {
		const clean = cleanName(name).slice(0, 40) || null;
		this.deviceName = clean;
		lsSet(LS.deviceName, clean);
	}

	setWakeLock(on: boolean) {
		this.wakeLockEnabled = on;
		lsSet(LS.wakeLock, on);
	}

	setShareRound(on: boolean) {
		this.shareRound = on;
		lsSet(LS.shareRound, on);
	}

	/** Shared with every device; synced like any other change. */
	setAiEnabled(on: boolean) {
		if (on === this.aiEnabled) return;
		this.run({ type: 'settings.update', aiEnabled: on });
		toasts.show(
			on
				? 'AI-functies staan aan op alle apparaten'
				: 'AI-functies verborgen op alle apparaten. Er is niets verwijderd.'
		);
	}

	// --------------------------------------------------------------- lookups

	product(id: string): Product | undefined {
		return this.view?.products.find((p) => p.id === id);
	}

	item(id: string): Item | undefined {
		return this.view?.items.find((i) => i.id === id);
	}

	list(id: string): List | undefined {
		return this.lists.find((l) => l.id === id);
	}

	itemFor(productId: string, listId = this.listId): Item | undefined {
		return this.view?.items.find((i) => i.productId === productId && i.listId === listId);
	}

	aliasesFor(productId: string) {
		return (this.view?.aliases ?? []).filter((a) => a.productId === productId);
	}

	/** Image URL for a photo id; uses the local copy while it is still waiting to upload. */
	photoUrl(mediaId: string | null): string | null {
		if (!mediaId) return null;
		const pending = this.engine?.pendingPhoto(mediaId);
		if (pending) {
			let url = this.photoUrls.get(mediaId);
			if (!url) {
				url = URL.createObjectURL(pending.blob);
				this.photoUrls.set(mediaId, url);
			}
			return url;
		}
		return `/api/media/${encodeURIComponent(mediaId)}`;
	}

	photoPending(mediaId: string | null): 'waiting' | 'failed' | null {
		if (!mediaId) return null;
		void this.status.pendingMedia; // re-evaluate when the upload queue changes
		const pending = this.engine?.pendingPhoto(mediaId);
		if (!pending) return null;
		return pending.error ? 'failed' : 'waiting';
	}

	// --------------------------------------------------------------- adding

	/** Adds a typed entry ("2 kg aardappelen") or a product name to a list. */
	add(text: string, listId = this.listId): AddOutcome {
		const parsed = parseEntry(text);
		return this.addEntry(
			{ name: parsed.name, quantity: parsed.quantity, unit: parsed.unit },
			listId
		);
	}

	/** One-tap add of a known product (suggestions, favourites, history, stock). */
	addProduct(product: Product, listId = this.listId): AddOutcome {
		return this.addEntry({ name: product.name, quantity: null, unit: null }, listId);
	}

	/**
	 * Common path for every single add (typed, autocomplete, suggestion, stock). Opens a choice
	 * when the product is already on this list or active on another list.
	 */
	addEntry(entry: EntryInput, listId = this.listId, opts: { force?: boolean } = {}): AddOutcome {
		if (!this.view) return { kind: 'empty' };
		const plan = planEntry(this.view, listId, entry);
		if (!plan) return { kind: 'empty' };
		if (plan.state === 'active' || (plan.elsewhere.length && !opts.force)) {
			if (plan.item && plan.state === 'active') this.highlight(plan.item.id);
			ui.openSheet('add-prompt', { listId, entry } satisfies AddPromptData);
			return { kind: 'prompt' };
		}
		return this.commitAdd(plan, listId);
	}

	/** Puts a planned entry on the list (new or back from ticked). */
	commitAdd(plan: EntryPlan, listId: string): AddOutcome {
		let op: LocalOp | null;
		let itemId: string;
		const existing = plan.item;
		if (existing && plan.state === 'reactivate') {
			itemId = existing.id;
			op = this.run({ type: 'item.reactivate', itemId });
			if (plan.quantity !== existing.quantity || plan.unit !== existing.unit)
				this.run({
					type: 'item.update',
					itemId,
					changes: { quantity: plan.quantity, unit: plan.unit },
					base: { quantity: existing.quantity, unit: existing.unit }
				});
		} else if (!existing) {
			itemId = uuid();
			op = this.run({
				type: 'item.add',
				itemId,
				productId: plan.product?.id ?? uuid(),
				listId,
				name: plan.name,
				quantity: plan.quantity,
				unit: plan.unit,
				categoryId: plan.product ? null : guessCategory(plan.name)
			});
		} else {
			return { kind: 'prompt' };
		}
		haptic();
		const usual =
			!plan.explicit && plan.quantity !== null && plan.product?.defaultQuantity != null
				? formatQuantity(plan.quantity, plan.unit)
				: '';
		const label = usual ? `“${plan.name}” (${usual})` : `“${plan.name}”`;
		if (listId !== this.listId) {
			this.undoable(op, `${label} toegevoegd aan ${this.list(listId)?.name ?? 'lijst'}`);
		} else if (existing) {
			this.undoable(op, `${label} staat weer op de lijst`);
		} else if (usual) {
			this.undoable(op, `${label} toegevoegd met het gebruikelijke aantal`);
		}
		this.highlight(itemId);
		return { kind: existing ? 'reactivated' : 'added', itemId };
	}

	/** "1 extra": atomic server-side increment, so two devices adding at once both count. */
	addExtra(item: Item, delta: number, unit: string | null) {
		const name = this.product(item.productId)?.name ?? 'Item';
		haptic();
		const op = this.run({ type: 'item.increment', itemId: item.id, delta, unit });
		this.highlight(item.id);
		this.undoable(op, `“${name}”: ${formatQuantity(delta, unit)} extra`);
	}

	/** "Wijzigen naar …": explicit new quantity. */
	setQuantity(item: Item, quantity: number | null, unit: string | null) {
		const name = this.product(item.productId)?.name ?? 'Item';
		const op = this.run({
			type: 'item.update',
			itemId: item.id,
			changes: { quantity, unit },
			base: { quantity: item.quantity, unit: item.unit }
		});
		this.highlight(item.id);
		this.undoable(
			op,
			`“${name}” gewijzigd naar ${formatQuantity(quantity, unit) || 'geen aantal'}`
		);
	}

	highlight(itemId: string) {
		this.highlightId = itemId;
		setTimeout(() => {
			if (this.highlightId === itemId) this.highlightId = null;
		}, 1300);
	}

	/**
	 * Adds several entries at once (bulk paste, bundle, share). One op: either everything is
	 * applied or nothing is (no half-applied adds).
	 */
	addMany(listId: string, entries: Omit<AddManyEntry, 'itemId' | 'productId'>[]): boolean {
		const view = this.view;
		if (!entries.length || !view) return false;
		const full: AddManyEntry[] = entries.map((e) => {
			const plan = planEntry(view, listId, e);
			return {
				...e,
				note: cleanNote(e.note),
				// Always a fresh id: an existing item is matched by product, never by id.
				itemId: uuid(),
				productId: plan?.product?.id ?? uuid(),
				categoryId: plan?.product ? null : (e.categoryId ?? guessCategory(e.name))
			};
		});
		const count = { add: 0, extra: 0, set: 0 };
		for (const e of full) count[e.action] += 1;
		haptic();
		const op = this.run({ type: 'items.addMany', listId, entries: full });
		const parts = [
			count.add ? `${count.add} toegevoegd` : '',
			count.extra ? `${count.extra} verhoogd` : '',
			count.set ? `${count.set} aangepast` : ''
		].filter(Boolean);
		this.undoable(op, `${this.list(listId)?.name ?? 'Lijst'}: ${parts.join(', ')}`);
		return true;
	}

	// --------------------------------------------------------------- items

	toggle(item: Item) {
		const product = this.product(item.productId);
		const name = product?.name ?? 'Item';
		haptic();
		if (item.status === 'active') {
			const op = this.run({ type: 'item.complete', itemId: item.id });
			const list = this.list(item.listId);
			// Offer (never apply) stock "genoeg" after buying something marked low/out.
			const offerStock =
				list?.kind !== 'checklist' &&
				product &&
				(product.stockStatus === 'low' || product.stockStatus === 'out');
			this.undoable(
				op,
				`“${name}” afgevinkt`,
				offerStock
					? { label: 'Voorraad op genoeg', run: () => this.setStock(product, 'enough') }
					: undefined
			);
		} else {
			const op = this.run({ type: 'item.reactivate', itemId: item.id });
			this.undoable(op, `“${name}” staat weer op de lijst`);
		}
	}

	updateItem(item: Item, changes: ItemChanges) {
		const effective: ItemChanges = {};
		const base: ItemChanges = {};
		const put = <K extends keyof ItemChanges>(
			key: K,
			value: ItemChanges[K],
			current: ItemChanges[K]
		) => {
			if (value !== current) {
				effective[key] = value;
				base[key] = current;
			}
		};
		if ('quantity' in changes) put('quantity', changes.quantity, item.quantity);
		if ('unit' in changes) put('unit', changes.unit, item.unit);
		if ('note' in changes) put('note', cleanNote(changes.note), item.note);
		if ('substituteOk' in changes) put('substituteOk', !!changes.substituteOk, item.substituteOk);
		if ('substituteNote' in changes)
			put('substituteNote', cleanNote(changes.substituteNote), item.substituteNote);
		if (!Object.keys(effective).length) return;
		this.run({ type: 'item.update', itemId: item.id, changes: effective, base });
	}

	/** "Deels gehaald": records what was bought, the rest stays on the list. */
	purchasePartial(item: Item, quantity: number) {
		const name = this.product(item.productId)?.name ?? 'Item';
		if (item.quantity === null || quantity <= 0) return;
		if (quantity >= item.quantity) {
			this.toggle(item);
			return;
		}
		haptic();
		const op = this.run({
			type: 'item.purchasePartial',
			itemId: item.id,
			quantity,
			unit: item.unit
		});
		const left = Math.round((item.quantity - quantity) * 1000) / 1000;
		this.undoable(
			op,
			`“${name}”: ${formatQuantity(quantity, item.unit)} gehaald, ${formatQuantity(left, item.unit)} blijft op de lijst`
		);
	}

	setUnavailable(item: Item, unavailable: boolean) {
		const name = this.product(item.productId)?.name ?? 'Item';
		const op = this.run({ type: 'item.setUnavailable', itemId: item.id, unavailable });
		this.undoable(
			op,
			unavailable ? `“${name}” niet verkrijgbaar: blijft nodig` : `“${name}” weer te halen`
		);
	}

	retryUnavailable(listId = this.listId) {
		const op = this.run({ type: 'list.retryUnavailable', listId });
		this.undoable(op, 'Niet verkrijgbare producten staan weer bij te halen');
	}

	claim(item: Item) {
		this.run({
			type: 'item.claim',
			itemId: item.id,
			deviceId: this.deviceId,
			deviceName: this.deviceName
		});
	}

	release(item: Item) {
		this.run({ type: 'item.release', itemId: item.id, deviceId: this.deviceId });
	}

	deleteItem(item: Item) {
		const name = this.product(item.productId)?.name ?? 'Item';
		const op = this.run({ type: 'item.delete', itemId: item.id });
		this.undoable(op, `“${name}” verwijderd`);
	}

	moveItem(item: Item, toListId: string) {
		const name = this.product(item.productId)?.name ?? 'Item';
		const list = this.list(toListId);
		const op = this.run({ type: 'item.move', itemId: item.id, toListId });
		this.undoable(op, `“${name}” verplaatst naar ${list?.name ?? 'andere lijst'}`);
	}

	reorderItems(listId: string, itemIds: string[]) {
		this.run({ type: 'item.reorder', listId, itemIds });
	}

	clearCompleted(listId = this.listId) {
		const op = this.run({ type: 'list.clearCompleted', listId });
		this.undoable(op, 'Afgevinkte items gewist');
	}

	// --------------------------------------------------------------- products

	updateProduct(product: Product, changes: ProductChanges) {
		const effective: ProductChanges = {};
		const base: ProductChanges = {};
		if (changes.name !== undefined) {
			const name = cleanName(changes.name);
			if (!name) return false;
			if (name !== product.name) {
				const key = nameKey(name);
				const clash =
					this.view?.products.some((p) => p.id !== product.id && nameKey(p.name) === key) ||
					this.view?.aliases.some((a) => a.productId !== product.id && nameKey(a.alias) === key);
				if (clash) {
					toasts.show(`De naam “${name}” is al in gebruik.`, { kind: 'error' });
					return false;
				}
				effective.name = name;
				base.name = product.name;
			}
		}
		const fields = [
			'categoryId',
			'favorite',
			'defaultQuantity',
			'defaultUnit',
			'preferredListId'
		] as const;
		for (const f of fields) {
			if (changes[f] !== undefined && changes[f] !== product[f]) {
				(effective as Record<string, unknown>)[f] = changes[f];
				(base as Record<string, unknown>)[f] = product[f];
			}
		}
		if (changes.note !== undefined) {
			const note = cleanNote(changes.note);
			if (note !== product.note) {
				effective.note = note;
				base.note = product.note;
			}
		}
		if (!Object.keys(effective).length) return true;
		this.run({ type: 'product.update', productId: product.id, changes: effective, base });
		return true;
	}

	toggleFavorite(product: Product) {
		this.updateProduct(product, { favorite: !product.favorite });
		toasts.show(
			product.favorite ? `“${product.name}” is geen favoriet meer` : `“${product.name}” is favoriet`
		);
	}

	deleteProduct(product: Product) {
		const op = this.run({ type: 'product.delete', productId: product.id });
		this.undoable(op, `“${product.name}” en de geschiedenis verwijderd`);
	}

	/** Manual "andere naam": maps to the same product id. Never merges two products. */
	addAlias(product: Product, alias: string): boolean {
		const clean = cleanName(alias);
		if (!clean) return false;
		const key = nameKey(clean);
		const byName = this.view?.products.find((p) => nameKey(p.name) === key);
		const byAlias = this.view?.aliases.find((a) => nameKey(a.alias) === key);
		if (byName || byAlias) {
			const owner = byName ?? (byAlias ? this.product(byAlias.productId) : undefined);
			toasts.show(
				owner?.id === product.id
					? `“${clean}” hoort al bij dit product.`
					: `“${clean}” is al in gebruik voor “${owner?.name ?? 'een ander product'}”. Producten worden nooit automatisch samengevoegd.`,
				{ kind: 'error', duration: 6000 }
			);
			return false;
		}
		this.run({ type: 'alias.add', aliasId: uuid(), productId: product.id, alias: clean });
		return true;
	}

	removeAlias(aliasId: string) {
		const op = this.run({ type: 'alias.remove', aliasId });
		this.undoable(op, 'Andere naam verwijderd');
	}

	setStock(product: Product, status: StockStatus) {
		if (product.stockStatus === status) return;
		const labels: Record<StockStatus, string> = {
			unknown: 'onbekend',
			enough: 'genoeg',
			low: 'bijna op',
			out: 'op'
		};
		const op = this.run({ type: 'product.setStock', productId: product.id, status });
		this.undoable(op, `Voorraad “${product.name}”: ${labels[status]}`);
	}

	async setPhoto(product: Product, file: Blob): Promise<boolean> {
		if (!this.engine) return false;
		let blob: Blob;
		try {
			blob = await preparePhoto(file);
		} catch (e) {
			toasts.show(e instanceof PhotoError ? e.message : 'Foto toevoegen is mislukt.', {
				kind: 'error'
			});
			return false;
		}
		const mediaId = uuid();
		await this.engine.queueMedia(mediaId, blob);
		const op = this.run({ type: 'product.setPhoto', productId: product.id, mediaId });
		this.undoable(
			op,
			this.status.connection === 'online'
				? `Foto bij “${product.name}” opgeslagen`
				: `Foto bij “${product.name}” bewaard; wordt gedeeld zodra er verbinding is`
		);
		return true;
	}

	removePhoto(product: Product) {
		const op = this.run({ type: 'product.setPhoto', productId: product.id, mediaId: null });
		this.undoable(op, `Foto bij “${product.name}” verwijderd`);
	}

	/** "Niet nu": shared between devices, until a clear end time. */
	snooze(product: ProductView | Product, days?: number) {
		const p = 'product' in product ? product.product : product;
		const avg = 'stats' in product ? product.stats.avgIntervalDays : null;
		const span = days ?? Math.min(14, Math.max(1, Math.round((avg ?? 2) / 2)));
		const until = Date.now() + span * DAY;
		const op = this.run({ type: 'product.snooze', productId: p.id, until });
		const when = new Date(until).toLocaleDateString('nl-NL', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		});
		this.undoable(op, `“${p.name}” niet voorstellen tot ${when}`);
	}

	unsnooze(product: Product) {
		this.run({ type: 'product.snooze', productId: product.id, until: 0 });
	}

	/** One-time move of v1.1 per-device snoozes into the shared store. */
	private migrateLocalSnoozes() {
		if (this.snoozesMigrated || !this.view) return;
		this.snoozesMigrated = true;
		const local = lsGet<Record<string, number>>(LS.snoozed, {});
		const now = Date.now();
		for (const [productId, until] of Object.entries(local)) {
			if (until <= now || !this.product(productId)) continue;
			if ((this.snoozed[productId] ?? 0) >= until) continue;
			this.run({ type: 'product.snooze', productId, until });
		}
		lsSet(LS.snoozed, undefined);
	}

	// --------------------------------------------------------------- bundles

	saveBundle(
		bundleId: string | null,
		name: string,
		servings: number | null,
		lines: { name: string; quantity: number | null; unit: string | null; note: string | null }[]
	): string | null {
		const clean = cleanName(name);
		const view = this.view;
		if (!clean || !view) return null;
		const id = bundleId ?? uuid();
		if (this.bundles.some((b) => b.id !== id && nameKey(b.name) === nameKey(clean))) {
			toasts.show(`Er bestaat al een bundel “${clean}”.`, { kind: 'error' });
			return null;
		}
		const existing = this.bundles.find((b) => b.id === id);
		const input: BundleLineInput[] = lines
			.filter((l) => cleanName(l.name))
			.map((l, i) => {
				const product = planEntry(view, this.listId, {
					name: l.name,
					quantity: null,
					unit: null
				})?.product;
				return {
					lineId: existing?.lines[i]?.id ?? uuid(),
					productId: product?.id ?? uuid(),
					name: product?.name ?? cleanName(l.name),
					quantity: l.quantity,
					unit: l.unit,
					note: cleanNote(l.note)
				};
			});
		this.run({ type: 'bundle.save', bundleId: id, name: clean, servings, lines: input });
		toasts.show(`Bundel “${clean}” opgeslagen`, { kind: 'success' });
		return id;
	}

	copyBundle(bundle: Bundle): string | null {
		let name = `${bundle.name} (kopie)`;
		for (let n = 2; this.bundles.some((b) => nameKey(b.name) === nameKey(name)); n++)
			name = `${bundle.name} (kopie ${n})`;
		return this.saveBundle(
			null,
			name,
			bundle.servings,
			bundle.lines.map((l) => ({
				name: this.product(l.productId)?.name ?? '',
				quantity: l.quantity,
				unit: l.unit,
				note: l.note
			}))
		);
	}

	deleteBundle(bundle: Bundle) {
		const op = this.run({ type: 'bundle.delete', bundleId: bundle.id });
		this.undoable(op, `Bundel “${bundle.name}” verwijderd (producten en geschiedenis blijven)`);
	}

	// --------------------------------------------------------------- winkelstand & rounds

	private setShopping(s: ShoppingSession | null) {
		this.shopping = s;
		lsSet(LS.shopping, s ?? undefined);
	}

	enterShopping(listId = this.listId) {
		const list = this.list(listId);
		if (!list) return;
		let roundId: string | null = null;
		if (this.shareRound && list.kind === 'grocery') {
			const existing = this.view?.rounds.find((r) => r.listId === listId);
			roundId = existing?.id ?? uuid();
			this.run({
				type: 'round.join',
				roundId,
				listId,
				deviceId: this.deviceId,
				deviceName: this.deviceName
			});
		}
		this.setShopping({ listId, enteredAt: Date.now(), roundId });
		this.heartbeat();
	}

	/** Leaves winkelstand. Ticks nothing; the round ends when the last participant leaves. */
	exitShopping() {
		const s = this.shopping;
		if (!s) return;
		if (s.roundId && this.view?.rounds.some((r) => r.id === s.roundId))
			this.run({ type: 'round.leave', roundId: s.roundId, deviceId: this.deviceId });
		this.setShopping(null);
	}

	/** Ends the shared round for everyone. Nothing is booked or ticked. */
	endRound(round: Round) {
		this.run({ type: 'round.end', roundId: round.id, deviceId: this.deviceId });
		if (this.shopping?.roundId === round.id) this.setShopping(null);
		toasts.show('Winkelronde beëindigd. Er is niets afgevinkt of geboekt.');
	}

	private heartbeat() {
		const s = this.shopping;
		if (!s?.roundId || document.visibilityState !== 'visible') return;
		if (this.status.connection !== 'online') return;
		void fetch('/api/presence', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ roundId: s.roundId, deviceId: this.deviceId })
		}).catch(() => {
			/* offline: presence simply goes stale */
		});
	}

	// --------------------------------------------------------------- lists & categories

	createList(name: string, kind: ListKind = 'grocery'): string | null {
		const clean = cleanName(name);
		if (!clean) return null;
		if (this.lists.some((l) => nameKey(l.name) === nameKey(clean))) {
			toasts.show(`Er bestaat al een lijst “${clean}”.`, { kind: 'error' });
			return null;
		}
		const listId = uuid();
		this.run({ type: 'list.create', listId, name: clean, kind });
		return listId;
	}

	renameList(list: List, name: string) {
		const clean = cleanName(name);
		if (!clean || clean === list.name) return;
		if (this.lists.some((l) => l.id !== list.id && nameKey(l.name) === nameKey(clean))) {
			toasts.show(`Er bestaat al een lijst “${clean}”.`, { kind: 'error' });
			return;
		}
		this.run({ type: 'list.rename', listId: list.id, name: clean });
	}

	setListKind(list: List, kind: ListKind) {
		if (list.kind === kind) return;
		if (this.shopping?.listId === list.id) this.exitShopping();
		const op = this.run({ type: 'list.setKind', listId: list.id, kind });
		this.undoable(
			op,
			kind === 'checklist'
				? `“${list.name}” is nu een checklist. Afvinken telt niet meer als aankoop; de geschiedenis blijft bewaard.`
				: `“${list.name}” is nu een boodschappenlijst. Afvinken telt vanaf nu als aankoop.`
		);
	}

	setCategoryOrder(list: List, categoryIds: string[] | null) {
		this.run({ type: 'list.setCategoryOrder', listId: list.id, categoryIds });
	}

	/** "Opnieuw klaarzetten": ticked checklist items back to "Nog te doen". */
	resetChecklist(list: List, itemIds: string[]) {
		if (!itemIds.length) return;
		const op = this.run({ type: 'list.resetChecklist', listId: list.id, itemIds });
		this.undoable(
			op,
			`${itemIds.length === 1 ? '1 taak' : `${itemIds.length} taken`} opnieuw klaargezet`
		);
	}

	deleteList(list: List) {
		if (this.lists.length <= 1) return;
		if (this.shopping?.listId === list.id) this.exitShopping();
		this.run({ type: 'list.delete', listId: list.id });
		if (this.listId === list.id) {
			const next = this.lists.find((l) => l.id !== list.id);
			if (next) this.selectList(next.id);
		}
		toasts.show(`Lijst “${list.name}” verwijderd`);
	}

	moveListBy(list: List, delta: number) {
		const ids = this.lists.map((l) => l.id);
		const idx = ids.indexOf(list.id);
		const target = idx + delta;
		if (idx < 0 || target < 0 || target >= ids.length) return;
		[ids[idx], ids[target]] = [ids[target], ids[idx]];
		this.run({ type: 'list.reorder', listIds: ids });
	}

	createCategory(name: string) {
		const clean = cleanName(name);
		if (!clean) return;
		if (this.view?.categories.some((c) => nameKey(c.name) === nameKey(clean))) {
			toasts.show(`Er bestaat al een categorie “${clean}”.`, { kind: 'error' });
			return;
		}
		this.run({ type: 'category.create', categoryId: uuid(), name: clean });
	}

	renameCategory(id: string, name: string) {
		const clean = cleanName(name);
		const cat = this.view?.categories.find((c) => c.id === id);
		if (!clean || !cat || cat.name === clean) return;
		if (this.view?.categories.some((c) => c.id !== id && nameKey(c.name) === nameKey(clean))) {
			toasts.show(`Er bestaat al een categorie “${clean}”.`, { kind: 'error' });
			return;
		}
		this.run({ type: 'category.rename', categoryId: id, name: clean });
	}

	deleteCategory(id: string) {
		const cat = this.view?.categories.find((c) => c.id === id);
		this.run({ type: 'category.delete', categoryId: id });
		if (cat) toasts.show(`Categorie “${cat.name}” verwijderd`);
	}

	moveCategoryBy(id: string, delta: number) {
		const ids = (this.view?.categories ?? []).map((c) => c.id);
		const idx = ids.indexOf(id);
		const target = idx + delta;
		if (idx < 0 || target < 0 || target >= ids.length) return;
		[ids[idx], ids[target]] = [ids[target], ids[idx]];
		this.run({ type: 'category.reorder', categoryIds: ids });
	}

	// --------------------------------------------------------------- AI & stock suggestions

	acceptRecommendation(rec: AiRecommendation) {
		const product = this.product(rec.productId);
		const item = product ? this.itemFor(product.id) : undefined;
		haptic();
		const op = this.run({
			type: 'ai.accept',
			recommendationId: rec.id,
			listId: this.listId,
			itemId: uuid()
		});
		this.undoable(
			op,
			item?.status === 'active'
				? `“${product?.name}” stond al op de lijst — suggestie afgerond`
				: `“${product?.name ?? 'Product'}” op de lijst gezet`
		);
	}

	dismissRecommendation(rec: AiRecommendation) {
		const op = this.run({ type: 'ai.dismiss', recommendationId: rec.id });
		this.undoable(
			op,
			`AI-suggestie voor “${this.product(rec.productId)?.name ?? 'product'}” genegeerd`
		);
	}

	/** List a stock/suggestion product should go to by default. */
	targetList(product: Product): string {
		return this.view ? targetListFor(this.view, product, this.listId) : this.listId;
	}

	/** Sends queued changes first; resolves true when nothing is waiting anymore. */
	async flushPending(): Promise<boolean> {
		if (!this.engine) return false;
		await this.engine.flush();
		return this.engine.status.pending === 0;
	}

	syncNow() {
		this.engine?.nudge();
	}
}

export const app = new AppState();
