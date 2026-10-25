/** Shared domain types used by both the server and the client. */

import type { Settings } from './settings';

export type ItemStatus = 'active' | 'completed';

/** A grocery list records purchases; a checklist (packing, chores…) never does. */
export type ListKind = 'grocery' | 'checklist';

export interface List {
	id: string;
	name: string;
	position: number;
	createdAt: number;
	updatedAt: number;
	kind: ListKind;
	/** When the kind last changed (new behaviour applies from then on). */
	kindChangedAt: number | null;
	/** Per-list category walking route. `null` falls back to the global category order. */
	categoryOrder: string[] | null;
}

/** Light, manually maintained stock indication. Never computed from purchases. */
export type StockStatus = 'unknown' | 'enough' | 'low' | 'out';

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
	/** Usual quantity suggested when the product is added without one. */
	defaultQuantity: number | null;
	defaultUnit: string | null;
	/** List the product normally belongs on (suggestions, autocomplete). */
	preferredListId: string | null;
	/** Fixed note kept with the product ("ongezouten"). */
	note: string | null;
	/** Id of the product photo (served from /api/media/:id). */
	photoId: string | null;
	stockStatus: StockStatus;
	stockUpdatedAt: number | null;
}

export interface ProductAlias {
	id: string;
	productId: string;
	alias: string;
	createdAt: number;
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
	/** Note for this purchase only ("voor zaterdag"). Cleared when the item is needed anew. */
	note: string | null;
	/** Another brand/product is fine (information for the shopper, never an automatic swap). */
	substituteOk: boolean;
	substituteNote: string | null;
	/** Parked as "Niet verkrijgbaar": still needed, not bought. */
	unavailableAt: number | null;
	/** Manual order (checklists). */
	position: number;
	/** Quantity bought so far in the current cycle (partial purchases). */
	purchasedQuantity: number | null;
}

export interface Bundle {
	id: string;
	name: string;
	/** Base number of people for a dish, `null` for a plain checklist/bundle. */
	servings: number | null;
	createdAt: number;
	updatedAt: number;
	version: number;
	lines: BundleLine[];
}

export interface BundleLine {
	id: string;
	productId: string;
	quantity: number | null;
	unit: string | null;
	note: string | null;
}

export interface Snooze {
	productId: string;
	until: number;
}

export interface RoundParticipant {
	deviceId: string;
	deviceName: string | null;
	joinedAt: number;
	lastSeenAt: number;
}

/** A shared shopping round on one grocery list. */
export interface Round {
	id: string;
	listId: string;
	startedAt: number;
	startedBy: string | null;
	participants: RoundParticipant[];
}

/** "Ik pak dit": a light, expiring hint. Never blocks buying. */
export interface Claim {
	itemId: string;
	roundId: string | null;
	deviceId: string;
	deviceName: string | null;
	claimedAt: number;
	expiresAt: number;
}

/** A recommendation imported from an external AI tool (see docs/AI-RECOMMENDATIONS.md). */
export interface AiRecommendation {
	id: string;
	productId: string;
	suggestedQuantity: number | null;
	suggestedUnit: string | null;
	nextPurchaseAt: number | null;
	/** 0..1 */
	confidence: number;
	reasoning: string;
	source: string | null;
	importedAt: number;
	version: number;
}

/** Full state snapshot as served by `GET /api/snapshot`. */
export interface Snapshot {
	seq: number;
	/** Changes when the whole dataset was replaced by a restore/import. */
	epoch: string;
	serverTime: number;
	lists: List[];
	categories: Category[];
	products: Product[];
	items: Item[];
	/** Open (not yet accepted or dismissed) AI recommendations. */
	aiRecommendations: AiRecommendation[];
	/** Sync protocol version of the server (see docs/SYNC.md). */
	protocol?: number;
	aliases: ProductAlias[];
	bundles: Bundle[];
	/** Active (not yet expired) shared "Niet nu" snoozes. */
	snoozes: Snooze[];
	/** Active shopping rounds. */
	rounds: Round[];
	/** Unexpired claims. */
	claims: Claim[];
	/** Household-wide settings (absent in snapshots of servers before v1.3). */
	settings: Settings;
}

export type SortMode = 'newest' | 'oldest' | 'az';
