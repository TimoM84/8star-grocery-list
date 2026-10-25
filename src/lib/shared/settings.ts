/**
 * Household-wide settings. They live on the server (`meta` table), travel in every snapshot,
 * change through the `settings.update` op and are part of the JSON export (see docs/SYNC.md).
 */

import { DEFAULT_LANGUAGE, isLanguage, type Language } from './i18n';

export interface Settings {
	/**
	 * Show the AI features: the AI-suggesties section, the AI import, the AI-opdracht download
	 * and their explanations. Switching it off only hides them; no data is ever deleted.
	 */
	aiEnabled: boolean;
	/** UI language for every device (English by default). Data is never translated. */
	language: Language;
}

/** Defaults keep the behaviour of earlier versions (everything visible), in English. */
export const DEFAULT_SETTINGS: Readonly<Settings> = {
	aiEnabled: true,
	language: DEFAULT_LANGUAGE
};

/** `meta` key per setting. Values are stored as JSON. */
export const SETTING_KEYS: Readonly<Record<keyof Settings, string>> = {
	aiEnabled: 'setting.aiEnabled',
	language: 'setting.language'
};

/** Fills missing or malformed values (older snapshots and exports) with the defaults. */
export function normaliseSettings(raw: unknown): Settings {
	const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
	return {
		aiEnabled: typeof o.aiEnabled === 'boolean' ? o.aiEnabled : DEFAULT_SETTINGS.aiEnabled,
		language: isLanguage(o.language) ? o.language : DEFAULT_SETTINGS.language
	};
}
