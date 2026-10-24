import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { DB } from './db';

const PREFIX = 'grocery-';

function stamp(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/** Unique file name, even for several backups within the same second. */
function backupFile(dir: string, label: string): string {
	const base = `${PREFIX}${stamp()}-${label}`;
	let file = path.join(dir, `${base}.db`);
	for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base}-${i}.db`);
	return file;
}

/**
 * Creates a consistent online backup using SQLite's backup API (safe while the app is
 * running and in WAL mode). Returns the file path.
 */
export async function createBackup(db: DB, dir: string, label = 'auto'): Promise<string> {
	fs.mkdirSync(dir, { recursive: true });
	const file = backupFile(dir, label);
	await db.backup(file);
	finalize(file);
	return file;
}

/** Makes a backup a single self-contained file (no -wal/-shm companions) and verifies it. */
function finalize(file: string) {
	const copy = new Database(file);
	try {
		copy.pragma('journal_mode = DELETE');
		const ok = copy.pragma('integrity_check', { simple: true });
		if (ok !== 'ok') throw new Error(`backup integrity check failed: ${ok}`);
	} finally {
		copy.close();
	}
}

/** Synchronous variant (VACUUM INTO) used before migrations, when nothing else runs yet. */
export function createBackupSync(db: DB, dir: string, label: string): string {
	fs.mkdirSync(dir, { recursive: true });
	const file = backupFile(dir, label);
	db.prepare('VACUUM INTO ?').run(file);
	finalize(file);
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
	const auto = listBackups(dir).filter((b) => /-auto(-\d+)?\.db$/.test(b.file));
	const removed: string[] = [];
	for (const b of auto.slice(keep)) {
		fs.rmSync(path.join(dir, b.file), { force: true });
		removed.push(b.file);
	}
	return removed;
}
