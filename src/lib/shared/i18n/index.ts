/**
 * UI translations. The language is a household-wide setting (`Settings.language`, Beheer →
 * Functies); English is the default. Every dictionary has exactly the shape of `en`, so a
 * missing translation is a type error. Data typed by the household (product, list and category
 * names) is never translated, except the untouched names seeded on a fresh install.
 */

import { en, type Messages } from './en';
import { nl } from './nl';
import { de } from './de';
import { fr } from './fr';
import { es } from './es';

export type { Messages };

export const LANGUAGES = ['en', 'nl', 'de', 'fr', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

/** Language names in their own language, for the picker. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
	en: 'English',
	nl: 'Nederlands',
	de: 'Deutsch',
	fr: 'Français',
	es: 'Español'
};

/** BCP 47 tags for `Intl` (dates, sorting). */
export const LOCALE_TAGS: Readonly<Record<Language, string>> = {
	en: 'en-GB',
	nl: 'nl-NL',
	de: 'de-DE',
	fr: 'fr-FR',
	es: 'es-ES'
};

const DICTIONARIES: Readonly<Record<Language, Messages>> = { en, nl, de, fr, es };

export function isLanguage(value: unknown): value is Language {
	return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export function messagesFor(language: Language): Messages {
	return DICTIONARIES[language] ?? en;
}

/**
 * Names seeded by the initial migration (Dutch). As long as the household has not renamed them
 * they are shown in the chosen language; a renamed list or category is shown exactly as typed.
 */
const SEEDED_LISTS: Readonly<Record<string, string>> = { default: 'Boodschappen' };
const SEEDED_CATEGORIES: Readonly<Record<string, string>> = {
	'cat-groente': 'Groente & fruit',
	'cat-brood': 'Brood & bakkerij',
	'cat-zuivel': 'Zuivel & eieren',
	'cat-kaas': 'Kaas & vleeswaren',
	'cat-vlees': 'Vlees, vis & vega',
	'cat-houdbaar': 'Houdbaar',
	'cat-diepvries': 'Diepvries',
	'cat-dranken': 'Dranken',
	'cat-snacks': 'Snacks & snoep',
	'cat-verzorging': 'Verzorging',
	'cat-huishouden': 'Huishouden'
};

export function seededListName(id: string, name: string, m: Messages): string {
	return SEEDED_LISTS[id] === name ? (m.seeded.lists[id] ?? name) : name;
}

export function seededCategoryName(id: string, name: string, m: Messages): string {
	return SEEDED_CATEGORIES[id] === name ? (m.seeded.categories[id] ?? name) : name;
}

/** Decimal separator per language for quantities ("1.5 kg" / "1,5 kg"). */
export function decimalSeparator(language: Language): string {
	return language === 'en' ? '.' : ',';
}
