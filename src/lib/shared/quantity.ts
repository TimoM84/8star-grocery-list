/** Parsing and formatting of quantities and units ("2 kg aardappelen", "melk x2"). */

export const UNITS = [
	'stuks',
	'g',
	'kg',
	'ml',
	'l',
	'pak',
	'fles',
	'blik',
	'zak',
	'bos',
	'doos',
	'pot'
] as const;

export type Unit = (typeof UNITS)[number];

const UNIT_ALIASES: Record<string, Unit> = {
	st: 'stuks',
	'st.': 'stuks',
	stuk: 'stuks',
	stuks: 'stuks',
	x: 'stuks',
	g: 'g',
	gr: 'g',
	gram: 'g',
	kg: 'kg',
	kilo: 'kg',
	ml: 'ml',
	l: 'l',
	liter: 'l',
	ltr: 'l',
	pak: 'pak',
	pakken: 'pak',
	pakje: 'pak',
	pakjes: 'pak',
	fles: 'fles',
	flessen: 'fles',
	blik: 'blik',
	blikken: 'blik',
	blikje: 'blik',
	blikjes: 'blik',
	zak: 'zak',
	zakken: 'zak',
	zakje: 'zak',
	bos: 'bos',
	bossen: 'bos',
	doos: 'doos',
	dozen: 'doos',
	pot: 'pot',
	potten: 'pot',
	potje: 'pot'
};

export interface ParsedEntry {
	name: string;
	quantity: number | null;
	unit: Unit | null;
}

function toNumber(raw: string): number | null {
	const n = Number(raw.replace(',', '.'));
	return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
}

export function normaliseUnit(raw: string | null | undefined): Unit | null {
	if (!raw) return null;
	return UNIT_ALIASES[raw.toLocaleLowerCase('nl')] ?? null;
}

/**
 * Parses a typed entry. Supported forms:
 *  - "2 melk"            -> 2 × melk
 *  - "500 g gehakt"      -> 500 g gehakt
 *  - "1,5kg aardappelen" -> 1.5 kg aardappelen
 *  - "eieren x2" / "eieren 2x"
 * Anything else is taken as a plain product name.
 */
export function parseEntry(input: string): ParsedEntry {
	const text = input.replace(/\s+/g, ' ').trim();

	const leading = /^(\d+(?:[.,]\d+)?)\s*([a-zA-Z.]+)?\s+(.+)$/.exec(text);
	if (leading) {
		const quantity = toNumber(leading[1]);
		const unitRaw = leading[2];
		const unit = normaliseUnit(unitRaw);
		if (quantity !== null) {
			if (unitRaw && !unit) {
				// "2 rode paprika's": the word is part of the name, not a unit.
				return { name: `${unitRaw} ${leading[3]}`.trim(), quantity, unit: null };
			}
			return { name: leading[3].trim(), quantity, unit: unit === 'stuks' ? null : unit };
		}
	}

	const trailing = /^(.+?)\s+(?:x\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*x)$/i.exec(text);
	if (trailing) {
		const quantity = toNumber(trailing[2] ?? trailing[3]);
		if (quantity !== null) return { name: trailing[1].trim(), quantity, unit: null };
	}

	return { name: text, quantity: null, unit: null };
}

export function formatQuantity(quantity: number | null, unit: string | null): string {
	if (quantity === null && !unit) return '';
	const q =
		quantity === null
			? ''
			: Number.isInteger(quantity)
				? String(quantity)
				: String(quantity).replace('.', ',');
	if (!unit) return quantity === null ? '' : `${q}×`;
	return q ? `${q} ${unit}` : unit;
}

/** Sensible step for the quantity stepper given the unit. */
export function quantityStep(unit: string | null): number {
	if (unit === 'g' || unit === 'ml') return 50;
	if (unit === 'kg' || unit === 'l') return 0.5;
	return 1;
}

// ------------------------------------------------------------------ compatibility

/** Units that are just counts. `null` (no unit) and "stuks" mean the same. */
export function isCountUnit(unit: string | null | undefined): boolean {
	return !unit || unit === 'stuks';
}

/** Units for which "one more" is meaningful (counts and packages, not weights/volumes). */
export function isDiscreteUnit(unit: string | null | undefined): boolean {
	return !unit || !['g', 'kg', 'ml', 'l'].includes(unit);
}

const FACTORS: Record<string, { family: 'mass' | 'volume'; factor: number }> = {
	g: { family: 'mass', factor: 1 },
	kg: { family: 'mass', factor: 1000 },
	ml: { family: 'volume', factor: 1 },
	l: { family: 'volume', factor: 1000 }
};

/**
 * Converts a quantity between compatible units only: identical units, counts (none/stuks),
 * g ↔ kg and ml ↔ l. Returns null for anything else: we never invent a conversion between
 * packs, litres, pieces and so on.
 */
export function convertQuantity(
	quantity: number,
	from: string | null | undefined,
	to: string | null | undefined
): number | null {
	if ((from ?? null) === (to ?? null)) return quantity;
	if (isCountUnit(from) && isCountUnit(to)) return quantity;
	const a = from ? FACTORS[from] : undefined;
	const b = to ? FACTORS[to] : undefined;
	if (!a || !b || a.family !== b.family) return null;
	return roundQuantity((quantity * a.factor) / b.factor);
}

export function compatibleUnits(a: string | null | undefined, b: string | null | undefined) {
	return convertQuantity(1, a, b) !== null;
}

export function roundQuantity(n: number): number {
	return Math.round(n * 1000) / 1000;
}

export type DuplicateBlock = 'unknown_existing' | 'incompatible' | 'not_countable' | null;

export interface DuplicateAnalysis {
	existing: { quantity: number | null; unit: string | null };
	entered: { quantity: number | null; unit: string | null };
	/** "1 extra"/"Eén extra" is possible: amount and unit to add (in the entered unit). */
	extra: { quantity: number; unit: string | null } | null;
	/** "Wijzigen naar …" is possible (only with an explicitly entered quantity). */
	set: { quantity: number; unit: string | null } | null;
	/** Why adding extra is not offered. */
	block: DuplicateBlock;
}

/**
 * Decides which explicit intents make sense when a product that is already active on the list
 * is entered again. Nothing is ever changed silently: the UI offers these choices.
 */
export function analyseDuplicate(
	existing: { quantity: number | null; unit: string | null },
	entered: { quantity: number | null; unit: string | null }
): DuplicateAnalysis {
	const out: DuplicateAnalysis = { existing, entered, extra: null, set: null, block: null };
	if (entered.quantity !== null) out.set = { quantity: entered.quantity, unit: entered.unit };
	if (existing.quantity === null) {
		// An unknown existing amount is never silently treated as 1.
		out.block = 'unknown_existing';
		return out;
	}
	if (entered.quantity === null) {
		if (!isDiscreteUnit(existing.unit)) out.block = 'not_countable';
		else out.extra = { quantity: 1, unit: existing.unit };
		return out;
	}
	if (!compatibleUnits(entered.unit, existing.unit)) out.block = 'incompatible';
	else out.extra = { quantity: entered.quantity, unit: entered.unit };
	return out;
}
