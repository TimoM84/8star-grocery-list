#!/bin/sh
# Restore a backup into the Docker volume. Run on the Docker host from the repository folder.
#
#   scripts/restore.sh grocery-2026-10-24_03-00-00-auto.db
#
# The file name refers to /data/backups inside the volume. Before restoring, the current
# database is kept as /data/backups/grocery-before-restore-<time>.db.
set -eu

BACKUP="${1:?usage: scripts/restore.sh <backup-file-name>}"
VOLUME="${DATA_VOLUME:-8star-grocery-data}"
IMAGE="${IMAGE:-8star-grocery-list:${APP_VERSION:-1.0.0}}"

echo "Stopping the app…"
docker compose stop app

echo "Restoring ${BACKUP} into volume ${VOLUME}…"
docker run --rm --user 1000:1000 -v "${VOLUME}:/data" -e BACKUP="${BACKUP}" --entrypoint sh "${IMAGE}" -c '
	set -eu
	test -f "/data/backups/${BACKUP}" || { echo "Backup /data/backups/${BACKUP} not found"; exit 1; }
	node -e "
		const D = require(\"better-sqlite3\");
		const db = new D(\"/data/backups/\" + process.env.BACKUP, { readonly: true });
		const r = db.pragma(\"integrity_check\", { simple: true });
		if (r !== \"ok\") { console.error(\"integrity check failed: \" + r); process.exit(1); }
		console.log(\"backup schema v\" + db.pragma(\"user_version\", { simple: true }) + \", integrity ok\");
	"
	STAMP=$(date -u +%Y-%m-%d_%H-%M-%S)
	if [ -f /data/grocery.db ]; then cp /data/grocery.db "/data/backups/grocery-before-restore-${STAMP}.db"; fi
	rm -f /data/grocery.db-wal /data/grocery.db-shm
	cp "/data/backups/${BACKUP}" /data/grocery.db
	echo "restored"
'

echo "Starting the app…"
docker compose start app
