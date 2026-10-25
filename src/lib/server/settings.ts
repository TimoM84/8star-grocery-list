/** Household settings stored as JSON values in the `meta` table (no schema change needed). */

import type { DB } from './db';
import { SETTING_KEYS, normaliseSettings, type Settings } from '$lib/shared/settings';

/** Current settings; missing keys fall back to the defaults. */
export function readSettings(db: DB): Settings {
	const raw: Record<string, unknown> = {};
	for (const [name, key] of Object.entries(SETTING_KEYS)) {
		const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
			{ value: string } | undefined;
		if (row) raw[name] = JSON.parse(row.value);
	}
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
