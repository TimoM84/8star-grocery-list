/** Text normalisation helpers shared by server and client. */

const COLLATOR = new Intl.Collator('nl', { sensitivity: 'base', numeric: true });

/** Collapse whitespace and trim, keeping the user's casing for display. */
export function cleanName(input: string): string {
	return input.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Key used for duplicate detection: case-insensitive and whitespace-insensitive.
 * "  Halfvolle   MELK " and "halfvolle melk" map to the same key.
 */
export function nameKey(input: string): string {
	return cleanName(input).toLocaleLowerCase('nl');
}

/** Accent-insensitive search key ("crème" matches "creme"). */
export function searchKey(input: string): string {
	return nameKey(input).normalize('NFD').replace(/\p{M}/gu, '');
}

/** Dutch-locale alphabetical comparison. */
export function compareNl(a: string, b: string): number {
	return COLLATOR.compare(a, b);
}

/** Capitalise the first letter for nicer display of freshly typed names. */
export function capitaliseFirst(input: string): string {
	if (!input) return input;
	return input.charAt(0).toLocaleUpperCase('nl') + input.slice(1);
}

export const MAX_NAME_LENGTH = 80;
export const MAX_NOTE_LENGTH = 200;
