/** Process-wide singletons: database, store, SSE hub and maintenance timers. */

import { loadConfig, type Config } from './config';
import { openDatabase, schemaVersion, type DB } from './db';
import { GroceryStore } from './store';
import { EventHub } from './events';
import { createBackup, createBackupSync, listBackups, pruneBackups } from './backup';

export interface Runtime {
	config: Config;
	db: DB;
	store: GroceryStore;
	hub: EventHub;
	lastBackupAt: number | null;
	shutdown: () => void;
}

let runtime: Runtime | null = null;

function log(message: string) {
	console.log(`[8star] ${new Date().toISOString()} ${message}`);
}

export function getRuntime(): Runtime {
	if (runtime) return runtime;

	const config = loadConfig();
	const db = openDatabase(config.dbPath, {
		beforeMigrate: (d) => {
			const file = createBackupSync(d, config.backupDir, `pre-migration-v${schemaVersion(d)}`);
			log(`pre-migration backup written to ${file}`);
		}
	});
	log(`database ready at ${config.dbPath} (schema v${schemaVersion(db)})`);

	const store = new GroceryStore(db);
	const hub = new EventHub();
	store.onChange((seq) => hub.broadcast(seq));

	const timers: ReturnType<typeof setInterval>[] = [];
	const rt: Runtime = {
		config,
		db,
		store,
		hub,
		lastBackupAt: listBackups(config.backupDir)[0]?.createdAt ?? null,
		shutdown: () => {
			for (const t of timers) clearInterval(t);
			hub.closeAll();
			try {
				db.pragma('wal_checkpoint(TRUNCATE)');
				db.close();
				log('database closed');
			} catch {
				/* already closed */
			}
		}
	};

	if (config.backupIntervalHours > 0) {
		const intervalMs = config.backupIntervalHours * 60 * 60 * 1000;
		const runBackup = async () => {
			try {
				const file = await createBackup(db, config.backupDir, 'auto');
				rt.lastBackupAt = Date.now();
				const removed = pruneBackups(config.backupDir, config.backupKeep);
				log(`backup written to ${file}${removed.length ? `, pruned ${removed.length}` : ''}`);
			} catch (e) {
				log(`backup failed: ${(e as Error).message}`);
			}
		};
		// Back up shortly after start when the newest backup is older than the interval.
		if (!rt.lastBackupAt || Date.now() - rt.lastBackupAt > intervalMs) {
			setTimeout(runBackup, 10_000).unref();
		}
		const t = setInterval(runBackup, intervalMs);
		t.unref();
		timers.push(t);
	}

	const pruneTimer = setInterval(() => store.pruneOps(), 6 * 60 * 60 * 1000);
	pruneTimer.unref();
	timers.push(pruneTimer);
	store.pruneOps();

	let stopping = false;
	const stop = () => {
		if (stopping) return;
		stopping = true;
		rt.shutdown();
	};
	// adapter-node closes the HTTP server on these signals; closing SSE streams lets it exit fast.
	process.once('SIGTERM', () => hub.closeAll());
	process.once('SIGINT', () => hub.closeAll());
	process.once('sveltekit:shutdown' as 'exit', stop);
	process.once('exit', stop);

	runtime = rt;
	return rt;
}
