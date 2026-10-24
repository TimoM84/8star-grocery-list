/**
 * Optimistic client-side application of operations to a snapshot. Mirrors the server
 * semantics closely enough for instant UI feedback; the server stays authoritative and its
 * next snapshot replaces whatever we predicted here.
 *
 * Every case is idempotent: applying an op to a snapshot that already contains its effect
 * changes nothing. That makes rebasing (snapshot + still-pending ops) safe.
 */

import type { Item, Product, Snapshot } from './types';
import type { Op } from './ops';
import { capitaliseFirst, cleanName, compareNl, nameKey } from './text';

/** Local before-images used to optimistically undo an op that the server already applied. */
export interface RestoreHint {
	items: Record<string, Item | null>;
	products: Record<string, Product | null>;
}

export type LocalOp = Op & { restore?: RestoreHint };

export type Aliases = ReadonlyMap<string, string>;

export function cloneSnapshot(s: Snapshot): Snapshot {
	return {
		seq: s.seq,
		serverTime: s.serverTime,
		lists: s.lists.map((l) => ({ ...l })),
		categories: s.categories.map((c) => ({ ...c })),
		products: s.products.map((p) => ({ ...p, completions: [...p.completions] })),
		items: s.items.map((i) => ({ ...i }))
	};
}

export function applyOps(
	base: Snapshot,
	ops: readonly LocalOp[],
	aliases: Aliases = new Map()
): Snapshot {
	if (!ops.length) return base;
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

/** Mutates `s` in place. */
export function applyOp(s: Snapshot, op: LocalOp, aliases: Aliases = new Map()): void {
	const at = op.at;
	const findItem = (id: string) => s.items.find((i) => i.id === resolve(aliases, id));
	const bump = (i: Item) => {
		i.version += 1;
		i.updatedAt = at;
	};

	switch (op.type) {
		case 'list.create':
			if (!s.lists.some((l) => l.id === op.listId))
				s.lists.push({
					id: op.listId,
					name: capitaliseFirst(cleanName(op.name)),
					position: nextPosition(s.lists),
					createdAt: at,
					updatedAt: at
				});
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
			return;
		case 'list.reorder':
			reorder(s.lists, op.listIds);
			return;
		case 'list.clearCompleted':
			s.items = s.items.filter((i) => !(i.listId === op.listId && i.status === 'completed'));
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
			const name = capitaliseFirst(cleanName(op.name));
			const key = nameKey(name);
			let product = s.products.find((p) => nameKey(p.name) === key);
			if (!product) {
				product = {
					id: op.productId,
					name,
					categoryId:
						op.categoryId && s.categories.some((c) => c.id === op.categoryId)
							? op.categoryId
							: null,
					favorite: false,
					createdAt: at,
					updatedAt: at,
					version: 1,
					purchaseCount: 0,
					completions: [],
					firstCompletedAt: null
				};
				s.products.push(product);
				s.products.sort((a, b) => compareNl(a.name, b.name));
			}
			const existing = s.items.find((i) => i.listId === op.listId && i.productId === product.id);
			if (existing) {
				if (existing.status === 'active') return;
				existing.status = 'active';
				existing.activatedAt = Math.max(at, existing.completedAt ?? 0);
				existing.completedAt = null;
				if (op.quantity !== null || op.unit !== null) {
					existing.quantity = op.quantity;
					existing.unit = op.unit;
				}
				bump(existing);
				return;
			}
			if (s.items.some((i) => i.id === op.itemId)) return;
			s.items.push({
				id: op.itemId,
				listId: op.listId,
				productId: product.id,
				quantity: op.quantity,
				unit: op.unit,
				status: 'active',
				activatedAt: at,
				completedAt: null,
				createdAt: at,
				updatedAt: at,
				version: 1
			});
			return;
		}
		case 'item.complete': {
			const item = findItem(op.itemId);
			if (!item || item.status === 'completed') return;
			const when = Math.max(at, item.activatedAt);
			item.status = 'completed';
			item.completedAt = when;
			bump(item);
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
			item.status = 'active';
			item.activatedAt = Math.max(at, item.completedAt ?? 0);
			item.completedAt = null;
			bump(item);
			return;
		}
		case 'item.update': {
			const item = findItem(op.itemId);
			if (!item) return;
			if ('quantity' in op.changes) item.quantity = op.changes.quantity ?? null;
			if ('unit' in op.changes) item.unit = op.changes.unit ?? null;
			bump(item);
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
			item.listId = op.toListId;
			bump(item);
			return;
		}
		case 'item.delete': {
			const id = resolve(aliases, op.itemId);
			s.items = s.items.filter((i) => i.id !== id);
			return;
		}
		case 'product.update': {
			const p = s.products.find((x) => x.id === resolve(aliases, op.productId));
			if (!p) return;
			if (op.changes.name !== undefined) {
				const key = nameKey(op.changes.name);
				if (!s.products.some((x) => x !== p && nameKey(x.name) === key)) {
					p.name = cleanName(op.changes.name);
					s.products.sort((a, b) => compareNl(a.name, b.name));
				}
			}
			if (op.changes.categoryId !== undefined) p.categoryId = op.changes.categoryId;
			if (op.changes.favorite !== undefined) p.favorite = op.changes.favorite;
			p.version += 1;
			return;
		}
		case 'product.delete': {
			const id = resolve(aliases, op.productId);
			s.products = s.products.filter((p) => p.id !== id);
			s.items = s.items.filter((i) => i.productId !== id);
			return;
		}
		case 'undo': {
			const hint = op.restore;
			if (!hint) return;
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
			return;
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
	switch (op.type) {
		case 'item.add': {
			const key = nameKey(op.name);
			const p = s.products.find((x) => nameKey(x.name) === key);
			if (p) {
				product(p.id);
				const existing = s.items.find((i) => i.listId === op.listId && i.productId === p.id);
				if (existing) item(existing.id);
				else hint.items[op.itemId] = null;
			} else {
				hint.products[op.productId] = null;
				hint.items[op.itemId] = null;
			}
			break;
		}
		case 'item.complete':
		case 'item.reactivate':
		case 'item.update':
		case 'item.delete': {
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
		case 'list.clearCompleted':
			for (const i of s.items) if (i.listId === op.listId && i.status === 'completed') item(i.id);
			break;
		case 'product.update':
			product(resolve(aliases, op.productId));
			break;
		case 'product.delete': {
			const pid = resolve(aliases, op.productId);
			product(pid);
			for (const i of s.items) if (i.productId === pid) item(i.id);
			break;
		}
	}
	return hint;
}
