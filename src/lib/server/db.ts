import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations';

export type DB = Database.Database;

export function schemaVersion(db: DB): number {
	return db.pragma('user_version', { simple: true }) as number;
}

export function latestSchemaVersion(): number {
	return migrations[migrations.length - 1].version;
}

/** Applies pending migrations, each in its own transaction. Returns the versions applied. */
export function migrate(db: DB): number[] {
	const applied: number[] = [];
	const current = schemaVersion(db);
	for (const m of migrations) {
		if (m.version <= current) continue;
		db.transaction(() => {
			db.exec(m.sql);
			db.pragma(`user_version = ${m.version}`);
		})();
		applied.push(m.version);
	}
	return applied;
}

export interface OpenOptions {
	/** Called before migrations run on an existing database (used for safety backups). */
	beforeMigrate?: (db: DB) => void;
}

/** Opens (or creates) the database with production pragmas and runs migrations. */
export function openDatabase(file: string, options: OpenOptions = {}): DB {
	if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
	const db = new Database(file);
	if (file !== ':memory:') db.pragma('journal_mode = WAL');
	db.pragma('synchronous = NORMAL');
	db.pragma('foreign_keys = ON');
	db.pragma('busy_timeout = 5000');

	const current = schemaVersion(db);
	if (current > latestSchemaVersion()) {
		db.close();
		throw new Error(
			`Database schema v${current} is newer than this app supports (v${latestSchemaVersion()}). Refusing to start.`
		);
	}
	if (current > 0 && current < latestSchemaVersion()) options.beforeMigrate?.(db);
	migrate(db);
	return db;
}
