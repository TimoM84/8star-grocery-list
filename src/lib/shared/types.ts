/** Shared domain types used by both the server and the client. */

export type ItemStatus = 'active' | 'completed';

export interface List {
	id: string;
	name: string;
	position: number;
	createdAt: number;
	updatedAt: number;
}

export interface Category {
	id: string;
	name: string;
	position: number;
	createdAt: number;
	updatedAt: number;
}

export interface Product {
	id: string;
	name: string;
	categoryId: string | null;
	favorite: boolean;
	createdAt: number;
	updatedAt: number;
	version: number;
	/** Total number of completed purchase cycles (all time). */
	purchaseCount: number;
	/** Completion timestamps (ascending), limited to the most recent ones. */
	completions: number[];
	/** Very first completion (all time), even if older than `completions`. */
	firstCompletedAt: number | null;
}

export interface Item {
	id: string;
	listId: string;
	productId: string;
	quantity: number | null;
	unit: string | null;
	status: ItemStatus;
	/** When the item was (re)activated on the list. Drives "Nieuwste"/"Oudste" sorting. */
	activatedAt: number;
	completedAt: number | null;
	createdAt: number;
	updatedAt: number;
	version: number;
}

/** Full state snapshot as served by `GET /api/snapshot`. */
export interface Snapshot {
	seq: number;
	serverTime: number;
	lists: List[];
	categories: Category[];
	products: Product[];
	items: Item[];
}

export type SortMode = 'newest' | 'oldest' | 'az';
