#!/usr/bin/env bash
# End-to-end Docker test, run by CI (and locally): upgrade from the v1.0.0 image with real data,
# healthcheck, non-root user, runtime theme change without rebuild, imports, persistence across
# container recreation, backup and restore.
#
#   bash scripts/ci/docker-test.sh
#
# Needs: docker with compose v2, git history containing the v1.0.0 commit, curl, python3.
# Uses its own volume (8star-ci-data) and port 3999; never touches 8star-grocery-data.
# BUILD="docker build ..." can override the image build command (e.g. behind a TLS proxy).
set -euo pipefail

V100_COMMIT="${V100_COMMIT:-0d218fa5b34d100e82816b1dfbd6f7248bb5a11e}"
export HOST_PORT="${HOST_PORT:-3999}" BIND_ADDRESS=127.0.0.1 DATA_VOLUME=8star-ci-data
export COMPOSE_PROJECT_NAME=8star-grocery
B="http://127.0.0.1:${HOST_PORT}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
VERSION="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n1)"
BUILD="${BUILD:-docker build}"
WORK="$(mktemp -d)"

step() { printf '\n=== %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; docker compose logs app | tail -50 >&2 || true; exit 1; }
cleanup() {
	docker compose down -v >/dev/null 2>&1 || true
	git worktree remove --force "$WORK/v100" >/dev/null 2>&1 || true
	rm -rf "$WORK"
}
trap cleanup EXIT

wait_healthy() {
	for _ in $(seq 1 60); do
		local id status
		id="$(docker compose ps -q app)"
		status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo starting)"
		[ "$status" = healthy ] && return 0
		sleep 2
	done
	fail "container did not become healthy"
}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

docker compose down -v >/dev/null 2>&1 || true

step "Build the original v1.0.0 image ($V100_COMMIT)"
git worktree add --detach "$WORK/v100" "$V100_COMMIT" >/dev/null
(cd "$WORK/v100" && $BUILD -t 8star-grocery-list:1.0.0 .)

step "Run v1.0.0 and create household data"
APP_VERSION=1.0.0 docker compose up -d --no-build
wait_healthy
curl -fsS "$B/api/health" | json "d['version']" | grep -qx 1.0.0 || fail "v1.0.0 did not start"
NOW=$(($(date +%s) * 1000))
DAY=86400000
OPS="{\"id\":\"ci-add\",\"at\":$((NOW - 30 * DAY)),\"type\":\"item.add\",\"itemId\":\"ci-melk\",\"productId\":\"ci-p-melk\",\"listId\":\"default\",\"name\":\"Halfvolle melk\",\"quantity\":2,\"unit\":\"l\",\"categoryId\":\"cat-zuivel\"}"
for k in 0 1 2 3; do
	T=$((NOW - (28 - k * 7) * DAY))
	OPS="$OPS,{\"id\":\"ci-c$k\",\"at\":$T,\"type\":\"item.complete\",\"itemId\":\"ci-melk\"},{\"id\":\"ci-r$k\",\"at\":$((T + 3600000)),\"type\":\"item.reactivate\",\"itemId\":\"ci-melk\"}"
done
OPS="$OPS,{\"id\":\"ci-list\",\"at\":$NOW,\"type\":\"list.create\",\"listId\":\"drogist\",\"name\":\"Drogist\"}"
OPS="$OPS,{\"id\":\"ci-add2\",\"at\":$NOW,\"type\":\"item.add\",\"itemId\":\"ci-sh\",\"productId\":\"ci-p-sh\",\"listId\":\"drogist\",\"name\":\"Shampoo\",\"quantity\":null,\"unit\":null,\"categoryId\":null}"
curl -fsS -X POST "$B/api/ops" -H 'content-type: application/json' -d "{\"clientId\":\"ci\",\"ops\":[$OPS]}" >/dev/null
curl -fsS "$B/api/snapshot" >"$WORK/before.json"
docker compose stop app >/dev/null

step "Build v$VERSION and upgrade in place (same volume)"
$BUILD --build-arg APP_VERSION="$VERSION" -t "8star-grocery-list:$VERSION" .
docker compose up -d --no-build
wait_healthy
HEALTH="$(curl -fsS "$B/api/health")"
echo "$HEALTH"
[ "$(echo "$HEALTH" | json "d['version']")" = "$VERSION" ] || fail "wrong version after upgrade"
[ "$(echo "$HEALTH" | json "d['schemaVersion']")" = "3" ] || fail "migration did not run"
curl -fsS "$B/api/snapshot" >"$WORK/after.json"
python3 - "$WORK/before.json" "$WORK/after.json" <<'PY' || fail "data changed during upgrade"
import json, sys
a, b = (json.load(open(f)) for f in sys.argv[1:3])
for key in ("lists", "categories", "products", "items"):
    assert a[key] == b[key], key
assert {p["name"]: p["purchaseCount"] for p in b["products"]} == {"Halfvolle melk": 4, "Shampoo": 0}
print("upgrade preserved", len(b["products"]), "products,", len(b["items"]), "items")
PY
docker compose exec -T app sh -c 'ls /data/backups' | grep -q 'pre-migration-v2' || fail "no pre-migration backup"

step "Container hardening and endpoints"
[ "$(docker compose exec -T app id -u | tr -d '\r')" = 1000 ] || fail "not running as uid 1000"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/test/reset")" = 404 ] || fail "test reset reachable"
curl -fsS "$B/" | grep -q '<html lang="nl">' || fail "shell"
curl -fsS "$B/manifest.webmanifest" | json "d['display']" | grep -qx standalone || fail "manifest"
curl -fsS -o /dev/null "$B/icons/icon-512.png" || fail "icon"
curl -fsS "$B/" | grep -q -- '--accent:#1d7f46' || fail "default theme missing"

step "Runtime theme: recreate with another color, no rebuild"
IMAGE_BEFORE="$(docker inspect -f '{{.Image}}' "$(docker compose ps -q app)")"
APP_PRIMARY_COLOR='#2563EB' docker compose up -d --no-build
wait_healthy
IMAGE_AFTER="$(docker inspect -f '{{.Image}}' "$(docker compose ps -q app)")"
[ "$IMAGE_BEFORE" = "$IMAGE_AFTER" ] || fail "image changed"
curl -fsS "$B/" | grep -q -- '--accent:#1d7f46' && fail "theme not applied"
ACCENT="$(curl -fsS "$B/manifest.webmanifest" | json "d['theme_color']")"
echo "blue accent: $ACCENT"
[ "$ACCENT" != "#1d7f46" ] || fail "manifest theme_color unchanged"
APP_PRIMARY_COLOR='not-a-color' docker compose up -d --no-build
wait_healthy
curl -fsS "$B/" | grep -q -- '--accent:#1d7f46' || fail "invalid color must fall back to default"
docker compose up -d --no-build
wait_healthy

step "Import: JSON export round trip (replace) and safety checks"
curl -fsS "$B/api/export?format=json" >"$WORK/export.json"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/import?kind=json&mode=replace" -H 'content-type: application/octet-stream' --data-binary @"$WORK/export.json")" = 428 ] ||
	fail "replace without confirmation must be refused"
curl -fsS -X POST "$B/api/import?kind=json&mode=replace" -H 'content-type: application/octet-stream' \
	-H 'x-confirm-replace: VERVANGEN' --data-binary @"$WORK/export.json" | json "d['ok']" | grep -qx True || fail "replace import"
curl -fsS "$B/api/export?format=json" >"$WORK/export2.json"
python3 - "$WORK/export.json" "$WORK/export2.json" <<'PY' || fail "round trip differs"
import json, sys
a, b = (json.load(open(f))["data"] for f in sys.argv[1:3])
assert a == b
print("round trip identical:", {k: len(v) for k, v in a.items()})
PY
docker compose exec -T app sh -c 'ls /data/backups' | grep -q 'pre-import' || fail "no pre-import backup"

step "Persistence across container recreation"
docker compose down
docker compose up -d --no-build
wait_healthy
curl -fsS "$B/api/snapshot" | grep -q '"name":"Halfvolle melk"' || fail "data lost after recreation"

step "Backup and restore with the v$VERSION image"
docker compose exec -T app node scripts/backup.mjs
F="$(docker compose exec -T app sh -c 'ls -t /data/backups | grep manual | head -n1' | tr -d '\r')"
curl -fsS -X POST "$B/api/ops" -H 'content-type: application/json' \
	-d "{\"clientId\":\"ci\",\"ops\":[{\"id\":\"ci-after\",\"at\":$NOW,\"type\":\"item.add\",\"itemId\":\"ci-k\",\"productId\":\"ci-p-k\",\"listId\":\"default\",\"name\":\"Na de back-up\",\"quantity\":null,\"unit\":null,\"categoryId\":null}]}" >/dev/null
(cd "$WORK" && sh "$ROOT/scripts/restore.sh" "$F")
wait_healthy
curl -fsS "$B/api/snapshot" | grep -q 'Na de back-up' && fail "restore did not roll back"
curl -fsS "$B/api/snapshot" | grep -q '"name":"Halfvolle melk"' || fail "restored data missing"

printf '\nALL DOCKER CHECKS PASSED\n'
