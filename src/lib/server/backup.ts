import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db';

const PREFIX = 'grocery-';

function stamp(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/**
 * Creates a consistent online backup using SQLite's backup API (safe while the app is
 * running and in WAL mode). Returns the file path.
 */
export async function createBackup(db: DB, dir: string, label = 'auto'): Promise<string> {
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${PREFIX}${stamp()}-${label}.db`);
	await db.backup(file);
	return file;
}

/** Synchronous variant (VACUUM INTO) used before migrations, when nothing else runs yet. */
export function createBackupSync(db: DB, dir: string, label: string): string {
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${PREFIX}${stamp()}-${label}.db`);
	db.prepare('VACUUM INTO ?').run(file);
	return file;
}

export interface BackupInfo {
	file: string;
	size: number;
	createdAt: number;
}

export function listBackups(dir: string): BackupInfo[] {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => f.startsWith(PREFIX) && f.endsWith('.db'))
		.map((f) => {
			const st = fs.statSync(path.join(dir, f));
			return { file: f, size: st.size, createdAt: st.mtimeMs };
		})
		.sort((a, b) => b.createdAt - a.createdAt);
}

/** Keeps the newest `keep` automatic backups; manual and pre-migration backups are kept. */
export function pruneBackups(dir: string, keep: number): string[] {
	const auto = listBackups(dir).filter((b) => b.file.endsWith('-auto.db'));
	const removed: string[] = [];
	for (const b of auto.slice(keep)) {
		fs.rmSync(path.join(dir, b.file), { force: true });
		removed.push(b.file);
	}
	return removed;
}
