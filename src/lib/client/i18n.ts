/**
 * Current UI messages. `m` always reads the household language through the bound source (the
 * synced settings in AppState), so templates and `$derived` values that use it re-render when
 * the language changes on any device.
 */

import {
	DEFAULT_LANGUAGE,
	LOCALE_TAGS,
	decimalSeparator,
	messagesFor,
	type Language,
	type Messages
} from '$lib/shared/i18n';
import { formatQuantity } from '$lib/shared/quantity';

let source: () => Language = () => DEFAULT_LANGUAGE;

/** Called once by AppState with a reactive getter for the current language. */
export function bindLanguage(get: () => Language) {
	source = get;
}

export function language(): Language {
	return source();
}

/** BCP 47 tag of the current language, for `Intl`. */
export function locale(): string {
	return LOCALE_TAGS[source()];
}

export const m: Messages = new Proxy({} as Messages, {
	get: (_target, key) => messagesFor(source())[key as keyof Messages]
});

/** `formatQuantity` with translated unit names and the language's decimal separator. */
export function qty(quantity: number | null, unit: string | null): string {
	const lang = source();
	return formatQuantity(quantity, unit, {
		units: messagesFor(lang).units,
		unitsPlural: messagesFor(lang).unitsPlural,
		decimal: decimalSeparator(lang)
	});
}

/** Translated unit label ("pak" → "pack"); unknown units are shown as stored. */
export function unitLabel(unit: string): string {
	return messagesFor(source()).units[unit] ?? unit;
}
