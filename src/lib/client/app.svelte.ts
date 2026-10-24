/**
 * Reactive application state for the UI. Wraps the SyncEngine and exposes user actions with
 * Dutch feedback (toasts with undo).
 */

import type { Item, List, Product, Snapshot, SortMode } from '$lib/shared/types';
import type { OpPayload, OpResult } from '$lib/shared/ops';
import type { LocalOp } from '$lib/shared/reducer';
import { SyncEngine, type SyncIssue, type SyncStatus } from './sync';
import * as idb from './idb';
import { uuid } from './id';
import { toasts } from './toast.svelte';
import { parseEntry } from '$lib/shared/quantity';
import { cleanName, nameKey } from '$lib/shared/text';
import { guessCategory } from '$lib/shared/categorize';
import {
	activeCount,
	productViews,
	suggestions as suggestionsFor,
	type ProductView
} from '$lib/shared/selectors';
import { DAY } from '$lib/shared/stats';

const LS = {
	list: '8star.list',
	sort: '8star.sort',
	group: '8star.groupByCategory',
	completedOpen: '8star.completedOpen',
	snoozed: '8star.snoozed'
};

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
		localStorage.setItem(key, JSON.stringify(value));
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

export type AddOutcome =
	| { kind: 'empty' }
	| { kind: 'duplicate'; itemId: string }
	| { kind: 'added' | 'reactivated'; itemId: string };

class AppState {
	view = $state.raw<Snapshot | null>(null);
	status = $state.raw<SyncStatus>({
		connection: 'connecting',
		syncing: false,
		pending: 0,
		lastSyncAt: null,
		ready: false
	});
	issues = $state.raw<SyncIssue[]>([]);

	selectedListId = $state('default');
	sort = $state<SortMode>('newest');
	groupByCategory = $state(false);
	completedOpen = $state(true);
	snoozed = $state<Record<string, number>>({});
	/** Ticks every minute so relative dates and suggestions stay fresh. */
	now = $state(Date.now());
	/** Item to briefly highlight (e.g. after a duplicate add). */
	highlightId = $state<string | null>(null);

	engine: SyncEngine | null = null;
	private started = false;

	lists = $derived<List[]>(this.view?.lists ?? []);
	currentList = $derived<List | null>(
		this.lists.find((l) => l.id === this.selectedListId) ?? this.lists[0] ?? null
	);
	listId = $derived(this.currentList?.id ?? 'default');
	activeCount = $derived(this.view ? activeCount(this.view, this.listId) : 0);
	products = $derived<ProductView[]>(
		this.view ? productViews(this.view, this.listId, this.now) : []
	);
	suggestions = $derived<ProductView[]>(suggestionsFor(this.products, this.snoozed, this.now));

	start() {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;
		this.selectedListId = lsGet(LS.list, 'default');
		this.sort = lsGet<SortMode>(LS.sort, 'newest');
		if (!['newest', 'oldest', 'az'].includes(this.sort)) this.sort = 'newest';
		this.groupByCategory = lsGet(LS.group, false);
		this.completedOpen = lsGet(LS.completedOpen, true);
		this.snoozed = lsGet(LS.snoozed, {});

		const engine = new SyncEngine({
			fetch: window.fetch.bind(window),
			storage: idb,
			EventSource: window.EventSource
		});
		engine.onChange = () => {
			this.view = engine.view;
			this.status = { ...engine.status };
			this.issues = engine.issues;
		};
		engine.onResult = (op, result) => this.onResult(op, result);
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
			}
		});
		setInterval(() => (this.now = Date.now()), 60_000);
	}

	private onResult(op: LocalOp, result: OpResult) {
		if (result.status === 'rejected') {
			toasts.show(result.message ?? 'Wijziging kon niet worden verwerkt.', {
				kind: 'error',
				duration: 6000
			});
		} else if (result.conflicts?.length && result.message) {
			toasts.show(result.message, { kind: 'warn', duration: 6000 });
		} else if (op.type === 'undo' && result.status === 'applied') {
			// Silent: the UI already shows the restored state.
		}
	}

	private run(payload: OpPayload): LocalOp | null {
		if (!this.engine) return null;
		return this.engine.enqueue(payload);
	}

	private undoable(op: LocalOp | null, message: string) {
		if (!op) return;
		toasts.show(message, {
			kind: 'success',
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

	snooze(product: ProductView) {
		const days = Math.max(1, (product.stats.avgIntervalDays ?? 2) / 2);
		this.snoozed = { ...this.snoozed, [product.product.id]: Date.now() + days * DAY };
		const now = Date.now();
		for (const [k, v] of Object.entries(this.snoozed)) if (v < now) delete this.snoozed[k];
		lsSet(LS.snoozed, this.snoozed);
	}

	// --------------------------------------------------------------- lookups

	product(id: string): Product | undefined {
		return this.view?.products.find((p) => p.id === id);
	}

	item(id: string): Item | undefined {
		return this.view?.items.find((i) => i.id === id);
	}

	itemFor(productId: string, listId = this.listId): Item | undefined {
		return this.view?.items.find((i) => i.productId === productId && i.listId === listId);
	}

	// --------------------------------------------------------------- items

	/** Adds a typed entry ("2 kg aardappelen") or a product name to the current list. */
	add(text: string, listId = this.listId): AddOutcome {
		const parsed = parseEntry(text);
		const name = cleanName(parsed.name);
		if (!name || !this.view) return { kind: 'empty' };
		const key = nameKey(name);
		const product = this.view.products.find((p) => nameKey(p.name) === key);
		const existing = product ? this.itemFor(product.id, listId) : undefined;

		if (existing && existing.status === 'active') {
			this.highlight(existing.id);
			const changes: { quantity?: number | null; unit?: string | null } = {};
			if (
				parsed.quantity !== null &&
				(parsed.quantity !== existing.quantity || parsed.unit !== existing.unit)
			) {
				changes.quantity = parsed.quantity;
				changes.unit = parsed.unit;
				this.run({
					type: 'item.update',
					itemId: existing.id,
					changes,
					base: { quantity: existing.quantity, unit: existing.unit }
				});
				toasts.show(`“${product!.name}” stond al op de lijst — aantal bijgewerkt.`);
			} else {
				toasts.show(`“${product!.name}” staat al op de lijst.`, { kind: 'info' });
			}
			return { kind: 'duplicate', itemId: existing.id };
		}

		const itemId = existing?.id ?? uuid();
		const op = this.run({
			type: 'item.add',
			itemId,
			productId: product?.id ?? uuid(),
			listId,
			name,
			quantity: parsed.quantity,
			unit: parsed.unit,
			categoryId: product ? null : guessCategory(name)
		});
		haptic();
		const label = product?.name ?? name.charAt(0).toLocaleUpperCase('nl') + name.slice(1);
		if (listId !== this.listId) {
			const listName = this.lists.find((l) => l.id === listId)?.name ?? 'lijst';
			this.undoable(op, `“${label}” toegevoegd aan ${listName}`);
		} else if (existing) {
			this.undoable(op, `“${label}” staat weer op de lijst`);
		}
		this.highlight(itemId);
		return { kind: existing ? 'reactivated' : 'added', itemId };
	}

	highlight(itemId: string) {
		this.highlightId = itemId;
		setTimeout(() => {
			if (this.highlightId === itemId) this.highlightId = null;
		}, 1300);
	}

	toggle(item: Item) {
		const name = this.product(item.productId)?.name ?? 'Item';
		haptic();
		if (item.status === 'active') {
			const op = this.run({ type: 'item.complete', itemId: item.id });
			this.undoable(op, `“${name}” afgevinkt`);
		} else {
			const op = this.run({ type: 'item.reactivate', itemId: item.id });
			this.undoable(op, `“${name}” staat weer op de lijst`);
		}
	}

	updateItem(item: Item, changes: { quantity?: number | null; unit?: string | null }) {
		const effective: typeof changes = {};
		const base: typeof changes = {};
		if ('quantity' in changes && changes.quantity !== item.quantity) {
			effective.quantity = changes.quantity;
			base.quantity = item.quantity;
		}
		if ('unit' in changes && changes.unit !== item.unit) {
			effective.unit = changes.unit;
			base.unit = item.unit;
		}
		if (!Object.keys(effective).length) return;
		this.run({ type: 'item.update', itemId: item.id, changes: effective, base });
	}

	updateProduct(
		product: Product,
		changes: { name?: string; categoryId?: string | null; favorite?: boolean }
	) {
		const effective: typeof changes = {};
		const base: typeof changes = {};
		if (changes.name !== undefined) {
			const name = cleanName(changes.name);
			if (!name) return false;
			if (name !== product.name) {
				const clash = this.view?.products.find(
					(p) => p.id !== product.id && nameKey(p.name) === nameKey(name)
				);
				if (clash) {
					toasts.show(`Er bestaat al een product “${clash.name}”.`, { kind: 'error' });
					return false;
				}
				effective.name = name;
				base.name = product.name;
			}
		}
		if (changes.categoryId !== undefined && changes.categoryId !== product.categoryId) {
			effective.categoryId = changes.categoryId;
			base.categoryId = product.categoryId;
		}
		if (changes.favorite !== undefined && changes.favorite !== product.favorite) {
			effective.favorite = changes.favorite;
			base.favorite = product.favorite;
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

	deleteItem(item: Item) {
		const name = this.product(item.productId)?.name ?? 'Item';
		const op = this.run({ type: 'item.delete', itemId: item.id });
		this.undoable(op, `“${name}” verwijderd`);
	}

	moveItem(item: Item, toListId: string) {
		const name = this.product(item.productId)?.name ?? 'Item';
		const list = this.lists.find((l) => l.id === toListId);
		const op = this.run({ type: 'item.move', itemId: item.id, toListId });
		this.undoable(op, `“${name}” verplaatst naar ${list?.name ?? 'andere lijst'}`);
	}

	clearCompleted(listId = this.listId) {
		const op = this.run({ type: 'list.clearCompleted', listId });
		this.undoable(op, 'Afgevinkte items gewist');
	}

	/** One-tap add of a known product (suggestions, favourites, history). */
	addProduct(product: Product, listId = this.listId) {
		const item = this.itemFor(product.id, listId);
		if (item?.status === 'active') {
			toasts.show(`“${product.name}” staat al op de lijst.`);
			return;
		}
		haptic();
		if (item) {
			const op = this.run({ type: 'item.reactivate', itemId: item.id });
			this.undoable(op, `“${product.name}” staat weer op de lijst`);
		} else {
			const op = this.run({
				type: 'item.add',
				itemId: uuid(),
				productId: product.id,
				listId,
				name: product.name,
				quantity: null,
				unit: null,
				categoryId: null
			});
			this.undoable(op, `“${product.name}” toegevoegd`);
		}
	}

	deleteProduct(product: Product) {
		const op = this.run({ type: 'product.delete', productId: product.id });
		this.undoable(op, `“${product.name}” en de geschiedenis verwijderd`);
	}

	// --------------------------------------------------------------- lists & categories

	createList(name: string): string | null {
		const clean = cleanName(name);
		if (!clean) return null;
		if (this.lists.some((l) => nameKey(l.name) === nameKey(clean))) {
			toasts.show(`Er bestaat al een lijst “${clean}”.`, { kind: 'error' });
			return null;
		}
		const listId = uuid();
		this.run({ type: 'list.create', listId, name: clean });
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

	deleteList(list: List) {
		if (this.lists.length <= 1) return;
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

	syncNow() {
		this.engine?.nudge();
	}
}

export const app = new AppState();
