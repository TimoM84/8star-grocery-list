# 8star Grocery List

A self-hosted, offline-first grocery list for the whole household. It's a Progressive Web App
built for Android phones, syncs in realtime between devices and runs as a single Docker
container on your private network or VPN. No accounts, no cloud services, no telemetry.

The UI speaks English (default), Dutch, German, French and Spanish, chosen once for the whole
household in Settings. Code and documentation are in English.

<p>
  <img src="docs/screenshots/list-light.png" width="200" alt="Main list, light mode" />
  <img src="docs/screenshots/list-dark.png" width="200" alt="Main list, dark mode" />
  <img src="docs/screenshots/suggestions.png" width="200" alt="Suggestions" />
  <img src="docs/screenshots/data.png" width="200" alt="Import and export" />
  <img src="docs/screenshots/theme-blue-light.png" width="200" alt="APP_PRIMARY_COLOR=#2563EB" />
</p>

<p>
  <img src="docs/screenshots/settings-language.png" width="200" alt="Settings: language for the whole household" />
  <img src="docs/screenshots/list-german.png" width="200" alt="The same list in German" />
  <img src="docs/screenshots/shopping-light.png" width="200" alt="Shopping mode" />
  <img src="docs/screenshots/already-on-list.png" width="200" alt="Already on the list: duplicate choices" />
  <img src="docs/screenshots/actions-dark.png" width="200" alt="Item actions in the shop, dark mode" />
  <img src="docs/screenshots/bundle.png" width="200" alt="Adding a bundle" />
  <img src="docs/screenshots/several.png" width="200" alt="Pasting several lines" />
  <img src="docs/screenshots/shopping-dark.png" width="200" alt="Shopping mode, dark mode" />
  <img src="docs/screenshots/edit.png" width="200" alt="Edit sheet with note and substitute" />
</p>

Screenshots are produced by the Playwright suite: `e2e/readme-screenshots.spec.ts` writes the
ones above to `screenshots/readme/` (refreshed for v1.4.0, in English, the default language), and
the layout audits write many more to `screenshots/`.

## Features

Screen labels below are quoted from the Dutch interface, where most of them were first built;
the English interface (the default) uses the same structure, e.g. **Beheer** is **Settings** and
**Winkelstand** is **shopping mode**.

**Shopping list**

- Large “What do we need?” (“Wat hebben we nodig?”) input. Add with Enter or the + button. Focus stays in the field
  for fast consecutive entry.
- Quantities and units are understood while typing, in every language: `2 milk`, `500 g mince`,
  `1.5 kg potatoes`, `eggs x10`, `3 Flaschen Wasser`, `1,5 kg aardappelen`.
- Live autocomplete from every product you ever added, ranked by frequency, recency and favourites.
- Duplicates are prevented, ignoring case and whitespace (` HALFVOLLE   melk` = `Halfvolle melk`).
- Tap the circle on the left to tick an item off (a 56 × 56 px touch area). Completed items turn
  grey and move into a collapsible section; tap the circle again to put an item back on the
  list, it then counts as newly added. Tapping the name, quantity or the rest of the row opens
  the editor (in winkelstand: the actions) and never ticks anything off.
- Always-visible sort control: **Nieuwste ↓ · Oudste ↑ · A–Z** (case- and accent-insensitive). The choice is
  remembered per device.
- Optional grouping by category, in a category order you set (e.g. the walking route of your
  supermarket).
- Edit name, quantity (stepper), unit (chips), category, favourite and list in one bottom sheet.
- Delete with confirmation. Quick **Ongedaan maken** (undo) for tick-off, put-back, delete, move
  and clearing, without ever counting a purchase wrongly.
- Multiple independent lists (e.g. Supermarkt, Drogist, Markt). Move items between lists.

**In the shop (1.2)**

- **Winkelstand**: a calm shopping mode with large rows, the remaining count, a fixed row order
  while you shop (ticked rows stay put until you tidy them) and an optional screen wake lock.
  Items others add meanwhile wait behind a banner and get a “Nieuw” badge.
- **Shared rounds**: when someone starts shopping, others see it and can join. Items can be
  claimed (“Ik pak dit”) for 20 minutes so two people don't fetch the same thing. Turn sharing
  off per device in Beheer.
- **Niet verkrijgbaar** moves an item to its own section without counting a purchase;
  **Deels gekocht** records what you got and keeps the rest on the list.
- Per-item notes, “vervanging mag” with a substitute note, and product photos shown as a small
  thumbnail.

**Quantities and product memory (1.2)**

- Adding something that is already on the list asks: add extra (atomic increment, so two phones
  adding at once both count), set the quantity, or cancel. If it is on another list: add here
  too or move it.
- Products remember aliases, a usual quantity, a preferred list, a fixed note, a photo and a
  stock state (enough / low / out). The walking route is set per list.
- “Niet nu” snoozes are shared by the household.

**Bundles, checklists and pasting (1.2)**

- **Bundels**: reusable sets (e.g. “Pasta-avond”) added with a servings stepper; discrete units
  are rounded up with a visible warning and per-line choices for items already on the list.
- **Checklists**: a list kind with a fixed order and reset, which never counts as a purchase.
- Paste several lines at once (bullets are stripped, commas are kept) or share text from another
  app to 8star (Android Web Share Target), always with a preview first.

**History and suggestions**

- Every activation and purchase cycle is stored, so the full history is preserved.
- Per product: first added, times bought, last bought, average interval, frequency per month and
  estimated next purchase.
- **Misschien nodig**: local predictions once a product has at least 3 purchases. Never added
  automatically. One tap adds a suggestion; “Niet nu” hides it for a while.
- Favourites, frequently bought products, searchable product history and purchase timeline.

**Import, export and external AI** (Beheer → Gegevens)

- **Backup ZIP** (1.2): data plus product photos, restorable in one step.
- Versioned, complete JSON export with stable ids and ISO 8601 timestamps. Restore it fully
  (**Alles vervangen**, with an automatic pre-import backup and confirmation) or **merge** it into
  existing data.
- CSV export of purchases, products and statistics, or everything as a ZIP. CSV import of
  products and purchase history.
- Every import shows a preview first, validates the whole file, detects duplicates, runs in one
  transaction and reports the result in plain language. See [docs/IMPORT-EXPORT.md](docs/IMPORT-EXPORT.md).
- **AI-suggesties**: analyse your export with ChatGPT, another AI tool or Python and import the result.
  Suggestions are shown separately from the local predictions, accepted or dismissed with one
  tap, and never touch the list or history by themselves. See
  [docs/AI-RECOMMENDATIONS.md](docs/AI-RECOMMENDATIONS.md).
- **Suggesties tonen** (Beheer → Functies, formerly _AI-functies tonen_): one switch for the
  whole household. Off hides every suggestion on all devices: _Misschien nodig_ on the list and
  the Suggesties page, the predicted next purchase, AI-suggesties, AI import, AI-opdracht and
  the suggestion badge (the tab is then called _Snelkeuze_ and keeps bundles, stock and
  favourites). Autocomplete while typing keeps working. Nothing is deleted, and switching it on
  brings everything back. On by default; a household that had AI switched off has it off.
- **Meerdere toevoegen tonen** (Beheer → Functies): off hides the button for entering several
  products at once, also in winkelstand. A multi-line paste then only takes the first line and
  shared text adds nothing. Adding one product always works. On by default.

**Five languages**

- Settings → Features → **Language**: English (default), Nederlands, Deutsch, Français, Español.
  One choice for the whole household; every phone switches live, also offline-queued. Screens,
  messages from the server, import reports, dates and numbers, the installed app's name and the
  AI prompt follow it. Names you typed stay as they are; the seeded list and categories and the
  units are shown translated. CSV and backup formats don't change. See
  [docs/SYNC.md](docs/SYNC.md#household-settings-v13-language-since-v14).
- Upgrading from 1.3 or older switches the app to English once: pick **Nederlands** in
  Settings → Features.

**One accent color for the whole app**

- `APP_PRIMARY_COLOR` in Docker Compose/Dockhand (e.g. `"#2563EB"`) restyles buttons, sort control,
  navigation, focus rings, suggestions, the PWA manifest and the app icons. It is applied at
  runtime, so recreating the container is enough. Accessible light and dark variants are derived
  automatically; warning and error colors stay as they are.

**Sync and offline**

- Realtime updates on every device via Server-Sent Events.
- Works fully offline. Changes are queued durably in IndexedDB and synced automatically when the
  network or VPN returns.
- Idempotent operations with unique ids, server-side duplicate merging, field-level
  last-writer-wins with user notification, and a visible sync log, so no data is lost silently.
  See [docs/SYNC.md](docs/SYNC.md).

**PWA and mobile UX**

- Installable on Android, standalone display, maskable icons, offline app start, service worker
  update prompt.
- Portrait-first one-thumb layout. Touch targets are ≥ 48 × 48 px. No dropdowns, no hamburger menu,
  bottom navigation.
- Respects safe areas and gesture navigation. The Android back gesture closes sheets.
- The layout stays usable with the keyboard open; the bottom navigation steps aside while typing.
- Automatic light/dark mode, subtle animations, `prefers-reduced-motion` support. Survives large
  system font sizes (tested at 160 %) and narrow screens down to 320 px.

## Architecture

```
┌──────────── Android / browser (PWA) ────────────┐        ┌───────── Docker container ─────────┐
│ Svelte 5 UI ── app state ── SyncEngine          │  HTTP  │ SvelteKit (adapter-node)           │
│                    │  optimistic reducer        │ ─────▶ │  POST /api/ops   (idempotent ops)  │
│                    │  IndexedDB: snapshot+queue │ ◀───── │  GET  /api/snapshot                │
│ Service worker: cached app shell                │  SSE   │  GET  /api/events (change seq)     │
└─────────────────────────────────────────────────┘ ◀───── │ GroceryStore ── SQLite (WAL) /data │
                                                           └────────────────────────────────────┘
```

- **SvelteKit 2 + Svelte 5 + TypeScript + Tailwind CSS 4**, built with `adapter-node`. The UI is
  a client-rendered app shell (`ssr = false`), so one cached shell serves every route offline.
- **SQLite** via `better-sqlite3`: WAL mode, foreign keys, versioned migrations
  (`PRAGMA user_version`) that run automatically at startup, and a pre-migration backup.
- **Shared domain code** (`src/lib/shared`) is used by both server and client: op validation,
  statistics, sorting, autocomplete and the optimistic reducer.
- Lightweight on purpose: one container, one SQLite file, no external services.

```
src/
  lib/shared/     types, ops protocol, reducer, statistics, selectors, text/quantity parsing
  lib/server/     db + migrations, GroceryStore (op handlers, undo, history), SSE hub, backups
  lib/client/     SyncEngine, IndexedDB, app state, PWA, toasts, modal history handling
  lib/components/ UI components (rows, sheets, sort control, navigation…)
  routes/         / (Lijst), /suggesties, /historie, /beheer, /api/*
  service-worker.ts
tests/            Vitest unit + integration (store, imports, sync engine, backups, release script)
e2e/              Playwright: CRUD, lists, history, sync, offline, imports, AI, theme, PWA, layout
```

### Data model

| Table                | Purpose                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `lists`              | Shopping lists with order                                                         |
| `categories`         | Categories with configurable order (Dutch defaults seeded)                        |
| `products`           | Unique products (`name_key` = lower-cased, whitespace-collapsed), favourite flag  |
| `items`              | A product on a list: status, quantity, unit, `activated_at`, `completed_at`       |
| `cycles`             | Every activation → purchase (`completed_at`) or cancellation: the full history    |
| `ops`                | Applied operations (idempotency + undo inverse), pruned after 90 days             |
| `id_aliases`         | Client ids merged into existing entities (concurrent duplicate adds)              |
| `ai_recommendations` | Imported external AI suggestions (open/accepted/dismissed), separate from history |
| `media`              | Product photo metadata (files live in `/data/media`)                              |
| `product_aliases`    | Alternative names that resolve to a product                                       |
| `snoozes`            | Shared “Niet nu” per product                                                      |
| `bundles`            | Bundles with default servings                                                     |
| `bundle_lines`       | Products, quantities and units per bundle                                         |
| `rounds`             | Shopping rounds per list (one open round per list)                                |
| `round_participants` | Devices in a round, with heartbeat                                                |
| `claims`             | “Ik pak dit” claims with expiry                                                   |
| `meta`               | Global change sequence, data epoch and household settings (`setting.*`)           |

Schema 4 (1.2) also adds list kind and walking route, product defaults/stock/photo, item notes,
substitutes, position and `quantity_rev`, and requested/purchased quantities per cycle.

## Development

Requirements: Node.js 22.

```sh
npm install
npm run dev              # http://localhost:5173 (data in ./data)
npm run check            # svelte-check / TypeScript
npm run lint             # Prettier + ESLint
npm run test:unit        # Vitest unit + integration tests
npm run build            # production build into ./build
npm run test:e2e         # Playwright against the production build (run build first)
npm run test:all         # everything above
```

Playwright starts the built server on port 4173 with a throw-away data directory and
`E2E_TEST_MODE=1`, which enables a reset endpoint that returns 404 in normal deployments. Mobile
layout screenshots are written to `screenshots/` (in CI they are uploaded as the
`mobile-screenshots` artifact).

## Deployment

The full guide is in **[docs/DOCKHAND.md](docs/DOCKHAND.md)**: Dockhand setup, HTTPS options,
updating, backups, restore and troubleshooting.

Quick start with plain Docker Compose:

```sh
cp .env.example .env        # set BIND_ADDRESS to the server's LAN/VPN IP
docker compose up -d --build
curl http://<BIND_ADDRESS>:3000/api/health
```

- Multi-stage image on `node:22-bookworm-slim`, running as the unprivileged `node` user (uid 1000)
  with a read-only root filesystem, all capabilities dropped and `no-new-privileges`.
- SQLite lives in the named volume `8star-grocery-data` (`/data`), with automatic backups in
  `/data/backups`.
- Healthcheck on `/api/health`, `restart: unless-stopped`, graceful shutdown with a WAL
  checkpoint.
- The port is bound to `BIND_ADDRESS` (default `127.0.0.1`), never to a public interface.

### Configuration

| Variable                              | Default                                      | Description                                   |
| ------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| `BIND_ADDRESS`                        | `127.0.0.1`                                  | Host interface to publish on (LAN/VPN IP)     |
| `HOST_PORT`                           | `3000`                                       | Host port                                     |
| `ORIGIN`                              | –                                            | Public URL when behind an HTTPS reverse proxy |
| `PROTOCOL_HEADER`                     | –                                            | e.g. `x-forwarded-proto` behind a proxy       |
| `HOST_HEADER`                         | –                                            | e.g. `x-forwarded-host` behind a proxy        |
| `APP_PRIMARY_COLOR`                   | `#1D7F46`                                    | Accent color (six-digit hex), runtime         |
| `TZ`                                  | `Europe/Amsterdam`                           | Time zone                                     |
| `BACKUP_INTERVAL_HOURS`               | `24`                                         | Automatic backup interval, `0` disables       |
| `BACKUP_KEEP`                         | `14`                                         | Number of automatic backups to keep           |
| `DATA_VOLUME`                         | `8star-grocery-data`                         | Docker volume name                            |
| `DATA_DIR` / `DB_PATH` / `BACKUP_DIR` | `/data`, `/data/grocery.db`, `/data/backups` | Paths inside the container                    |

### Backups and restore

```sh
docker compose exec app node scripts/backup.mjs              # consistent online backup
sh scripts/restore.sh --list                                 # available backups
sh scripts/restore.sh grocery-2026-10-24_03-00-00-auto.db    # stop, verify, swap, start
```

Details and the manual procedure are in [docs/DOCKHAND.md](docs/DOCKHAND.md#9-backups-restore-and-data-import).

### HTTPS

Android requires HTTPS to install the app and to start it offline. Over plain HTTP on a LAN IP,
the shared list and realtime sync work, but installation and offline start don't. The easiest
private option is `tailscale serve`. See [docs/DOCKHAND.md](docs/DOCKHAND.md#5-https-needed-for-installing-and-offline-start).

## Releases

Merge the release PR → **Actions → Release → Run workflow** with the version (it waits for CI
on that commit, then tags and publishes the GitHub Release with the changelog notes) → set
`APP_VERSION` in Dockhand → **Pull & redeploy**. `bash scripts/release.sh vX.Y.Z` does the same
from a terminal. See [docs/RELEASE.md](docs/RELEASE.md).

## Security model

This app has no authentication by design. Anyone who can reach it can read and change the lists.
Keep it reachable only on your private network or VPN: bind to a LAN/VPN address, add no router
port forwards and no public tunnels. The server validates every operation, sets strict security
headers including a hash-based CSP, and never contacts external services.

## Testing status

See [CHANGELOG.md](CHANGELOG.md) for what is covered. Mobile behaviour was verified with
Playwright's Chromium device emulation at 320/360/390/430/412 px in portrait and landscape,
light and dark, at 130 % and 160 % font scale, and with a simulated keyboard-open viewport. It
was **not** tested on a physical Samsung Galaxy A57 or Google Pixel 10. The 1.2 features (Wake
Lock, camera capture, Web Share Target) were tested in Chromium only; Share Target needs an
installed PWA served over HTTPS on Android.

## License

[MIT](LICENSE) © 2026 Timo Manders. Third-party dependencies keep their own licenses.
