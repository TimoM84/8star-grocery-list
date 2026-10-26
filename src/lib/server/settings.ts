/** Household settings stored as JSON values in the `meta` table (no schema change needed). */

import type { DB } from './db';
import {
	LEGACY_AI_KEY,
	SETTING_KEYS,
	normaliseSettings,
	type Settings
} from '$lib/shared/settings';

function readKey(db: DB, key: string): unknown {
	const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
		{ value: string } | undefined;
	return row ? JSON.parse(row.value) : undefined;
}

/** Current settings; missing keys fall back to the defaults. */
export function readSettings(db: DB): Settings {
	const raw: Record<string, unknown> = {};
	for (const [name, key] of Object.entries(SETTING_KEYS)) raw[name] = readKey(db, key);
	// Until "Suggesties tonen" is first changed, the v1.3 "AI-functies tonen" value decides.
	raw.aiEnabled = readKey(db, LEGACY_AI_KEY);
	return normaliseSettings(raw);
}

/** Writes the given settings (inside the caller's transaction). True when anything changed. */
export function writeSettings(db: DB, changes: Partial<Settings>): boolean {
	const current = readSettings(db);
	let changed = false;
	for (const [name, value] of Object.entries(changes) as [keyof Settings, unknown][]) {
		if (value === undefined || current[name] === value) continue;
		db.prepare(
			'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
		).run(SETTING_KEYS[name], JSON.stringify(value));
		changed = true;
	}
	return changed;
}
