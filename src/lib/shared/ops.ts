/**
 * Operation protocol. Every mutation is an operation with a client-generated unique id so the
 * server can apply it exactly once (idempotent replays after reconnects).
 */

import { MAX_NAME_LENGTH } from './text';
import { UNITS } from './quantity';

export interface OpBase {
	/** Unique operation id (UUID). */
	id: string;
	/** Client wall-clock time adjusted by the measured server offset. */
	at: number;
}

export type OpPayload =
	| { type: 'list.create'; listId: string; name: string }
	| { type: 'list.rename'; listId: string; name: string }
	| { type: 'list.delete'; listId: string }
	| { type: 'list.reorder'; listIds: string[] }
	| { type: 'list.clearCompleted'; listId: string }
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
	  }
	| { type: 'item.complete'; itemId: string }
	| { type: 'item.reactivate'; itemId: string }
	| {
			type: 'item.update';
			itemId: string;
			changes: { quantity?: number | null; unit?: string | null };
			base: { quantity?: number | null; unit?: string | null };
	  }
	| { type: 'item.move'; itemId: string; toListId: string }
	| { type: 'item.delete'; itemId: string }
	| {
			type: 'product.update';
			productId: string;
			changes: { name?: string; categoryId?: string | null; favorite?: boolean };
			base: { name?: string; categoryId?: string | null; favorite?: boolean };
	  }
	| { type: 'product.delete'; productId: string }
	| { type: 'ai.accept'; recommendationId: string; listId: string; itemId: string }
	| { type: 'ai.dismiss'; recommendationId: string }
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
}

export interface OpsRequest {
	clientId: string;
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
	'ai.dismiss'
]);

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BATCH = 200;

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
			return { ...base, type: raw.type, listId: id(raw.listId, 'listId'), name: name(raw.name) };
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
				categoryId: nullableId(raw.categoryId, 'categoryId')
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
			if (!isObj(raw.changes)) throw new ValidationError('invalid changes');
			const base2 = isObj(raw.base) ? raw.base : {};
			const changes: { quantity?: number | null; unit?: string | null } = {};
			const before: { quantity?: number | null; unit?: string | null } = {};
			if ('quantity' in raw.changes) {
				changes.quantity = quantity(raw.changes.quantity);
				if ('quantity' in base2) before.quantity = quantity(base2.quantity);
			}
			if ('unit' in raw.changes) {
				changes.unit = unit(raw.changes.unit);
				if ('unit' in base2) before.unit = unit(base2.unit);
			}
			if (Object.keys(changes).length === 0) throw new ValidationError('no changes');
			return { ...base, type: raw.type, itemId: id(raw.itemId, 'itemId'), changes, base: before };
		}
		case 'product.update': {
			if (!isObj(raw.changes)) throw new ValidationError('invalid changes');
			const base2 = isObj(raw.base) ? raw.base : {};
			const changes: { name?: string; categoryId?: string | null; favorite?: boolean } = {};
			const before: { name?: string; categoryId?: string | null; favorite?: boolean } = {};
			if ('name' in raw.changes) {
				changes.name = name(raw.changes.name);
				if (typeof base2.name === 'string') before.name = base2.name;
			}
			if ('categoryId' in raw.changes) {
				changes.categoryId = nullableId(raw.changes.categoryId, 'categoryId');
				if ('categoryId' in base2) before.categoryId = nullableId(base2.categoryId, 'categoryId');
			}
			if ('favorite' in raw.changes) {
				if (typeof raw.changes.favorite !== 'boolean')
					throw new ValidationError('invalid favorite');
				changes.favorite = raw.changes.favorite;
				if (typeof base2.favorite === 'boolean') before.favorite = base2.favorite;
			}
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
		case 'undo':
			return { ...base, type: raw.type, targetOpId: id(raw.targetOpId, 'targetOpId') };
		default:
			throw new ValidationError('unknown op type');
	}
}

export function parseOpsRequest(raw: unknown): { clientId: string; ops: unknown[] } {
	if (!isObj(raw)) throw new ValidationError('body must be an object');
	const clientId = id(raw.clientId, 'clientId');
	if (!Array.isArray(raw.ops) || raw.ops.length > MAX_BATCH)
		throw new ValidationError('ops must be an array of at most ' + MAX_BATCH);
	return { clientId, ops: raw.ops };
}
