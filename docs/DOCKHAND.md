# Deploying with Dockhand

This guide deploys 8star Grocery List as a **Git-based Compose stack** in
[Dockhand](https://github.com/Finsys/dockhand). The app is reachable **only** on your private
network or VPN; nothing is exposed publicly.

**The Compose for this household's stack** is [`deploy/dockhand-compose.yaml`](../deploy/dockhand-compose.yaml)
(`192.168.2.229:3008`, accent `#2563EB`, volume `8star-grocery-data`). Paste it into the stack
and add the stack variable `APP_VERSION` (e.g. `1.4.0`). That one variable picks the Git tag that
is built (`v<APP_VERSION>`), the image tag and the build argument; updating is: release → change
`APP_VERSION` → **Pull & redeploy** ([RELEASE.md](RELEASE.md)). The rest of this guide describes
the generic, variable-driven `compose.yaml`, which works the same way.

> Dockhand's menu labels differ slightly between versions. The steps follow its Git stack
> workflow: clone the repository, load the env file and stack variables, then run
> `docker compose up` on `compose.yaml`. If a label differs in your version, look for the
> equivalent option.

| Setting         | Value                                                                                 |
| --------------- | ------------------------------------------------------------------------------------- |
| Repository      | `https://github.com/TimoM84/8star-grocery-list`                                       |
| Branch          | `claude/8star-grocery-list-v1-ks9kyj` (the default branch, where releases are merged) |
| Compose file    | `compose.yaml`                                                                        |
| Stack / project | `8star-grocery` (fixed by `name:` in `compose.yaml`)                                  |
| Service         | `app`                                                                                 |
| Data volume     | `8star-grocery-data`                                                                  |

## 1. Prerequisites

- A Docker host managed by Dockhand (Docker Engine 24+ with Compose v2).
- The host can reach GitHub (to clone and to download the prebuilt SQLite module) and the npm
  registry, because the image is built on the host. Without internet access, see §8.
- The host's LAN or VPN IP address, e.g. `192.168.1.10` or a Tailscale address `100.x.y.z`.

## 2. Add the repository

1. In Dockhand, open **Git repositories** (under Settings or Stacks, depending on the version) and
   add `https://github.com/TimoM84/8star-grocery-list`.
2. The repository is public, so no token is needed. (If you make it private, add a fine-grained
   token with read-only Contents access here; the image build also fetches the Git tag from
   GitHub, which then needs the same access on the Docker host.)
3. Branch: `claude/8star-grocery-list-v1-ks9kyj`. If you later rename the default branch (for
   example to `main`), change it here as well.

## 3. Create the stack

1. **Stacks → Create/Add stack → From Git repository.**
2. Select the repository and branch, compose file `compose.yaml`, stack name `8star-grocery`.
3. **Environment variables.** Add these as stack variables (Dockhand stores them encrypted), or
   point the env file option at a `.env` you manage. `.env.example` lists them all:

   | Variable                | Example                    | Meaning                                                                      |
   | ----------------------- | -------------------------- | ---------------------------------------------------------------------------- |
   | `BIND_ADDRESS`          | `192.168.1.10`             | **Required.** LAN or VPN IP to listen on. Default `127.0.0.1` (host-only)    |
   | `HOST_PORT`             | `3000`                     | Host port                                                                    |
   | `APP_PRIMARY_COLOR`     | `#2563EB`                  | Accent color of the whole app (six-digit hex). Default `#1D7F46` (green)     |
   | `ORIGIN`                | `https://boodschappen.lan` | URL users open, when behind an HTTPS reverse proxy                           |
   | `PROTOCOL_HEADER`       | `x-forwarded-proto`        | Only behind a reverse proxy                                                  |
   | `HOST_HEADER`           | `x-forwarded-host`         | Only behind a reverse proxy                                                  |
   | `TZ`                    | `Europe/Amsterdam`         | Time zone for logs                                                           |
   | `BACKUP_INTERVAL_HOURS` | `24`                       | Automatic backups (0 = off)                                                  |
   | `BACKUP_KEEP`           | `14`                       | Automatic backups kept                                                       |
   | `DATA_VOLUME`           | `8star-grocery-data`       | Docker volume with the database — **never change it on an existing install** |
   | `APP_VERSION`           | `1.4.0`                    | Release to run: builds Git tag `v<version>`, tags the image, sets the label  |

   ⚠️ Never set `BIND_ADDRESS` to `0.0.0.0` on a host that has a public interface, and never add
   a port forward on your router. The app has no login by design.

4. **Deploy.** Dockhand runs `docker compose up`. Because the compose file uses
   `pull_policy: build`, the image is built on every deploy from the Git tag `v<APP_VERSION>` on
   GitHub (not from the checked-out branch), 1–3 minutes the first time.
5. Wait until the container shows **healthy** (healthcheck on `/api/health`).
6. Open `http://<BIND_ADDRESS>:<HOST_PORT>` from a device on the LAN or VPN.

## 4. Accent color (`APP_PRIMARY_COLOR`)

The color is read when the container starts, not when the image is built:

1. Change `APP_PRIMARY_COLOR` in Dockhand's stack variables, e.g. `#2563EB` (blue) or `#F97316`
   (orange). `#RRGGBB` or `RRGGBB` are accepted. In a `.env` file, write it with quotes:
   `APP_PRIMARY_COLOR="#2563EB"`.
2. **Redeploy / recreate** the stack. No rebuild is needed; the data volume is untouched.
3. Open the app online once. The page, the browser bar, the PWA manifest and the app icons follow
   the new color. Installed apps show the new color in-app right away; Android may keep the old
   home-screen icon until it refreshes the installed app (usually within a day).

The app derives accessible light and dark variants automatically (WCAG AA contrast for text and
buttons), so very light or dark colors are adjusted where needed. Warning, error and success
colors never change. An invalid value is logged
(`APP_PRIMARY_COLOR "…" is not a six-digit hex color`) and the default green is used.

## 5. HTTPS (needed for installing and offline start)

Android installs PWAs and runs service workers only on **HTTPS** origins (or `localhost`). Over
plain `http://192.168.x.x`, the shared lists and realtime sync work, and edits made while the
connection drops are still queued. But the app can't be installed or opened while offline.
Beheer → App shows a warning in that case.

- **Tailscale:** `tailscale serve --bg --https=443 http://127.0.0.1:3000` on the host gives
  `https://<host>.<tailnet>.ts.net` with a trusted certificate, reachable only inside your
  tailnet. Keep `BIND_ADDRESS=127.0.0.1` and set `ORIGIN` to that URL.
- **Existing reverse proxy** (Caddy, Traefik, Nginx Proxy Manager) on the LAN, with a certificate
  your phones trust. Proxy to `http://<BIND_ADDRESS>:<HOST_PORT>` and set `ORIGIN`,
  `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host`. Disable response
  buffering for `/api/events` (Server-Sent Events; Nginx: `proxy_buffering off;`). Allow request
  bodies up to 100 MB for full backups with photos (Nginx: `client_max_body_size 100m;`).

Don't put a public tunnel (e.g. Cloudflare Tunnel) in front of it.

## 6. Install on Android

Open the HTTPS URL in Chrome and choose **⋮ → App installeren** (or "Toevoegen aan
startscherm"). If Chrome offers it, Beheer → App also shows an **Installeren** button.

**Sharing text to the app (Web Share Target).** Once installed over HTTPS, “8star Boodschappen”
appears in Android's share sheet for text (e.g. a shopping list from WhatsApp or a recipe app).
Sharing opens the “Meerdere toevoegen” preview; nothing is added until you confirm, and shared
links are never opened. Limits: this only works for the installed PWA in Chromium-based
browsers on Android (not in a normal browser tab, not on iOS, not over plain HTTP), Android may
need a minute after installation (or a reinstall after an update) before the entry shows up,
and only text is accepted, not images or files. Without it, copy the text and use **Meerdere**
in the app. The app has no native home-screen widget; use the PWA shortcuts instead.

**Screen stays on in winkelstand.** The app asks for a Screen Wake Lock while winkelstand is open
and visible. It needs HTTPS; battery saver can refuse it. Switch it off in Beheer → Dit
apparaat.

## 7. Updating (e.g. v1.1.0 → v1.2.0)

Releases are merged into the deployed branch and tagged (see [RELEASE.md](RELEASE.md)).

1. **Optional safety backup** (the app also makes one automatically before any schema change):
   Beheer → Gegevens → _Back-up op server maken_, or
   `docker compose -p 8star-grocery exec app node scripts/backup.mjs`.
2. In Dockhand, set the stack variable `APP_VERSION` to the new release (e.g. `1.4.0`) and choose
   **Pull & redeploy**. Dockhand builds the Git tag `v1.4.0` as `8star-grocery-list:1.4.0` and
   recreates the container. The volume `8star-grocery-data` is kept.
   - Keep `DATA_VOLUME` unchanged. No new variables are needed.
   - v1.4.0 makes **English** the default language: choose **Nederlands** once in Settings →
     Features; it applies to every phone.
3. On first start the app migrates the database (v1.2.0: schema 3 → 4, which adds list types,
   product memory, notes, photos, bundles, stock and shopping rounds; v1.1.0 did 2 → 3).
   Beforehand it writes `/data/backups/grocery-<time>-pre-migration-v3.db`. The log shows
   `pre-migration backup written to …` and `database ready … (schema v4)`. A failed migration
   is rolled back completely and the app keeps the old database.
4. Wait for **healthy**. `/api/health` must report `"version":"1.2.0","schemaVersion":4`.
5. Phones show **"Nieuwe versie beschikbaar — Bijwerken"**. Tapping it reloads into the new
   version. Changes queued offline are kept and synced, also changes made with the old app
   version (the server still accepts every older op).
6. Optional: make a **full backup with photos** right away (Beheer → Gegevens → _Volledige
   back-up met foto’s (ZIP)_) and keep it off the server.

Automatic deploys: enable the stack's **webhook** in Dockhand (with a secret) and add it to the
GitHub repository (Settings → Webhooks, _push_ events), but only if GitHub can reach your Dockhand
instance. Otherwise redeploy manually after each release.

**Rolling back:** the app refuses to start on a database newer than it supports. To go back to
v1.1.0, in this order:

1. Make a full backup (ZIP) first if you want to keep changes made after the upgrade. Data that
   only v1.2 knows (photos, bundles, notes, stock, aliases) cannot be used by v1.1.
2. Redeploy the old version (`APP_VERSION=1.1.0`, which builds tag `v1.1.0`). The container keeps
   restarting because the database is schema v4; that is expected and harmless.
3. Restore the `pre-migration-v3` backup with `sh scripts/restore.sh <file>` (§9). It runs with the
   v1.1.0 image and starts the app on the restored database.

Don't restore first and downgrade afterwards: v1.2.0 would immediately migrate the restored file
again. Photo files in `/data/media` are left alone by a rollback; v1.1 ignores them.

## 8. Building the image without internet on the Docker host (optional)

```sh
# on a machine with internet, same CPU architecture as the server
git checkout v1.4.0
docker build --build-arg APP_VERSION=1.4.0 -t 8star-grocery-list:1.4.0 .
docker save 8star-grocery-list:1.4.0 | gzip > 8star-grocery-list-1.4.0.tar.gz
# on the server
gunzip -c 8star-grocery-list-1.4.0.tar.gz | docker load
```

Then deploy with `docker compose up -d --no-build`, or remove `build:`/`pull_policy:` from a copy
of the compose file used in Dockhand. A build host behind a TLS-intercepting proxy can pass its CA
as a build secret: `docker build --secret id=ca_bundle,src=/path/ca.crt .`

## 9. Backups, restore and data import

**Automatic backups.** The app makes an online backup every `BACKUP_INTERVAL_HOURS` (default
24 h) using SQLite's backup API, which is safe while running. Files go to `/data/backups` in the
volume. The newest `BACKUP_KEEP` automatic backups are kept; manual, pre-migration, pre-import
and pre-restore backups are never pruned. Each backup is one self-contained `.db` file that
passes `PRAGMA integrity_check`.

**Manual backup:** Beheer → Gegevens → _Back-up op server maken_, or
`docker compose -p 8star-grocery exec app node scripts/backup.mjs`.

**Photos** are stored next to the database in the same volume, under `/data/media` (one file
per photo, named by its id). The `.db` backups contain the photo _references_, not the image
files; the files are never deleted while a product uses them, and unused ones are removed only
after 30 days. To back up everything in one file, use the **full backup ZIP** (Beheer →
Gegevens → _Volledige back-up met foto’s (ZIP)_, or `GET /api/export?format=backup`).

**Copy backups off the host** (recommended, e.g. nightly):

```sh
docker run --rm -v 8star-grocery-data:/data -v "$PWD":/out alpine sh -c 'cp /data/backups/*.db /out/ && cp -r /data/media /out/'
curl -fsS -o 8star-backup.zip http://<BIND_ADDRESS>:<HOST_PORT>/api/export?format=backup   # data + photos
```

**Restore a backup** on the Docker host, from any directory that contains `scripts/restore.sh`
(Dockhand's checkout or your own clone):

```sh
sh scripts/restore.sh --list                                  # newest first
sh scripts/restore.sh grocery-2026-10-24_03-00-00-auto.db
```

`restore.sh` finds the stack's container, image and volume by itself (no version is hardcoded).
It then:

1. stops the app;
2. checks the backup's integrity;
3. saves the current database as `grocery-before-restore-<time>.db`;
4. puts the backup in place and starts the app.

If anything fails, the app is restarted with the unchanged database. Connected phones pick up
the restored data automatically, and changes they had not sent yet are sent afterwards.
Overrides: `COMPOSE_PROJECT`, `SERVICE`, `DATA_VOLUME`, `IMAGE`.

`restore.sh` restores the database; photo files in `/data/media` stay where they are, so
references keep working.

**Restore from a full backup ZIP or JSON export** (e.g. on a new server): Beheer → Gegevens →
Importeren → _Volledige export of back-up_ → choose the `.zip` (with photos) or `.json` →
_Alles vervangen_. A `pre-import` backup is written first; photos from the ZIP are validated and
written back to `/data/media`. See [IMPORT-EXPORT.md](IMPORT-EXPORT.md).

## 10. Troubleshooting

| Symptom                                          | Check                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Container restarts with `Invalid ORIGIN`         | `ORIGIN` must be empty or a full URL (`https://…`)                                                                |
| Unreachable from phone                           | `BIND_ADDRESS` must be the host's LAN/VPN IP, and the firewall must allow `HOST_PORT` from LAN/VPN                |
| Badge stays "Offline" behind a proxy             | SSE is buffered by the proxy: disable buffering for `/api/events`                                                 |
| Import fails with "te groot" behind a proxy      | Raise the proxy's request body limit to 100 MB                                                                    |
| Photos don't appear on other phones              | Beheer → Synchronisatie shows waiting or refused photos; photos upload when the server is reachable               |
| Screen still turns off in winkelstand            | Wake Lock needs HTTPS and is refused in battery saver; check Beheer → Dit apparaat                                |
| Color does not change                            | Recreate the container (not just restart), then reload the app online                                             |
| No install option and no offline start           | You're on plain HTTP (§5)                                                                                         |
| `database schema vN is newer than this app`      | You started an older image on a newer database; deploy the newer version or restore a matching backup             |
| `SQLITE_CANTOPEN` / permission denied in `/data` | `docker run --rm -v 8star-grocery-data:/data alpine chown -R 1000:1000 /data`                                     |
| Health                                           | `curl http://<BIND_ADDRESS>:<HOST_PORT>/api/health` shows version, schema version, connected devices, last backup |
