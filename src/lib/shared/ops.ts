/**
 * Operation protocol. Every mutation is an operation with a client-generated unique id so the
 * server can apply it exactly once (idempotent replays after reconnects).
 */

import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from './text';
import { UNITS } from './quantity';
import type { ListKind, StockStatus } from './types';

/**
 * Sync protocol version. 1 = v1.0/v1.1, 2 = v1.2 (intent ops, rounds, bundles…), 3 = v1.3
 * (shared settings). Servers keep accepting every op type of older protocols; see docs/SYNC.md.
 */
export const PROTOCOL_VERSION = 3;

export interface ItemChanges {
	quantity?: number | null;
	unit?: string | null;
	note?: string | null;
	substituteOk?: boolean;
	substituteNote?: string | null;
}

export interface ProductChanges {
	name?: string;
	categoryId?: string | null;
	favorite?: boolean;
	defaultQuantity?: number | null;
	defaultUnit?: string | null;
	preferredListId?: string | null;
	note?: string | null;
}

/**
 * One line of a combined add (bulk paste, bundle, share). `action` is the user's explicit
 * intent for a product that may already be on the list:
 *  - add:   put it on the list; if it is already active nothing changes
 *  - extra: atomically add `quantity` to the active item (compatible units only)
 *  - set:   set the active item's quantity to exactly `quantity`
 */
export interface AddManyEntry {
	itemId: string;
	productId: string;
	name: string;
	quantity: number | null;
	unit: string | null;
	categoryId: string | null;
	note: string | null;
	action: 'add' | 'extra' | 'set';
}

export interface BundleLineInput {
	lineId: string;
	productId: string;
	name: string;
	quantity: number | null;
	unit: string | null;
	note: string | null;
}

export interface OpBase {
	/** Unique operation id (UUID). */
	id: string;
	/** Client wall-clock time adjusted by the measured server offset. */
	at: number;
}

export type OpPayload =
	| { type: 'list.create'; listId: string; name: string; kind?: ListKind }
	| { type: 'list.rename'; listId: string; name: string }
	| { type: 'list.delete'; listId: string }
	| { type: 'list.reorder'; listIds: string[] }
	| { type: 'list.clearCompleted'; listId: string }
	| { type: 'list.setKind'; listId: string; kind: ListKind }
	| { type: 'list.setCategoryOrder'; listId: string; categoryIds: string[] | null }
	| { type: 'list.resetChecklist'; listId: string; itemIds: string[] }
	| { type: 'list.retryUnavailable'; listId: string }
	| { type: 'category.create'; categoryId: string; name: string }
	| { type: 'category.rename'; categoryId: string; name: string }
	| { type: 'category.delete'; categoryId: string }
	| { type: 'category.reorder'; categoryIds: string[] }
	| {
			type: 'item.add';
			itemId: string;
			productId: string;
			listId: string;
			name: string;
			quantity: number | null;
			unit: string | null;
			categoryId: string | null;
			note?: string | null;
	  }
	| { type: 'items.addMany'; listId: string; entries: AddManyEntry[] }
	| { type: 'item.increment'; itemId: string; delta: number; unit: string | null }
	| { type: 'item.purchasePartial'; itemId: string; quantity: number; unit: string | null }
	| { type: 'item.setUnavailable'; itemId: string; unavailable: boolean }
	| { type: 'item.reorder'; listId: string; itemIds: string[] }
	| { type: 'item.claim'; itemId: string; deviceId: string; deviceName: string | null }
	| { type: 'item.release'; itemId: string; deviceId: string }
	| { type: 'item.complete'; itemId: string }
	| { type: 'item.reactivate'; itemId: string }
	| {
			type: 'item.update';
			itemId: string;
			changes: ItemChanges;
			base: ItemChanges;
	  }
	| { type: 'item.move'; itemId: string; toListId: string }
	| { type: 'item.delete'; itemId: string }
	| {
			type: 'product.update';
			productId: string;
			changes: ProductChanges;
			base: ProductChanges;
	  }
	| { type: 'product.delete'; productId: string }
	| { type: 'product.setStock'; productId: string; status: StockStatus }
	| { type: 'product.setPhoto'; productId: string; mediaId: string | null }
	| { type: 'product.snooze'; productId: string; until: number }
	| { type: 'alias.add'; aliasId: string; productId: string; alias: string }
	| { type: 'alias.remove'; aliasId: string }
	| {
			type: 'bundle.save';
			bundleId: string;
			name: string;
			servings: number | null;
			lines: BundleLineInput[];
	  }
	| { type: 'bundle.delete'; bundleId: string }
	| {
			type: 'round.join';
			roundId: string;
			listId: string;
			deviceId: string;
			deviceName: string | null;
	  }
	| { type: 'round.leave'; roundId: string; deviceId: string }
	| { type: 'round.end'; roundId: string; deviceId: string }
	| { type: 'ai.accept'; recommendationId: string; listId: string; itemId: string }
	| { type: 'ai.dismiss'; recommendationId: string }
	| { type: 'settings.update'; aiEnabled: boolean }
	| { type: 'undo'; targetOpId: string };

export type Op = OpBase & OpPayload;
export type OpType = Op['type'];

export type OpStatus = 'applied' | 'noop' | 'rejected';

export interface FieldConflict {
	field: string;
	/** Value on the server just before this op overwrote it. */
	previous: unknown;
	/** Value the client believed was there. */
	expected: unknown;
	/** Value that was written. */
	written: unknown;
}

export interface OpResult {
	opId: string;
	status: OpStatus;
	/** Machine-readable reason for noop/rejected. */
	reason?: string;
	/** Dutch user-facing message (shown for rejected ops and conflicts). */
	message?: string;
	/** Canonical ids when the server merged the op into an existing entity. */
	itemId?: string;
	productId?: string;
	conflicts?: FieldConflict[];
	/** True when the op can be undone server-side. */
	undoable?: boolean;
	/** Canonical round id (round.join merged into an already active round). */
	roundId?: string;
	/** Outcome of a combined add (items.addMany). */
	summary?: AddManySummary;
}

export interface AddManySummary {
	added: number;
	reactivated: number;
	increased: number;
	set: number;
	unchanged: number;
}

export interface OpsRequest {
	clientId: string;
	/** Protocol version of the sending client (absent = 1). */
	protocol?: number;
	ops: Op[];
}

export interface OpsResponse {
	results: OpResult[];
	seq: number;
}

/** Op types that the server records an inverse for. */
export const UNDOABLE_TYPES: ReadonlySet<OpType> = new Set<OpType>([
	'item.add',
	'item.complete',
	'item.reactivate',
	'item.update',
	'item.move',
	'item.delete',
	'list.clearCompleted',
	'product.update',
	'product.delete',
	'ai.accept',
	'ai.dismiss',
	'items.addMany',
	'item.increment',
	'item.purchasePartial',
	'item.setUnavailable',
	'item.reorder',
	'list.setKind',
	'list.setCategoryOrder',
	'list.resetChecklist',
	'list.retryUnavailable',
	'product.setStock',
	'product.setPhoto',
	'product.snooze',
	'alias.add',
	'alias.remove',
	'bundle.save',
	'bundle.delete'
]);

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BATCH = 200;
/** Max lines in one combined add (bulk paste, bundle). */
export const MAX_ADD_MANY = 100;
export const MAX_BUNDLE_LINES = 100;
const STOCK: readonly StockStatus[] = ['unknown', 'enough', 'low', 'out'];
const KINDS: readonly ListKind[] = ['grocery', 'checklist'];

export class ValidationError extends Error {}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function id(v: unknown, field: string): string {
	if (typeof v !== 'string' || !ID_RE.test(v)) throw new ValidationError(`invalid ${field}`);
	return v;
}

function name(v: unknown, field = 'name'): string {
	if (typeof v !== 'string') throw new ValidationError(`invalid ${field}`);
	const trimmed = v.replace(/\s+/g, ' ').trim();
	if (!trimmed || trimmed.length > MAX_NAME_LENGTH) throw new ValidationError(`invalid ${field}`);
	return trimmed;
}

function quantity(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v >= 100000)
		throw new ValidationError('invalid quantity');
	return Math.round(v * 1000) / 1000;
}

function unit(v: unknown): string | null {
	if (v === null || v === undefined || v === '') return null;
	if (typeof v !== 'string' || !(UNITS as readonly string[]).includes(v))
		throw new ValidationError('invalid unit');
	return v;
}

function positive(v: unknown, field: string): number {
	const q = quantity(v);
	if (q === null) throw new ValidationError(`invalid ${field}`);
	return q;
}

/** Optional free text (notes): trimmed, empty becomes null. */
function note(v: unknown, field = 'note'): string | null {
	if (v === null || v === undefined) return null;
	if (typeof v !== 'string') throw new ValidationError(`invalid ${field}`);
	const trimmed = v.replace(/\s+/g, ' ').trim();
	if (trimmed.length > MAX_NOTE_LENGTH) throw new ValidationError(`invalid ${field}`);
	return trimmed || null;
}

function bool(v: unknown, field: string): boolean {
	if (typeof v !== 'boolean') throw new ValidationError(`invalid ${field}`);
	return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
	if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v))
		throw new ValidationError(`invalid ${field}`);
	return v as T;
}

function deviceName(v: unknown): string | null {
	if (v === null || v === undefined || v === '') return null;
	if (typeof v !== 'string') throw new ValidationError('invalid deviceName');
	const trimmed = v.replace(/\s+/g, ' ').trim().slice(0, 40);
	return trimmed || null;
}

function nullableId(v: unknown, field: string): string | null {
	if (v === null || v === undefined) return null;
	return id(v, field);
}

function idArray(v: unknown, field: string): string[] {
	if (!Array.isArray(v) || v.length > 500) throw new ValidationError(`invalid ${field}`);
	return v.map((x) => id(x, field));
}

/** Validates and normalises an untrusted op. Throws ValidationError. */
export function parseOp(raw: unknown): Op {
	if (!isObj(raw)) throw new ValidationError('op must be an object');
	const base: OpBase = {
		id: id(raw.id, 'id'),
		at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? Math.round(raw.at) : Date.now()
	};
	switch (raw.type) {
		case 'list.create':
			return {
				...base,
				type: raw.type,
				listId: id(raw.listId, 'listId'),
				name: name(raw.name),
				...(raw.kind !== undefined ? { kind: oneOf(raw.kind, KINDS, 'kind') } : {})
			};
		case 'list.setKind':
			return {
				...base,
				type: raw.type,
				listId: id(raw.listId, 'listId'),
				kind: oneOf(raw.kind, KINDS, 'kind')
			};
		case 'list.setCategoryOrder':
			return {
				...base,
				type: raw.type,
				listId: id(raw.listId, 'listId'),
				categoryIds: raw.categoryIds === null ? null : idArray(raw.categoryIds, 'categoryIds')
			};
		case 'list.resetChecklist':
			return {
				...base,
				type: raw.type,
				listId: id(raw.listId, 'listId'),
				itemIds: idArray(raw.itemIds, 'itemIds')
			};
		case 'list.retryUnavailable':
			return { ...base, type: raw.type, listId: id(raw.listId, 'listId') };
		case 'list.rename':
			return { ...base, type: raw.type, listId: id(raw.listId, 'listId'), name: name(raw.name) };
		case 'list.delete':
		case 'list.clearCompleted':
			return { ...base, type: raw.type, listId: id(raw.listId, 'listId') };
		case 'list.reorder':
			return { ...base, type: raw.type, listIds: idArray(raw.listIds, 'listIds') };
		case 'category.create':
		case 'category.rename':
			return {
				...base,
				type: raw.type,
				categoryId: id(raw.categoryId, 'categoryId'),
				name: name(raw.name)
			};
		case 'category.delete':
			return { ...base, type: raw.type, categoryId: id(raw.categoryId, 'categoryId') };
		case 'category.reorder':
			return { ...base, type: raw.type, categoryIds: idArray(raw.categoryIds, 'categoryIds') };
		case 'item.add':
			return {
				...base,
				type: raw.type,
				itemId: id(raw.itemId, 'itemId'),
				productId: id(raw.productId, 'productId'),
				listId: id(raw.listId, 'listId'),
				name: name(raw.name),
				quantity: quantity(raw.quantity),
				unit: unit(raw.unit),
				categoryId: nullableId(raw.categoryId, 'categoryId'),
				...(raw.note !== undefined ? { note: note(raw.note) } : {})
			};
		case 'items.addMany': {
			if (!Array.isArray(raw.entries) || !raw.entries.length || raw.entries.length > MAX_ADD_MANY)
				throw new ValidationError('invalid entries');
			const entries = raw.entries.map((e): AddManyEntry => {
				if (!isObj(e)) throw new ValidationError('invalid entry');
				const action = oneOf(e.action ?? 'add', ['add', 'extra', 'set'] as const, 'action');
				const q = quantity(e.quantity);
				if (action !== 'add' && q === null) throw new ValidationError('quantity required');
				return {
					itemId: id(e.itemId, 'itemId'),
					productId: id(e.productId, 'productId'),
					name: name(e.name),
					quantity: q,
					unit: unit(e.unit),
					categoryId: nullableId(e.categoryId, 'categoryId'),
					note: note(e.note),
					action
				};
			});
			return { ...base, type: raw.type, listId: id(raw.listId, 'listId'), entries };
		}
		case 'item.increment':
			return {
				...base,
				type: raw.type,
				itemId: id(raw.itemId, 'itemId'),
				delta: positive(raw.delta, 'delta'),
				unit: unit(raw.unit)
			};
		case 'item.purchasePartial':
			return {
				...base,
				type: raw.type,
				itemId: id(raw.itemId, 'itemId'),
				quantity: positive(raw.quantity, 'quantity'),
				unit: unit(raw.unit)
			};
		case 'item.setUnavailable':
			return {
				...base,
				type: raw.type,
				itemId: id(raw.itemId, 'itemId'),
				unavailable: bool(raw.unavailable, 'unavailable')
			};
		case 'item.reorder':
			return {
				...base,
				type: raw.type,
				listId: id(raw.listId, 'listId'),
				itemIds: idArray(raw.itemIds, 'itemIds')
			};
		case 'item.claim':
			return {
				...base,
				type: raw.type,
				itemId: id(raw.itemId, 'itemId'),
				deviceId: id(raw.deviceId, 'deviceId'),
				deviceName: deviceName(raw.deviceName)
			};
		case 'item.release':
			return {
				...base,
				type: raw.type,
				itemId: id(raw.itemId, 'itemId'),
				deviceId: id(raw.deviceId, 'deviceId')
			};
		case 'item.complete':
		case 'item.reactivate':
		case 'item.delete':
			return { ...base, type: raw.type, itemId: id(raw.itemId, 'itemId') };
		case 'item.move':
			return {
				...base,
				type: raw.type,
				itemId: id(raw.itemId, 'itemId'),
				toListId: id(raw.toListId, 'toListId')
			};
		case 'item.update': {
			const rawChanges = raw.changes;
			if (!isObj(rawChanges)) throw new ValidationError('invalid changes');
			const base2: Record<string, unknown> = isObj(raw.base) ? raw.base : {};
			const changes: ItemChanges = {};
			const before: ItemChanges = {};
			const field = <K extends keyof ItemChanges>(
				key: K,
				parse: (v: unknown) => ItemChanges[K]
			) => {
				if (!(key in rawChanges)) return;
				changes[key] = parse(rawChanges[key]);
				if (key in base2) before[key] = parse(base2[key]);
			};
			field('quantity', quantity);
			field('unit', unit);
			field('note', (v) => note(v));
			field('substituteOk', (v) => bool(v, 'substituteOk'));
			field('substituteNote', (v) => note(v, 'substituteNote'));
			if (Object.keys(changes).length === 0) throw new ValidationError('no changes');
			return { ...base, type: raw.type, itemId: id(raw.itemId, 'itemId'), changes, base: before };
		}
		case 'product.update': {
			const rawChanges = raw.changes;
			if (!isObj(rawChanges)) throw new ValidationError('invalid changes');
			const base2: Record<string, unknown> = isObj(raw.base) ? raw.base : {};
			const changes: ProductChanges = {};
			const before: ProductChanges = {};
			const field = <K extends keyof ProductChanges>(
				key: K,
				parse: (v: unknown) => ProductChanges[K],
				parseBase: (v: unknown) => ProductChanges[K] | undefined = parse
			) => {
				if (!(key in rawChanges)) return;
				changes[key] = parse(rawChanges[key]);
				if (key in base2) {
					const b = parseBase(base2[key]);
					if (b !== undefined) before[key] = b;
				}
			};
			field(
				'name',
				(v) => name(v),
				(v) => (typeof v === 'string' ? v : undefined)
			);
			field('categoryId', (v) => nullableId(v, 'categoryId'));
			field(
				'favorite',
				(v) => bool(v, 'favorite'),
				(v) => (typeof v === 'boolean' ? v : undefined)
			);
			field('defaultQuantity', quantity);
			field('defaultUnit', unit);
			field('preferredListId', (v) => nullableId(v, 'preferredListId'));
			field('note', (v) => note(v));
			if (Object.keys(changes).length === 0) throw new ValidationError('no changes');
			return {
				...base,
				type: raw.type,
				productId: id(raw.productId, 'productId'),
				changes,
				base: before
			};
		}
		case 'product.delete':
			return { ...base, type: raw.type, productId: id(raw.productId, 'productId') };
		case 'product.setStock':
			return {
				...base,
				type: raw.type,
				productId: id(raw.productId, 'productId'),
				status: oneOf(raw.status, STOCK, 'status')
			};
		case 'product.setPhoto':
			return {
				...base,
				type: raw.type,
				productId: id(raw.productId, 'productId'),
				mediaId: nullableId(raw.mediaId, 'mediaId')
			};
		case 'product.snooze': {
			if (typeof raw.until !== 'number' || !Number.isFinite(raw.until) || raw.until < 0)
				throw new ValidationError('invalid until');
			return {
				...base,
				type: raw.type,
				productId: id(raw.productId, 'productId'),
				until: Math.round(raw.until)
			};
		}
		case 'alias.add':
			return {
				...base,
				type: raw.type,
				aliasId: id(raw.aliasId, 'aliasId'),
				productId: id(raw.productId, 'productId'),
				alias: name(raw.alias, 'alias')
			};
		case 'alias.remove':
			return { ...base, type: raw.type, aliasId: id(raw.aliasId, 'aliasId') };
		case 'bundle.save': {
			if (!Array.isArray(raw.lines) || raw.lines.length > MAX_BUNDLE_LINES)
				throw new ValidationError('invalid lines');
			const servings = raw.servings === null || raw.servings === undefined ? null : raw.servings;
			if (
				servings !== null &&
				(typeof servings !== 'number' ||
					!Number.isFinite(servings) ||
					servings <= 0 ||
					servings > 100)
			)
				throw new ValidationError('invalid servings');
			return {
				...base,
				type: raw.type,
				bundleId: id(raw.bundleId, 'bundleId'),
				name: name(raw.name),
				servings: servings === null ? null : Math.round(servings * 100) / 100,
				lines: raw.lines.map((l): BundleLineInput => {
					if (!isObj(l)) throw new ValidationError('invalid line');
					return {
						lineId: id(l.lineId, 'lineId'),
						productId: id(l.productId, 'productId'),
						name: name(l.name),
						quantity: quantity(l.quantity),
						unit: unit(l.unit),
						note: note(l.note)
					};
				})
			};
		}
		case 'bundle.delete':
			return { ...base, type: raw.type, bundleId: id(raw.bundleId, 'bundleId') };
		case 'round.join':
			return {
				...base,
				type: raw.type,
				roundId: id(raw.roundId, 'roundId'),
				listId: id(raw.listId, 'listId'),
				deviceId: id(raw.deviceId, 'deviceId'),
				deviceName: deviceName(raw.deviceName)
			};
		case 'round.leave':
		case 'round.end':
			return {
				...base,
				type: raw.type,
				roundId: id(raw.roundId, 'roundId'),
				deviceId: id(raw.deviceId, 'deviceId')
			};
		case 'ai.accept':
			return {
				...base,
				type: raw.type,
				recommendationId: id(raw.recommendationId, 'recommendationId'),
				listId: id(raw.listId, 'listId'),
				itemId: id(raw.itemId, 'itemId')
			};
		case 'ai.dismiss':
			return {
				...base,
				type: raw.type,
				recommendationId: id(raw.recommendationId, 'recommendationId')
			};
		case 'settings.update':
			return { ...base, type: raw.type, aiEnabled: bool(raw.aiEnabled, 'aiEnabled') };
		case 'undo':
			return { ...base, type: raw.type, targetOpId: id(raw.targetOpId, 'targetOpId') };
		default:
			throw new ValidationError('unknown op type');
	}
}

export function parseOpsRequest(raw: unknown): {
	clientId: string;
	protocol: number;
	ops: unknown[];
} {
	if (!isObj(raw)) throw new ValidationError('body must be an object');
	const clientId = id(raw.clientId, 'clientId');
	if (!Array.isArray(raw.ops) || raw.ops.length > MAX_BATCH)
		throw new ValidationError('ops must be an array of at most ' + MAX_BATCH);
	const protocol =
		typeof raw.protocol === 'number' && Number.isInteger(raw.protocol) ? raw.protocol : 1;
	return { clientId, protocol, ops: raw.ops };
}
