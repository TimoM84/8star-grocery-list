/**
 * Optimistic client-side application of operations to a snapshot. Mirrors the server
 * semantics closely enough for instant UI feedback; the server stays authoritative and its
 * next snapshot replaces whatever we predicted here.
 *
 * Every case is idempotent: applying an op to a snapshot that already contains its effect
 * changes nothing. That makes rebasing (snapshot + still-pending ops) safe. Intent ops that
 * are not naturally idempotent (+extra, partial purchase) are never rebased onto a snapshot
 * that already contains them: the engine drops acknowledged ops once a snapshot with a
 * sequence number at or above their acknowledgement arrives.
 */

import type {
	AiRecommendation,
	Bundle,
	Item,
	List,
	Product,
	ProductAlias,
	Snapshot,
	Snooze
} from './types';
import type { AddManyEntry, Op } from './ops';
import { capitaliseFirst, cleanName, compareNl, nameKey } from './text';
import { convertQuantity, roundQuantity } from './quantity';
import { normaliseSettings } from './settings';

/** Local before-images used to optimistically undo an op that the server already applied. */
export interface RestoreHint {
	items: Record<string, Item | null>;
	products: Record<string, Product | null>;
	recommendations?: Record<string, AiRecommendation | null>;
	lists?: Record<string, List | null>;
	bundles?: Record<string, Bundle | null>;
	aliases?: Record<string, ProductAlias | null>;
	snoozes?: Record<string, Snooze | null>;
}

export type LocalOp = Op & { restore?: RestoreHint };

export type Aliases = ReadonlyMap<string, string>;

/** Same window as the server (NOTE_KEEP_MS): an item note survives a quick re-tick. */
const NOTE_KEEP_MS = 6 * 60 * 60 * 1000;
const CLAIM_TTL_MS = 20 * 60 * 1000;

export function newList(id: string, name: string, at: number, position = 0): List {
	return {
		id,
		name,
		position,
		createdAt: at,
		updatedAt: at,
		kind: 'grocery',
		kindChangedAt: null,
		categoryOrder: null
	};
}

export function newProduct(id: string, name: string, at: number): Product {
	return {
		id,
		name,
		categoryId: null,
		favorite: false,
		createdAt: at,
		updatedAt: at,
		version: 1,
		purchaseCount: 0,
		completions: [],
		firstCompletedAt: null,
		defaultQuantity: null,
		defaultUnit: null,
		preferredListId: null,
		note: null,
		photoId: null,
		stockStatus: 'unknown',
		stockUpdatedAt: null
	};
}

export function newItem(id: string, listId: string, productId: string, at: number): Item {
	return {
		id,
		listId,
		productId,
		quantity: null,
		unit: null,
		status: 'active',
		activatedAt: at,
		completedAt: null,
		createdAt: at,
		updatedAt: at,
		version: 1,
		note: null,
		substituteOk: false,
		substituteNote: null,
		unavailableAt: null,
		position: at,
		purchasedQuantity: null
	};
}

/**
 * Deep copy that also fills fields missing from snapshots cached by older app versions
 * (v1.0.0 had no recommendations, v1.1.0 none of the v1.2 additions).
 */
export function cloneSnapshot(s: Snapshot): Snapshot {
	return {
		seq: s.seq,
		epoch: s.epoch,
		serverTime: s.serverTime,
		protocol: s.protocol,
		lists: s.lists.map((l) => ({
			...newList(l.id, l.name, l.createdAt),
			...l,
			categoryOrder: l.categoryOrder ? [...l.categoryOrder] : null
		})),
		categories: s.categories.map((c) => ({ ...c })),
		products: s.products.map((p) => ({
			...newProduct(p.id, p.name, p.createdAt),
			...p,
			completions: [...p.completions]
		})),
		items: s.items.map((i) => ({
			...newItem(i.id, i.listId, i.productId, i.activatedAt),
			...i
		})),
		aiRecommendations: (s.aiRecommendations ?? []).map((r) => ({ ...r })),
		aliases: (s.aliases ?? []).map((a) => ({ ...a })),
		bundles: (s.bundles ?? []).map((b) => ({ ...b, lines: b.lines.map((l) => ({ ...l })) })),
		snoozes: (s.snoozes ?? []).map((x) => ({ ...x })),
		rounds: (s.rounds ?? []).map((r) => ({
			...r,
			participants: r.participants.map((p) => ({ ...p }))
		})),
		claims: (s.claims ?? []).map((c) => ({ ...c })),
		settings: normaliseSettings(s.settings)
	};
}

export function applyOps(
	base: Snapshot,
	ops: readonly LocalOp[],
	aliases: Aliases = new Map()
): Snapshot {
	const s = cloneSnapshot(base);
	for (const op of ops) applyOp(s, op, aliases);
	return s;
}

function resolve(aliases: Aliases, id: string) {
	return aliases.get(id) ?? id;
}

function nextPosition(arr: { position: number }[]) {
	return arr.reduce((m, x) => Math.max(m, x.position), -1) + 1;
}

function reorder<T extends { id: string; position: number }>(arr: T[], ids: string[]) {
	const wanted = ids.filter((id, i) => ids.indexOf(id) === i && arr.some((x) => x.id === id));
	const sorted = [...arr].sort((a, b) => a.position - b.position);
	const order = [...wanted, ...sorted.map((x) => x.id).filter((id) => !wanted.includes(id))];
	for (const x of arr) x.position = order.indexOf(x.id);
	arr.sort((a, b) => a.position - b.position);
}

/** Product for a typed name: exact name first, then a manual alias. */
export function findProductForName(s: Snapshot, name: string): Product | undefined {
	const key = nameKey(name);
	const direct = s.products.find((p) => nameKey(p.name) === key);
	if (direct) return direct;
	const alias = s.aliases.find((a) => nameKey(a.alias) === key);
	return alias ? s.products.find((p) => p.id === alias.productId) : undefined;
}

function ensureProduct(
	s: Snapshot,
	rawName: string,
	productId: string,
	categoryId: string | null,
	at: number
): Product {
	const name = capitaliseFirst(cleanName(rawName));
	let product = findProductForName(s, name);
	if (!product) {
		product = newProduct(productId, name, at);
		product.categoryId =
			categoryId && s.categories.some((c) => c.id === categoryId) ? categoryId : null;
		s.products.push(product);
		s.products.sort((a, b) => compareNl(a.name, b.name));
	}
	return product;
}

function listKind(s: Snapshot, listId: string) {
	return s.lists.find((l) => l.id === listId)?.kind ?? 'grocery';
}

function itemPosition(s: Snapshot, listId: string) {
	return s.items.reduce((m, i) => (i.listId === listId ? Math.max(m, i.position) : m), 0) + 1;
}

function reactivateLocal(
	item: Item,
	at: number,
	change: { quantity: number | null; unit: string | null; note?: string | null } | null
) {
	const when = Math.max(at, item.completedAt ?? 0);
	const fresh = when - (item.completedAt ?? 0) > NOTE_KEEP_MS;
	if (change && change.quantity !== null) {
		item.quantity = change.quantity;
		item.unit = change.unit;
	}
	item.note = change?.note ? change.note : fresh ? null : item.note;
	if (fresh) {
		item.substituteOk = false;
		item.substituteNote = null;
	}
	item.status = 'active';
	item.activatedAt = when;
	item.completedAt = null;
	item.unavailableAt = null;
	item.purchasedQuantity = null;
}

function addEntry(
	s: Snapshot,
	listId: string,
	e: AddManyEntry,
	at: number,
	aliases: Aliases,
	bump: (i: Item) => void
) {
	if (s.items.some((i) => i.id === resolve(aliases, e.itemId))) return;
	const product = ensureProduct(s, e.name, e.productId, e.categoryId, at);
	const existing = s.items.find((i) => i.listId === listId && i.productId === product.id);
	if (!existing) {
		const item = newItem(e.itemId, listId, product.id, at);
		item.quantity = e.quantity;
		item.unit = e.unit;
		item.note = e.note;
		item.position = itemPosition(s, listId);
		s.items.push(item);
		return;
	}
	if (existing.status === 'completed') {
		reactivateLocal(existing, at, {
			quantity: e.quantity,
			unit: e.quantity !== null ? e.unit : existing.unit,
			note: e.note
		});
		bump(existing);
		return;
	}
	if (e.action === 'add') {
		if (e.note && !existing.note) existing.note = e.note;
		return;
	}
	if (e.action === 'extra') {
		if (existing.quantity === null || e.quantity === null) return;
		const d = convertQuantity(e.quantity, e.unit, existing.unit);
		if (d === null) return;
		existing.quantity = roundQuantity(existing.quantity + d);
	} else {
		existing.quantity = e.quantity;
		existing.unit = e.unit;
	}
	bump(existing);
}

/** Mutates `s` in place. */
export function applyOp(s: Snapshot, op: LocalOp, aliases: Aliases = new Map()): void {
	const at = op.at;
	const findItem = (id: string) => s.items.find((i) => i.id === resolve(aliases, id));
	const findProduct = (id: string) => s.products.find((p) => p.id === resolve(aliases, id));
	const bump = (i: Item) => {
		i.version += 1;
		i.updatedAt = at;
	};

	switch (op.type) {
		case 'list.create':
			if (!s.lists.some((l) => l.id === op.listId)) {
				const list = newList(
					op.listId,
					capitaliseFirst(cleanName(op.name)),
					at,
					nextPosition(s.lists)
				);
				list.kind = op.kind ?? 'grocery';
				s.lists.push(list);
			}
			return;
		case 'list.rename': {
			const l = s.lists.find((x) => x.id === op.listId);
			if (l) l.name = cleanName(op.name);
			return;
		}
		case 'list.delete':
			if (s.lists.length <= 1) return;
			s.lists = s.lists.filter((l) => l.id !== op.listId);
			s.items = s.items.filter((i) => i.listId !== op.listId);
			s.rounds = s.rounds.filter((r) => r.listId !== op.listId);
			return;
		case 'list.reorder':
			reorder(s.lists, op.listIds);
			return;
		case 'list.clearCompleted':
			s.items = s.items.filter((i) => !(i.listId === op.listId && i.status === 'completed'));
			return;
		case 'list.setKind': {
			const l = s.lists.find((x) => x.id === op.listId);
			if (!l || l.kind === op.kind) return;
			l.kind = op.kind;
			l.kindChangedAt = at;
			if (op.kind === 'checklist') {
				s.rounds = s.rounds.filter((r) => r.listId !== l.id);
				for (const i of s.items) if (i.listId === l.id) i.unavailableAt = null;
			}
			return;
		}
		case 'list.setCategoryOrder': {
			const l = s.lists.find((x) => x.id === op.listId);
			if (l) l.categoryOrder = op.categoryIds && op.categoryIds.length ? [...op.categoryIds] : null;
			return;
		}
		case 'list.resetChecklist':
			for (const id of op.itemIds) {
				const i = findItem(id);
				if (!i || i.listId !== op.listId || i.status !== 'completed') continue;
				i.status = 'active';
				i.activatedAt = Math.max(at, i.completedAt ?? 0);
				i.completedAt = null;
				bump(i);
			}
			return;
		case 'list.retryUnavailable':
			for (const i of s.items)
				if (i.listId === op.listId && i.unavailableAt !== null) {
					i.unavailableAt = null;
					bump(i);
				}
			return;
		case 'category.create':
			if (!s.categories.some((c) => c.id === op.categoryId))
				s.categories.push({
					id: op.categoryId,
					name: capitaliseFirst(cleanName(op.name)),
					position: nextPosition(s.categories),
					createdAt: at,
					updatedAt: at
				});
			return;
		case 'category.rename': {
			const c = s.categories.find((x) => x.id === op.categoryId);
			if (c) c.name = cleanName(op.name);
			return;
		}
		case 'category.delete':
			s.categories = s.categories.filter((c) => c.id !== op.categoryId);
			for (const p of s.products) if (p.categoryId === op.categoryId) p.categoryId = null;
			return;
		case 'category.reorder':
			reorder(s.categories, op.categoryIds);
			return;

		case 'item.add': {
			if (!s.lists.some((l) => l.id === op.listId)) return;
			// Already applied (the snapshot contains it, possibly under its canonical id).
			if (s.items.some((i) => i.id === resolve(aliases, op.itemId))) return;
			const product = ensureProduct(s, op.name, op.productId, op.categoryId, at);
			const existing = s.items.find((i) => i.listId === op.listId && i.productId === product.id);
			if (existing) {
				if (existing.status === 'active') return;
				reactivateLocal(existing, at, {
					quantity: op.quantity,
					unit: op.quantity !== null || op.unit !== null ? op.unit : existing.unit,
					note: op.note ?? null
				});
				bump(existing);
				return;
			}
			const item = newItem(op.itemId, op.listId, product.id, at);
			item.quantity = op.quantity;
			item.unit = op.unit;
			item.note = op.note ?? null;
			item.position = itemPosition(s, op.listId);
			s.items.push(item);
			return;
		}
		case 'items.addMany':
			if (!s.lists.some((l) => l.id === op.listId)) return;
			for (const e of op.entries) addEntry(s, op.listId, e, at, aliases, bump);
			return;
		case 'item.increment': {
			const item = findItem(op.itemId);
			if (!item || item.status !== 'active' || item.quantity === null) return;
			const d = convertQuantity(op.delta, op.unit, item.unit);
			if (d === null) return;
			item.quantity = roundQuantity(item.quantity + d);
			bump(item);
			return;
		}
		case 'item.purchasePartial': {
			const item = findItem(op.itemId);
			if (!item || item.status !== 'active' || item.quantity === null) return;
			const d = convertQuantity(op.quantity, op.unit, item.unit);
			if (d === null || d >= item.quantity) return;
			item.quantity = roundQuantity(item.quantity - d);
			item.purchasedQuantity = roundQuantity((item.purchasedQuantity ?? 0) + d);
			item.unavailableAt = null;
			bump(item);
			return;
		}
		case 'item.complete': {
			const item = findItem(op.itemId);
			if (!item || item.status === 'completed') return;
			const when = Math.max(at, item.activatedAt);
			item.status = 'completed';
			item.completedAt = when;
			item.unavailableAt = null;
			bump(item);
			s.claims = s.claims.filter((c) => c.itemId !== item.id);
			// Checklists never count as purchases.
			if (listKind(s, item.listId) !== 'grocery') return;
			const p = s.products.find((x) => x.id === item.productId);
			if (p) {
				p.completions = [...p.completions, when];
				p.purchaseCount += 1;
				p.firstCompletedAt ??= when;
			}
			return;
		}
		case 'item.reactivate': {
			const item = findItem(op.itemId);
			if (!item || item.status === 'active') return;
			reactivateLocal(item, at, null);
			bump(item);
			return;
		}
		case 'item.update': {
			const item = findItem(op.itemId);
			if (!item) return;
			const c = op.changes;
			if ('quantity' in c) item.quantity = c.quantity ?? null;
			if ('unit' in c) item.unit = c.unit ?? null;
			if ('note' in c) item.note = c.note ?? null;
			if ('substituteOk' in c) item.substituteOk = c.substituteOk ?? false;
			if ('substituteNote' in c) item.substituteNote = c.substituteNote ?? null;
			bump(item);
			return;
		}
		case 'item.setUnavailable': {
			const item = findItem(op.itemId);
			if (!item) return;
			if (op.unavailable && item.status !== 'active') return;
			item.unavailableAt = op.unavailable ? (item.unavailableAt ?? at) : null;
			if (op.unavailable) s.claims = s.claims.filter((c) => c.itemId !== item.id);
			bump(item);
			return;
		}
		case 'item.reorder': {
			const ids = op.itemIds.map((id) => resolve(aliases, id));
			const listItems = s.items
				.filter((i) => i.listId === op.listId)
				.sort((a, b) => a.position - b.position || a.activatedAt - b.activatedAt);
			const order = [
				...ids.filter((id, i) => ids.indexOf(id) === i && listItems.some((x) => x.id === id)),
				...listItems.map((x) => x.id).filter((id) => !ids.includes(id))
			];
			for (const i of listItems) i.position = order.indexOf(i.id) + 1;
			return;
		}
		case 'item.claim': {
			const item = findItem(op.itemId);
			if (!item || item.status !== 'active') return;
			const other = s.claims.find(
				(c) => c.itemId === item.id && c.deviceId !== op.deviceId && c.expiresAt > at
			);
			if (other) return;
			s.claims = s.claims.filter((c) => c.itemId !== item.id);
			s.claims.push({
				itemId: item.id,
				roundId: s.rounds.find((r) => r.listId === item.listId)?.id ?? null,
				deviceId: op.deviceId,
				deviceName: op.deviceName,
				claimedAt: at,
				expiresAt: at + CLAIM_TTL_MS
			});
			return;
		}
		case 'item.release': {
			const id = resolve(aliases, op.itemId);
			s.claims = s.claims.filter(
				(c) => !(c.itemId === id && (c.deviceId === op.deviceId || c.expiresAt <= at))
			);
			return;
		}
		case 'item.move': {
			const item = findItem(op.itemId);
			if (!item || item.listId === op.toListId) return;
			if (!s.lists.some((l) => l.id === op.toListId)) return;
			const other = s.items.find((i) => i.listId === op.toListId && i.productId === item.productId);
			if (other) {
				if (other.status === 'active' || item.status === 'completed') {
					s.items = s.items.filter((i) => i !== item);
					return;
				}
				s.items = s.items.filter((i) => i !== other);
			}
			item.position = itemPosition(s, op.toListId);
			item.listId = op.toListId;
			item.unavailableAt = null;
			s.claims = s.claims.filter((c) => c.itemId !== item.id);
			bump(item);
			return;
		}
		case 'item.delete': {
			const id = resolve(aliases, op.itemId);
			s.items = s.items.filter((i) => i.id !== id);
			s.claims = s.claims.filter((c) => c.itemId !== id);
			return;
		}
		case 'product.update': {
			const p = findProduct(op.productId);
			if (!p) return;
			const c = op.changes;
			if (c.name !== undefined) {
				const key = nameKey(c.name);
				if (!s.products.some((x) => x !== p && nameKey(x.name) === key)) {
					p.name = cleanName(c.name);
					s.products.sort((a, b) => compareNl(a.name, b.name));
				}
			}
			if (c.categoryId !== undefined) p.categoryId = c.categoryId;
			if (c.favorite !== undefined) p.favorite = c.favorite;
			if ('defaultQuantity' in c) p.defaultQuantity = c.defaultQuantity ?? null;
			if ('defaultUnit' in c) p.defaultUnit = c.defaultUnit ?? null;
			if (p.defaultQuantity === null) p.defaultUnit = null;
			if ('preferredListId' in c) p.preferredListId = c.preferredListId ?? null;
			if ('note' in c) p.note = c.note ?? null;
			p.version += 1;
			return;
		}
		case 'product.delete': {
			const id = resolve(aliases, op.productId);
			s.products = s.products.filter((p) => p.id !== id);
			const gone = new Set(s.items.filter((i) => i.productId === id).map((i) => i.id));
			s.items = s.items.filter((i) => i.productId !== id);
			s.claims = s.claims.filter((c) => !gone.has(c.itemId));
			s.aliases = s.aliases.filter((a) => a.productId !== id);
			s.snoozes = s.snoozes.filter((x) => x.productId !== id);
			for (const b of s.bundles) b.lines = b.lines.filter((l) => l.productId !== id);
			return;
		}
		case 'product.setStock': {
			const p = findProduct(op.productId);
			if (!p) return;
			p.stockStatus = op.status;
			p.stockUpdatedAt = at;
			p.version += 1;
			return;
		}
		case 'product.setPhoto': {
			const p = findProduct(op.productId);
			if (!p) return;
			p.photoId = op.mediaId;
			p.version += 1;
			return;
		}
		case 'product.snooze': {
			const id = resolve(aliases, op.productId);
			s.snoozes = s.snoozes.filter((x) => x.productId !== id);
			if (op.until > at) s.snoozes.push({ productId: id, until: op.until });
			return;
		}
		case 'alias.add': {
			if (s.aliases.some((a) => a.id === op.aliasId)) return;
			const p = findProduct(op.productId);
			const key = nameKey(op.alias);
			if (!p || findProductForName(s, op.alias)) return;
			if (s.aliases.some((a) => nameKey(a.alias) === key)) return;
			s.aliases.push({
				id: op.aliasId,
				productId: p.id,
				alias: cleanName(op.alias),
				createdAt: at
			});
			return;
		}
		case 'alias.remove':
			s.aliases = s.aliases.filter((a) => a.id !== op.aliasId);
			return;
		case 'bundle.save': {
			const lines = op.lines.map((l) => {
				const p = ensureProduct(s, l.name, l.productId, null, at);
				return {
					id: l.lineId,
					productId: p.id,
					quantity: l.quantity,
					unit: l.quantity === null ? null : l.unit,
					note: l.note
				};
			});
			const existing = s.bundles.find((b) => b.id === op.bundleId);
			const name = capitaliseFirst(cleanName(op.name));
			if (existing) {
				existing.name = name;
				existing.servings = op.servings;
				existing.lines = lines;
				existing.version += 1;
				existing.updatedAt = at;
			} else {
				s.bundles.push({
					id: op.bundleId,
					name,
					servings: op.servings,
					createdAt: at,
					updatedAt: at,
					version: 1,
					lines
				});
			}
			s.bundles.sort((a, b) => compareNl(a.name, b.name));
			return;
		}
		case 'bundle.delete':
			s.bundles = s.bundles.filter((b) => b.id !== op.bundleId);
			return;
		case 'round.join': {
			if (listKind(s, op.listId) !== 'grocery') return;
			let round =
				s.rounds.find((r) => r.listId === op.listId) ??
				s.rounds.find((r) => r.id === resolve(aliases, op.roundId));
			if (!round) {
				round = {
					id: op.roundId,
					listId: op.listId,
					startedAt: at,
					startedBy: op.deviceName,
					participants: []
				};
				s.rounds.push(round);
				for (const i of s.items) if (i.listId === op.listId) i.unavailableAt = null;
			}
			const me = round.participants.find((p) => p.deviceId === op.deviceId);
			if (me) {
				me.deviceName = op.deviceName;
				me.lastSeenAt = Math.max(me.lastSeenAt, at);
			} else
				round.participants.push({
					deviceId: op.deviceId,
					deviceName: op.deviceName,
					joinedAt: at,
					lastSeenAt: at
				});
			return;
		}
		case 'round.leave': {
			const round = s.rounds.find((r) => r.id === resolve(aliases, op.roundId));
			if (!round) return;
			round.participants = round.participants.filter((p) => p.deviceId !== op.deviceId);
			s.claims = s.claims.filter((c) => !(c.roundId === round.id && c.deviceId === op.deviceId));
			if (!round.participants.length) s.rounds = s.rounds.filter((r) => r !== round);
			return;
		}
		case 'round.end': {
			const id = resolve(aliases, op.roundId);
			s.rounds = s.rounds.filter((r) => r.id !== id);
			s.claims = s.claims.filter((c) => c.roundId !== id);
			return;
		}
		case 'ai.accept': {
			const rec = s.aiRecommendations.find((r) => r.id === op.recommendationId);
			if (!rec) return;
			s.aiRecommendations = s.aiRecommendations.filter((r) => r !== rec);
			const product = s.products.find((p) => p.id === rec.productId);
			if (!product) return;
			applyOp(
				s,
				{
					id: op.id,
					at: op.at,
					type: 'item.add',
					itemId: op.itemId,
					productId: product.id,
					listId: op.listId,
					name: product.name,
					quantity: rec.suggestedQuantity,
					unit: rec.suggestedQuantity === null ? null : rec.suggestedUnit,
					categoryId: null
				},
				aliases
			);
			return;
		}
		case 'ai.dismiss':
			s.aiRecommendations = s.aiRecommendations.filter((r) => r.id !== op.recommendationId);
			return;
		case 'settings.update':
			s.settings = {
				...s.settings,
				...(op.aiEnabled !== undefined && { aiEnabled: op.aiEnabled }),
				...(op.language !== undefined && { language: op.language })
			};
			return;
		case 'undo':
			if (op.restore) applyRestore(s, op.restore, aliases);
			return;
	}
}

function restoreInto<T extends { id: string }>(
	arr: T[],
	hint: Record<string, T | null> | undefined,
	copy: (x: T) => T
): T[] {
	if (!hint) return arr;
	let out = arr;
	for (const [id, before] of Object.entries(hint)) {
		out = out.filter((x) => x.id !== id);
		if (before) out.push(copy(before));
	}
	return out;
}

function applyRestore(s: Snapshot, hint: RestoreHint, aliases: Aliases) {
	s.aiRecommendations = restoreInto(s.aiRecommendations, hint.recommendations, (r) => ({ ...r }));
	s.lists = restoreInto(s.lists, hint.lists, (l) => ({ ...l })).sort(
		(a, b) => a.position - b.position
	);
	s.bundles = restoreInto(s.bundles, hint.bundles, (b) => ({
		...b,
		lines: b.lines.map((l) => ({ ...l }))
	}));
	s.aliases = restoreInto(s.aliases, hint.aliases, (a) => ({ ...a }));
	if (hint.snoozes) {
		for (const [productId, before] of Object.entries(hint.snoozes)) {
			s.snoozes = s.snoozes.filter((x) => x.productId !== productId);
			if (before) s.snoozes.push({ ...before });
		}
	}
	for (const [id, before] of Object.entries(hint.products)) {
		const idx = s.products.findIndex((p) => p.id === id);
		if (before === null) {
			const used = s.items.some(
				(i) => i.productId === id && !Object.prototype.hasOwnProperty.call(hint.items, i.id)
			);
			if (idx >= 0 && !used) s.products.splice(idx, 1);
		} else if (idx >= 0) s.products[idx] = { ...before, completions: [...before.completions] };
		else s.products.push({ ...before, completions: [...before.completions] });
	}
	s.products.sort((a, b) => compareNl(a.name, b.name));
	for (const [rawId, before] of Object.entries(hint.items)) {
		const id = resolve(aliases, rawId);
		const idx = s.items.findIndex((i) => i.id === id);
		if (before === null) {
			if (idx >= 0) s.items.splice(idx, 1);
		} else {
			const restored = { ...before, id };
			if (!s.lists.some((l) => l.id === restored.listId)) continue;
			if (!s.products.some((p) => p.id === restored.productId)) continue;
			if (idx >= 0) s.items[idx] = restored;
			else s.items.push(restored);
		}
	}
}

/** Builds before-images of the entities an op is about to touch (for optimistic undo). */
export function restoreHintFor(s: Snapshot, op: Op, aliases: Aliases = new Map()): RestoreHint {
	const hint: RestoreHint = { items: {}, products: {} };
	const item = (id: string) => {
		const rid = resolve(aliases, id);
		const found = s.items.find((i) => i.id === rid);
		hint.items[rid] = found ? { ...found } : null;
		return found;
	};
	const product = (id: string) => {
		const found = s.products.find((p) => p.id === id);
		hint.products[id] = found ? { ...found, completions: [...found.completions] } : null;
	};
	const byName = (listId: string, name: string, itemId: string, productId: string) => {
		const p = findProductForName(s, name);
		if (p) {
			product(p.id);
			const existing = s.items.find((i) => i.listId === listId && i.productId === p.id);
			if (existing) item(existing.id);
			else hint.items[itemId] = null;
		} else {
			hint.products[productId] = null;
			hint.items[itemId] = null;
		}
	};
	const list = (id: string) => {
		const found = s.lists.find((l) => l.id === id);
		hint.lists = { ...hint.lists, [id]: found ? { ...found } : null };
	};
	if (op.type === 'ai.accept' || op.type === 'ai.dismiss') {
		const rec = s.aiRecommendations.find((r) => r.id === op.recommendationId);
		hint.recommendations = { [op.recommendationId]: rec ? { ...rec } : null };
		const p = rec && s.products.find((x) => x.id === rec.productId);
		if (op.type === 'ai.accept' && p) byName(op.listId, p.name, op.itemId, p.id);
		return hint;
	}
	switch (op.type) {
		case 'item.add':
			byName(op.listId, op.name, op.itemId, op.productId);
			break;
		case 'items.addMany':
			for (const e of op.entries) byName(op.listId, e.name, e.itemId, e.productId);
			break;
		case 'item.complete':
		case 'item.reactivate':
		case 'item.update':
		case 'item.delete':
		case 'item.increment':
		case 'item.purchasePartial':
		case 'item.setUnavailable': {
			const i = item(op.itemId);
			if (i) product(i.productId);
			break;
		}
		case 'item.move': {
			const i = item(op.itemId);
			if (i) {
				const other = s.items.find((x) => x.listId === op.toListId && x.productId === i.productId);
				if (other) item(other.id);
			}
			break;
		}
		case 'item.reorder':
			for (const i of s.items) if (i.listId === op.listId) item(i.id);
			break;
		case 'list.clearCompleted':
			for (const i of s.items) if (i.listId === op.listId && i.status === 'completed') item(i.id);
			break;
		case 'list.resetChecklist':
		case 'list.retryUnavailable':
			for (const i of s.items) if (i.listId === op.listId) item(i.id);
			break;
		case 'list.setKind':
		case 'list.setCategoryOrder':
			list(op.listId);
			if (op.type === 'list.setKind')
				for (const i of s.items) if (i.listId === op.listId) item(i.id);
			break;
		case 'product.update':
		case 'product.setStock':
		case 'product.setPhoto':
			product(resolve(aliases, op.productId));
			break;
		case 'product.snooze': {
			const pid = resolve(aliases, op.productId);
			const found = s.snoozes.find((x) => x.productId === pid);
			hint.snoozes = { [pid]: found ? { ...found } : null };
			break;
		}
		case 'product.delete': {
			const pid = resolve(aliases, op.productId);
			product(pid);
			for (const i of s.items) if (i.productId === pid) item(i.id);
			hint.aliases = Object.fromEntries(
				s.aliases.filter((a) => a.productId === pid).map((a) => [a.id, { ...a }])
			);
			hint.bundles = Object.fromEntries(
				s.bundles
					.filter((b) => b.lines.some((l) => l.productId === pid))
					.map((b) => [b.id, { ...b, lines: b.lines.map((l) => ({ ...l })) }])
			);
			break;
		}
		case 'alias.add':
		case 'alias.remove': {
			const found = s.aliases.find((a) => a.id === op.aliasId);
			hint.aliases = { [op.aliasId]: found ? { ...found } : null };
			break;
		}
		case 'bundle.save':
		case 'bundle.delete': {
			const found = s.bundles.find((b) => b.id === op.bundleId);
			hint.bundles = {
				[op.bundleId]: found ? { ...found, lines: found.lines.map((l) => ({ ...l })) } : null
			};
			break;
		}
	}
	return hint;
}
