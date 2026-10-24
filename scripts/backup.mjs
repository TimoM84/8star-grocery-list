// Consistent online SQLite backup (safe while the app runs; uses the SQLite backup API).
//
//   docker compose exec app node scripts/backup.mjs            -> /data/backups/grocery-<time>-manual.db
//   docker compose exec app node scripts/backup.mjs /data/x.db -> custom target
//
// Locally: DATA_DIR=./data node scripts/backup.mjs
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, 'grocery.db'));
const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(dataDir, 'backups'));

if (!fs.existsSync(dbPath)) {
	console.error(`Database not found: ${dbPath}`);
	process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const target = path.resolve(process.argv[2] || path.join(backupDir, `grocery-${stamp}-manual.db`));
fs.mkdirSync(path.dirname(target), { recursive: true });

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 5000');
await db.backup(target);
db.close();

// Verify the copy before reporting success.
const check = new Database(target);
check.pragma('journal_mode = DELETE'); // single self-contained file
const ok = check.pragma('integrity_check', { simple: true });
const version = check.pragma('user_version', { simple: true });
check.close();
if (ok !== 'ok') {
	console.error(`Backup written but integrity check failed: ${ok}`);
	process.exit(2);
}
console.log(`Backup OK (schema v${version}): ${target}`);
