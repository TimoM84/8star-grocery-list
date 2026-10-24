#!/bin/sh
# Restore a backup into the app's data volume. Run on the Docker host:
#
#   sh scripts/restore.sh grocery-2026-10-24_03-00-00-auto.db
#
# The file name refers to /data/backups inside the volume (list them with
# `sh scripts/restore.sh --list`). The image and volume are taken from the existing container
# of the Compose project, so this works for every release and from any directory.
# Before restoring, the current database is saved as /data/backups/grocery-before-restore-<time>.db.
set -eu

PROJECT="${COMPOSE_PROJECT:-8star-grocery}"
SERVICE="${SERVICE:-app}"

CONTAINER="$(docker compose -p "$PROJECT" ps -a -q "$SERVICE" 2>/dev/null | head -n 1)"
if [ -z "$CONTAINER" ]; then
	echo "No container for service '$SERVICE' in Compose project '$PROJECT'." >&2
	echo "Set COMPOSE_PROJECT/SERVICE, or deploy the stack first." >&2
	exit 1
fi
# The exact image the app runs (image id, so a re-tagged image can never be picked by mistake).
IMAGE="${IMAGE:-$(docker inspect -f '{{.Image}}' "$CONTAINER")}"
VOLUME="${DATA_VOLUME:-$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$CONTAINER")}"
if [ -z "$VOLUME" ]; then
	echo "Could not find the /data volume of container $CONTAINER." >&2
	exit 1
fi

run_in_volume() {
	docker run --rm --user 1000:1000 -v "${VOLUME}:/data" -w /app --entrypoint sh "$@"
}

if [ "${1:-}" = "--list" ]; then
	run_in_volume "$IMAGE" -c 'ls -1t /data/backups 2>/dev/null || true'
	exit 0
fi

BACKUP="${1:?usage: sh scripts/restore.sh <backup-file-name> | --list}"
case "$BACKUP" in
	*/* | *..*) echo "Give only the file name from /data/backups." >&2; exit 1 ;;
esac

echo "Project: $PROJECT  Volume: $VOLUME"
echo "Image:   $IMAGE"
echo "Stopping the app…"
docker compose -p "$PROJECT" stop "$SERVICE"

echo "Restoring ${BACKUP}…"
if ! run_in_volume -e BACKUP="$BACKUP" "$IMAGE" -c '
	set -eu
	test -f "/data/backups/${BACKUP}" || { echo "Backup /data/backups/${BACKUP} not found"; exit 1; }
	node -e "
		const D = require(\"better-sqlite3\");
		const db = new D(\"/data/backups/\" + process.env.BACKUP, { readonly: true });
		const r = db.pragma(\"integrity_check\", { simple: true });
		if (r !== \"ok\") { console.error(\"integrity check failed: \" + r); process.exit(1); }
		console.log(\"backup schema v\" + db.pragma(\"user_version\", { simple: true }) + \", integrity ok\");
		db.close();
	"
	STAMP=$(date -u +%Y-%m-%d_%H-%M-%S)
	if [ -f /data/grocery.db ]; then
		# Consistent copy including anything still in the WAL file.
		node -e "
			const D = require(\"better-sqlite3\");
			const db = new D(\"/data/grocery.db\");
			db.backup(process.argv[1]).then(() => { db.close(); console.log(\"current database saved as \" + process.argv[1]); });
		" "/data/backups/grocery-before-restore-${STAMP}.db"
	fi
	rm -f /data/grocery.db-wal /data/grocery.db-shm
	cp "/data/backups/${BACKUP}" /data/grocery.db.restoring
	mv /data/grocery.db.restoring /data/grocery.db
	echo "restored"
'; then
	echo "Restore failed; starting the app again with the unchanged database." >&2
	docker compose -p "$PROJECT" start "$SERVICE"
	exit 1
fi

echo "Starting the app…"
docker compose -p "$PROJECT" start "$SERVICE"
