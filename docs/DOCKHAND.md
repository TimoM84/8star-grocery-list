# Deploying with Dockhand

This guide deploys 8star Grocery List as a **Git-based Compose stack** in
[Dockhand](https://github.com/Finsys/dockhand). The app is reachable **only** on your private
network or VPN. Nothing is exposed publicly.

> Dockhand's menu labels differ a little between versions. The steps below follow its Git stack
> workflow: clone the repository, load the env file and stack variables, then run
> `docker compose up` on `compose.yaml`. If a label differs in your version, look for the
> equivalent option.

## 1. Prerequisites

- A Docker host managed by Dockhand (Docker Engine 24+ with Compose v2).
- The host reaches GitHub (to clone the repository) and the npm registry plus GitHub releases
  (to build the image; the prebuilt SQLite binary comes from GitHub). Without internet access,
  build the image elsewhere and load it with `docker load` (see §7).
- The host's LAN or VPN IP address, e.g. `192.168.1.10` or a Tailscale address `100.x.y.z`.

## 2. Add the repository

1. In Dockhand, open **Git repositories** (under Settings or Stacks, depending on the version) and
   add `https://github.com/TimoM84/8star-Grocery`.
2. The repository is private, so add credentials: a GitHub fine-grained personal access token with
   **read-only Contents** access to this repository is enough.
3. Branch: `main` (or the release branch you deploy from).

## 3. Create the stack

1. **Stacks → Create/Add stack → From Git repository.**
2. Select the repository and branch.
3. **Compose file path:** `compose.yaml`
4. **Stack name:** `8star-grocery` (matches `name:` in the compose file).
5. **Environment variables.** Add these as stack variables (Dockhand stores them encrypted), or
   point the env file option at a `.env` you manage. `.env.example` lists them all:

   | Variable                | Example                    | Meaning                                                                   |
   | ----------------------- | -------------------------- | ------------------------------------------------------------------------- |
   | `BIND_ADDRESS`          | `192.168.1.10`             | **Required.** LAN or VPN IP to listen on. Default `127.0.0.1` (host-only) |
   | `HOST_PORT`             | `3000`                     | Host port                                                                 |
   | `ORIGIN`                | `https://boodschappen.lan` | URL users open, when behind an HTTPS reverse proxy                        |
   | `PROTOCOL_HEADER`       | `x-forwarded-proto`        | Only behind a reverse proxy                                               |
   | `HOST_HEADER`           | `x-forwarded-host`         | Only behind a reverse proxy                                               |
   | `TZ`                    | `Europe/Amsterdam`         | Time zone for logs                                                        |
   | `BACKUP_INTERVAL_HOURS` | `24`                       | Automatic backups (0 = off)                                               |
   | `BACKUP_KEEP`           | `14`                       | Automatic backups kept                                                    |
   | `DATA_VOLUME`           | `8star-grocery-data`       | Name of the Docker volume with the database                               |

   ⚠️ Never set `BIND_ADDRESS` to `0.0.0.0` on a host that has a public interface. Never add a
   port forward on your router.

6. **Deploy.** Dockhand runs `docker compose up`. Because the compose file uses
   `pull_policy: build`, the image is built from the checked-out source on every deploy. The
   first build takes 1–3 minutes.
7. Wait until the container shows **healthy**. The image has a healthcheck on `/api/health`.
8. Open `http://<BIND_ADDRESS>:<HOST_PORT>` from a device on the LAN or VPN.

## 4. HTTPS (needed for installing and offline start)

Android installs PWAs and runs service workers only on **HTTPS** origins (or `localhost`).
Over plain `http://192.168.x.x` the shared lists and realtime sync work, and edits made while the
connection drops are still queued. But the app can't be installed or opened while offline. Beheer
→ App shows a warning in that case.

Pick whichever fits your network:

- **Tailscale:** run `tailscale serve --bg --https=443 http://127.0.0.1:3000` on the host. It gives
  you `https://<host>.<tailnet>.ts.net` with a trusted certificate, reachable only inside your
  tailnet. Keep `BIND_ADDRESS=127.0.0.1` and set `ORIGIN` to that URL.
- **Existing reverse proxy** (Caddy, Traefik, Nginx Proxy Manager) on the LAN with a certificate
  your phones trust, e.g. a DNS-01 Let's Encrypt certificate for an internal name or a private CA
  installed on the phones. Proxy to `http://<BIND_ADDRESS>:<HOST_PORT>`, set `ORIGIN`,
  `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host`, and disable response
  buffering for `/api/events` (Server-Sent Events). Nginx needs `proxy_buffering off;`. The app
  already sends `X-Accel-Buffering: no`.

Don't put a public tunnel (e.g. Cloudflare Tunnel) in front of it: the app has no
authentication by design.

## 5. Install on Android

Open the HTTPS URL in Chrome, then use **⋮ → App installeren** (or "Toevoegen aan startscherm").
If Chrome offers it, Beheer → App also shows an **Installeren** button. The app opens standalone,
follows the system light/dark mode and works offline.

## 6. Updating

1. Push or merge the new version to the deployed branch.
2. In Dockhand, open the stack and choose **Pull & redeploy** (or **Redeploy**). Dockhand pulls the
   repository, rebuilds the image (`pull_policy: build`) and recreates the container. The data
   volume is kept.
3. Automatic option: enable the stack's **webhook** in Dockhand (it needs a secret) and add the
   webhook URL to the GitHub repository (Settings → Webhooks, _push_ events). Only do this if
   GitHub can reach your Dockhand instance. Otherwise use Dockhand's auto-sync or polling if your
   version has it, or redeploy manually.

What happens during an update:

- Database migrations run automatically at startup. Before a migration, the app writes a
  `pre-migration-v<N>` backup to `/data/backups`.
- Open devices show **"Nieuwe versie beschikbaar — Bijwerken"**. Tapping it activates the new
  service worker and reloads. Queued offline changes are kept and synced afterwards.
- The app refuses to start on a database newer than it understands, which protects you from
  accidental downgrades. To roll back, restore the pre-migration backup (§8).

## 7. Building the image without internet on the Docker host (optional)

```sh
# on a machine with internet, same CPU architecture as the server
docker build -t 8star-grocery-list:1.0.0 .
docker save 8star-grocery-list:1.0.0 | gzip > 8star-grocery-list-1.0.0.tar.gz
# on the server
gunzip -c 8star-grocery-list-1.0.0.tar.gz | docker load
```

Then deploy with `docker compose up -d --no-build`, or remove `build:`/`pull_policy:` from a copy
of the compose file used in Dockhand.

If the build host sits behind a TLS-intercepting proxy, pass its CA as a build secret:
`docker build --secret id=ca_bundle,src=/path/ca.crt .`

## 8. Backups and restore

**Automatic.** The app makes an online backup every `BACKUP_INTERVAL_HOURS` (default 24 h) using
SQLite's backup API, which is safe while running. Backups go to `/data/backups` inside the volume.
The newest `BACKUP_KEEP` automatic backups are kept; manual and pre-migration backups are never
pruned.

**Manual.** Use Beheer → Gegevens → **Back-up op server maken**, or run in Dockhand's container
console or on the host:

```sh
docker compose -p 8star-grocery exec app node scripts/backup.mjs
```

Each backup is a single self-contained `.db` file and passes `PRAGMA integrity_check`.

**Copy backups off the host** (recommended, e.g. nightly):

```sh
docker run --rm -v 8star-grocery-data:/data -v "$PWD":/out alpine \
  sh -c 'cp /data/backups/*.db /out/'
```

**Restore** (on the host, from the stack's checkout directory, i.e. where Dockhand cloned the
repository or a clone of your own):

```sh
docker run --rm -v 8star-grocery-data:/data alpine ls /data/backups   # pick a file
DATA_VOLUME=8star-grocery-data scripts/restore.sh grocery-2026-10-24_03-00-00-auto.db
```

`restore.sh` stops the app, checks the backup's integrity, keeps the current database as
`grocery-before-restore-<time>.db`, removes stale `-wal`/`-shm` files, copies the backup into
place and starts the app. Connected devices pick up the restored data automatically. Changes
they had not sent yet are re-sent afterwards.

Manual restore without the script: stop the stack, then in the volume replace `grocery.db` with
the backup file, delete `grocery.db-wal` and `grocery.db-shm`, and start the stack. Files must
stay owned by uid 1000.

## 9. Troubleshooting

| Symptom                                          | Check                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Container restarts with `Invalid ORIGIN`         | `ORIGIN` must be empty or a full URL (`https://…`)                                                                          |
| Unreachable from phone                           | `BIND_ADDRESS` must be the host's LAN or VPN IP, and the host firewall must allow `HOST_PORT` from LAN/VPN                  |
| Badge stays "Offline" behind a proxy             | SSE is buffered by the proxy: disable buffering for `/api/events`                                                           |
| No install option and no offline start           | You're on plain HTTP (§4)                                                                                                   |
| `SQLITE_CANTOPEN` / permission denied in `/data` | Volume files must be owned by uid 1000: `docker run --rm -v 8star-grocery-data:/data alpine chown -R 1000:1000 /data`       |
| Health                                           | `curl http://<BIND_ADDRESS>:<HOST_PORT>/api/health` returns version, schema version, connected devices and last backup time |
