/**
 * Household-wide settings. They live on the server (`meta` table), travel in every snapshot,
 * change through the `settings.update` op and are part of the JSON export (see docs/SYNC.md).
 */

import { DEFAULT_LANGUAGE, isLanguage, type Language } from './i18n';

export interface Settings {
	/**
	 * Show suggestions: "Misschien nodig" (on the list and the Suggesties page), the AI
	 * suggestions, the AI import, the AI prompt and the suggestion badge. Switching it off only
	 * hides them; history, predictions and imported recommendations are kept. Autocomplete while
	 * typing is not a suggestion and always works. Replaces `aiEnabled` (v1.3), see
	 * `normaliseSettings`.
	 */
	suggestionsEnabled: boolean;
	/** Show "Meerdere toevoegen" (bulk add, also via paste and share). Adding one product always works. */
	bulkAddEnabled: boolean;
	/** UI language for every device (English by default). Data is never translated. */
	language: Language;
}

/** Defaults keep the behaviour of earlier versions (everything visible), in English. */
export const DEFAULT_SETTINGS: Readonly<Settings> = {
	suggestionsEnabled: true,
	bulkAddEnabled: true,
	language: DEFAULT_LANGUAGE
};

/** `meta` key per setting. Values are stored as JSON. */
export const SETTING_KEYS: Readonly<Record<keyof Settings, string>> = {
	suggestionsEnabled: 'setting.suggestionsEnabled',
	bulkAddEnabled: 'setting.bulkAddEnabled',
	language: 'setting.language'
};

/**
 * Pre-v1.5 name of `suggestionsEnabled` ("Show AI features"). It is still read from the
 * database, old exports, cached snapshots and queued ops, so a household that had AI switched
 * off also has the wider suggestions switched off.
 */
export const LEGACY_AI_KEY = 'setting.aiEnabled';

const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/** Fills missing or malformed values (older snapshots and exports) with the defaults. */
export function normaliseSettings(raw: unknown): Settings {
	const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
	return {
		suggestionsEnabled:
			bool(o.suggestionsEnabled) ?? bool(o.aiEnabled) ?? DEFAULT_SETTINGS.suggestionsEnabled,
		bulkAddEnabled: bool(o.bulkAddEnabled) ?? DEFAULT_SETTINGS.bulkAddEnabled,
		language: isLanguage(o.language) ? o.language : DEFAULT_SETTINGS.language
	};
}
