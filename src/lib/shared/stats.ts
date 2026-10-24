/**
 * Local purchase statistics. Pure functions so the server, the client (offline) and the
 * tests all compute exactly the same numbers.
 */

export const DAY = 24 * 60 * 60 * 1000;

/** Completions closer together than this are treated as one shopping trip. */
export const SAME_TRIP_WINDOW = 6 * 60 * 60 * 1000;

/** Minimum number of completed purchase cycles before we estimate or suggest anything. */
export const MIN_HISTORY = 3;

/** An item is suggested once this fraction of its usual interval has elapsed. */
export const DUE_RATIO = 0.8;

/** Suggestions are dropped once the product is this many intervals overdue (habit changed). */
export const STALE_RATIO = 4;

export interface ProductStats {
	purchaseCount: number;
	firstPurchasedAt: number | null;
	lastPurchasedAt: number | null;
	/** Mean days between purchases (null when fewer than 2 trips). */
	avgIntervalDays: number | null;
	/** Purchases per 30 days derived from the average interval. */
	perMonth: number | null;
	/** Purchases in the last 90 days. */
	recentCount: number;
	/** Estimated next purchase (null below MIN_HISTORY). */
	nextEstimatedAt: number | null;
	/** Fraction of the usual interval that has elapsed since the last purchase. */
	dueRatio: number | null;
	hasEnoughHistory: boolean;
}

/** Merge completions that belong to the same trip and return them sorted ascending. */
export function purchaseTrips(completions: readonly number[]): number[] {
	const sorted = [...completions].sort((a, b) => a - b);
	const trips: number[] = [];
	for (const t of sorted) {
		const last = trips[trips.length - 1];
		if (last !== undefined && t - last < SAME_TRIP_WINDOW) continue;
		trips.push(t);
	}
	return trips;
}

export function computeStats(
	completions: readonly number[],
	totalCount: number,
	now: number,
	firstCompletedAt: number | null = null
): ProductStats {
	const trips = purchaseTrips(completions);
	const purchaseCount = Math.max(totalCount, completions.length);
	const first = trips[0] ?? null;
	const firstPurchasedAt =
		firstCompletedAt !== null && (first === null || firstCompletedAt < first)
			? firstCompletedAt
			: first;
	const last = trips[trips.length - 1] ?? null;

	let avgIntervalDays: number | null = null;
	if (trips.length >= 2 && first !== null && last !== null) {
		avgIntervalDays = (last - first) / (trips.length - 1) / DAY;
		// Guard against degenerate data (several trips within minutes of each other).
		if (avgIntervalDays < 0.25) avgIntervalDays = 0.25;
	}

	const perMonth = avgIntervalDays ? 30 / avgIntervalDays : null;
	const recentCount = trips.filter((t) => now - t <= 90 * DAY).length;
	const hasEnoughHistory = trips.length >= MIN_HISTORY && avgIntervalDays !== null;

	let nextEstimatedAt: number | null = null;
	let dueRatio: number | null = null;
	if (hasEnoughHistory && last !== null && avgIntervalDays !== null) {
		nextEstimatedAt = Math.round(last + avgIntervalDays * DAY);
		dueRatio = (now - last) / (avgIntervalDays * DAY);
	}

	return {
		purchaseCount,
		firstPurchasedAt,
		lastPurchasedAt: last,
		avgIntervalDays,
		perMonth,
		recentCount,
		nextEstimatedAt,
		dueRatio,
		hasEnoughHistory
	};
}

/** Whether a product with these stats should appear under "Misschien nodig". */
export function isSuggested(stats: ProductStats): boolean {
	if (!stats.hasEnoughHistory || stats.dueRatio === null) return false;
	return stats.dueRatio >= DUE_RATIO && stats.dueRatio <= STALE_RATIO;
}

/** Score for "Vaak gekocht": recent activity dominates, lifetime count breaks ties. */
export function frequencyScore(stats: ProductStats): number {
	return stats.recentCount * 10 + stats.purchaseCount;
}
