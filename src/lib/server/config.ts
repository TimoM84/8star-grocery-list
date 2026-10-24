import path from 'node:path';

/** Runtime configuration from environment variables (see .env.example). */
export interface Config {
	dataDir: string;
	dbPath: string;
	backupDir: string;
	backupIntervalHours: number;
	backupKeep: number;
}

function int(value: string | undefined, fallback: number): number {
	const n = Number.parseInt(value ?? '', 10);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const dataDir = path.resolve(env.DATA_DIR || './data');
	return {
		dataDir,
		dbPath: path.resolve(env.DB_PATH || path.join(dataDir, 'grocery.db')),
		backupDir: path.resolve(env.BACKUP_DIR || path.join(dataDir, 'backups')),
		backupIntervalHours: int(env.BACKUP_INTERVAL_HOURS, 24),
		backupKeep: int(env.BACKUP_KEEP, 14)
	};
}
