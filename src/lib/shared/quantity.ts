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
