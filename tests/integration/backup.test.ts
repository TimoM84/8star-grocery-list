import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { latestSchemaVersion, openDatabase } from '$lib/server/db';
import { createBackup, createBackupSync, listBackups, pruneBackups } from '$lib/server/backup';

describe('backups', () => {
	it('writes unique, self-contained, verified files even within the same second', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), '8star-backup-'));
		const db = openDatabase(path.join(dir, 'live.db'));
		const a = createBackupSync(db, dir, 'pre-import');
		const b = createBackupSync(db, dir, 'pre-import');
		const c = await createBackup(db, dir, 'auto');
		const d = await createBackup(db, dir, 'auto');
		expect(new Set([a, b, c, d]).size).toBe(4);
		for (const f of [a, b, c, d]) {
			expect(fs.existsSync(f + '-wal')).toBe(false);
			const copy = new Database(f, { readonly: true });
			expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
			expect(copy.pragma('user_version', { simple: true })).toBe(latestSchemaVersion());
			copy.close();
		}
		expect(listBackups(dir)).toHaveLength(4);
		// Only automatic backups are pruned.
		expect(pruneBackups(dir, 1)).toHaveLength(1);
		expect(listBackups(dir)).toHaveLength(3);
		db.close();
	});
});
