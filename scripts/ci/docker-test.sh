#!/usr/bin/env bash
# End-to-end Docker test, run by CI (and locally): upgrade from the previous release image
# (v1.1.0 by default) with real data, healthcheck, non-root user, runtime theme change without
# rebuild, imports, product photos on the /data volume, full backup ZIP round trip, persistence
# across container recreation, backup and restore.
#
#   bash scripts/ci/docker-test.sh
#
# Needs: docker with compose v2, git history containing BASE_REF (default tag v1.1.0), curl,
# python3.
# Uses its own volume (8star-ci-data) and port 3999; never touches 8star-grocery-data.
# BUILD="docker build ..." can override the image build command (e.g. behind a TLS proxy).
set -euo pipefail

BASE_REF="${BASE_REF:-v1.1.0}"
BASE_VERSION="${BASE_VERSION:-1.1.0}"
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
	git worktree remove --force "$WORK/base" >/dev/null 2>&1 || true
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

step "Build the previous release image ($BASE_REF)"
git worktree add --detach "$WORK/base" "$BASE_REF" >/dev/null
(cd "$WORK/base" && $BUILD --build-arg APP_VERSION="$BASE_VERSION" -t "8star-grocery-list:$BASE_VERSION" .)

step "Run v$BASE_VERSION and create household data"
APP_VERSION="$BASE_VERSION" docker compose up -d --no-build
wait_healthy
curl -fsS "$B/api/health" | json "d['version']" | grep -qx "$BASE_VERSION" || fail "v$BASE_VERSION did not start"
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
[ "$(echo "$HEALTH" | json "d['schemaVersion']")" = "4" ] || fail "migration did not run"
curl -fsS "$B/api/snapshot" >"$WORK/after.json"
python3 - "$WORK/before.json" "$WORK/after.json" <<'PY' || fail "data changed during upgrade"
import json, sys
a, b = (json.load(open(f)) for f in sys.argv[1:3])
# Everything the old version had is unchanged; new fields get safe defaults.
for key in ("lists", "categories", "products", "items"):
    assert len(a[key]) == len(b[key]), key
    for old, new in zip(a[key], b[key]):
        assert {k: new.get(k) for k in old} == old, (key, old, new)
assert {p["name"]: p["purchaseCount"] for p in b["products"]} == {"Halfvolle melk": 4, "Shampoo": 0}
assert all(l["kind"] == "grocery" for l in b["lists"])
assert all(p["stockStatus"] == "unknown" and p["photoId"] is None for p in b["products"])
print("upgrade preserved", len(b["products"]), "products,", len(b["items"]), "items")
PY
docker compose exec -T app sh -c 'ls /data/backups' | grep -q 'pre-migration-v3' || fail "no pre-migration backup"

step "Container hardening and endpoints"
[ "$(docker compose exec -T app id -u | tr -d '\r')" = 1000 ] || fail "not running as uid 1000"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/test/reset")" = 404 ] || fail "test reset reachable"
# An upgraded household starts in English (the default language) until it picks another one.
curl -fsS "$B/" | grep -q '<html lang="en">' || fail "shell"
curl -fsS "$B/" | grep -q '<title>8star Groceries</title>' || fail "shell title"
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

step "Product photo on the /data volume"
python3 - "$WORK/photo.png" <<'PY'
import struct, sys, zlib
w = h = 24
raw = b"".join(b"\x00" + bytes([30, 150, 80]) * w for _ in range(h))
def chunk(t, d):
    return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
PY
printf '<svg xmlns="http://www.w3.org/2000/svg"/>' >"$WORK/evil.svg"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$B/api/media/ci-evil" -H 'content-type: application/octet-stream' --data-binary @"$WORK/evil.svg")" = 415 ] ||
	fail "SVG upload must be refused"
curl -fsS -X PUT "$B/api/media/ci-photo" -H 'content-type: application/octet-stream' --data-binary @"$WORK/photo.png" >/dev/null || fail "photo upload"
curl -fsS -X POST "$B/api/ops" -H 'content-type: application/json' \
	-d "{\"clientId\":\"ci\",\"protocol\":2,\"ops\":[{\"id\":\"ci-photo-op\",\"at\":$NOW,\"type\":\"product.setPhoto\",\"productId\":\"ci-p-melk\",\"mediaId\":\"ci-photo\"}]}" >/dev/null
docker compose exec -T app sh -c 'ls /data/media' | grep -q 'ci-photo.png' || fail "photo not stored under /data/media"
curl -fsS -D "$WORK/media.h" -o /dev/null "$B/api/media/ci-photo" || fail "photo not served"
grep -qi 'content-type: image/png' "$WORK/media.h" || fail "photo content type"

step "Full backup ZIP (data + photos) round trip"
curl -fsS "$B/api/export?format=backup" -o "$WORK/backup.zip"
python3 - "$WORK/backup.zip" <<'PY' || fail "backup ZIP incomplete"
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
names = set(z.namelist())
assert {"manifest.json", "export.json", "media/ci-photo.png"} <= names, names
m = json.loads(z.read("manifest.json"))
assert m["format"] == "8star-grocery-backup", m
print("backup contains", sorted(names))
PY
docker compose exec -T app sh -c 'rm -f /data/media/ci-photo.png'
curl -fsS -X POST "$B/api/import?kind=json&mode=replace" -H 'content-type: application/octet-stream' \
	-H 'x-confirm-replace: VERVANGEN' --data-binary @"$WORK/backup.zip" | json "d['ok']" | grep -qx True || fail "backup ZIP restore"
curl -fsS -o /dev/null "$B/api/media/ci-photo" || fail "photo not restored from the backup ZIP"

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
curl -fsS -o /dev/null "$B/api/media/ci-photo" || fail "photo lost after recreation"

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
