# Changelog

## Unreleased

### Added

- **AI-functies tonen** in Beheer → Functies: one switch for the whole household that hides
  every AI feature (the AI-suggesties section and its badge count, AI-bestand importeren, the
  Analyseren met AI block with the AI-opdracht, and the explanations). On by default, so
  upgrading changes nothing. Switching off only hides: imported suggestions stay stored and come
  back unchanged. The setting is stored on the server (`meta`, no schema change), synced to
  every device through the new `settings.update` op (sync protocol 3), works offline, and is
  part of the JSON export (`data.settings`) and the backup. **Alles vervangen** restores it;
  **Samenvoegen** and older files without settings leave it as it is.

## 1.2.0

Shopping in the store, honest quantities and product memory. Built on v1.1.0; every existing
feature is kept and existing data migrates automatically.

### Added

- **Winkelstand** (“Ik ga winkelen”): a compact top bar with list name, “Nog N producten”, a
  reachable add button and **Klaar**. Input, sorting and suggestions fold away (not removed).
  The order is frozen while shopping: ticked rows stay in place until “Afgevinkte inklappen”,
  items added on other devices wait behind “N nieuwe producten · Bekijken” and are marked
  **Nieuw**. Leaving ticks nothing.
- **Screen Wake Lock** during winkelstand, only while it is open and visible; re-acquired when
  the app returns to the foreground. Can be switched off in Beheer → Dit apparaat.
- **Shared rounds without accounts**: an optional device name and a random local device id.
  One active round per grocery list (race-safe), several participants, “Timo doet boodschappen”
  with **Meedoen** on other devices, explicit end for everyone. Ending a round books nothing.
  “Ik pak dit” claims are hints that expire after 20 minutes and never block buying. Presence
  is a heartbeat that goes stale; idle rounds end after 2 hours.
- **No silent quantity changes**: entering a product that is already on the list opens
  “Staat er al op: 2” with **1 extra**, **Wijzigen naar 1** or **Laat zo**. Without a typed
  amount it offers **Eén extra** where that makes sense. An unknown existing amount is never
  treated as 1, and only g↔kg and ml↔l are converted. “1 extra” is an atomic, idempotent server
  increment (two devices adding 1 to 2 give 4; a resent op counts once). Undo removes only your
  own increment and refuses with a message when someone changed the amount explicitly. The same
  rules apply to typing, autocomplete, suggestions, bundles, multiline paste and shared text.
- **Product memory**: usual quantity and unit (an explicit amount always wins), preferred list,
  manual alternative names (same product id; products are never merged automatically), a fixed
  product note, list-aware suggestions with a documented fallback, a notice when a product is
  active on another list (**Ook hier** / **Verplaatsen**), and a per-list walking route for the
  categories with the global order as fallback.
- **Shared “Niet nu”** with a clear end time (v1.1 per-device snoozes are migrated once).
- **Notes and substitutes**: a note for this purchase (cleared when the product is needed again
  later) next to the fixed product note, and “Ander merk of product mag” with an optional note.
- **Product photo** (one per product): camera or file, replace, remove, compact thumbnail in the
  row, tap to enlarge. The phone scales and re-encodes to JPEG (orientation applied, metadata
  dropped); the server validates the bytes again (JPEG/PNG/WebP only, size and pixel limits,
  metadata stripped, safe file names, no SVG). Photos live under `/data/media`, never travel in
  snapshots or SSE, are queued offline with a visible status, and stay viewable offline once
  seen (bounded service worker cache). Photos that are still used are never deleted;
  unreferenced ones are removed after 30 days.
- **Niet verkrijgbaar** (still needed, separate section, not bought, “Opnieuw proberen”) and
  **Deels gehaald** (3 asked, 2 bought → 2 recorded, 1 stays; purchase frequency counts once).
- **Bundles**: create, edit, copy and delete without touching products or history; optional
  servings with scaling (counted units round up and ask you to check); a preview where you
  uncheck what is in the house, choose the target list and decide per product already on it.
- **Checklists** (list type): “Nog te doen” / “Afgerond”, fixed manual order, **Opnieuw
  klaarzetten** with preview and undo. Ticking a checklist item never records a purchase, stock
  or prediction. Changing the type keeps the history and tells you what changes.
- **Meerdere toevoegen**: paste a list, one product per line, using the normal parser (bullets
  and numbering stripped, never split on commas). Editable preview with target list, quantities,
  validation, duplicates in the input and on the list, then one all-or-nothing operation.
- **Web Share Target**: share text from another app to the installed PWA; it opens the same
  preview and never changes the list directly. Links are never fetched.
- **Voorraad light**: Onbekend, Genoeg, Bijna op, Op, with a timestamp and a “misschien
  verouderd” hint. Offers “Op de boodschappenlijst” (right list, duplicate check) and, after
  buying something marked low, “Voorraad op genoeg” as a toast action. Nothing is ever applied
  automatically; predictions never change stock; checklists never touch it.
- **Full backup (ZIP)**: `export.json` + all photos + `manifest.json` (format
  `8star-grocery-backup` 1). Restoring it brings photos back. Export format 2 adds the new data;
  format 1 and v1.0 exports still import.

### Changed

- The edit sheet starts with name, quantity, “Notitie voor deze keer” and substitutes. Common
  units come first (others behind “Meer eenheden”); fixed note, photo, favourite, category and
  list are under **Meer opties**. Shopping actions (Deels gehaald, Niet verkrijgbaar, Ik pak dit)
  are buttons at the top; nothing is only behind a long press or swipe.
- AI suggestion cards are compact: product, quantity, source and one short reason. Details are
  behind “Waarom?”, and the stated confidence is shown as an estimate, not as certainty.
- Clearer sync status: “3 wijzigingen nog niet gedeeld”, waiting photos, and a notice when the
  server runs a newer version.
- Sync protocol 2. Servers keep accepting every op of protocol 1, so a phone that still runs
  v1.1 can send its queued changes after the upgrade.
- The request body limit is 100 MB (`BODY_SIZE_LIMIT`) for full backups with photos.
- `scripts/ci/docker-test.sh` upgrades from the real v1.1.0 image and checks photos on the
  volume and the backup ZIP round trip.

### Database

Migration 4 adds list type and walking route, product memory, stock, aliases, item notes,
substitutes, unavailable flag, manual position and partial purchases, plus the tables `media`,
`product_aliases`, `snoozes`, `bundles`, `bundle_lines`, `rounds`, `round_participants` and
`claims`. Ids and history are preserved; a `pre-migration-v3` backup is written first, and a
failed migration is rolled back completely.

### Upgrade notes

Redeploy in Dockhand with `APP_VERSION=1.2.0`. The volume, service name and port are unchanged.
Photos are stored in the same volume (`/data/media`). See docs/DOCKHAND.md §7.

## 1.1.0

Rebuilt from the verified v1.0.0 baseline. The unfinished `feat/v1.1-import-ai-theme` draft was
reviewed and not merged: it had no import or AI functionality, a theme that flashed and broke the
browser theme color, a release script that switched branches and checked the wrong CI run, and
failing CI.

### Added

- **Import and export** (Beheer → Gegevens):
  - Versioned JSON export (`8star-grocery-export`, format 1) with stable ids, all relationships,
    ISO 8601 timestamps and derived statistics.
  - **Full restore** (replace) with preview, explicit confirmation, an automatic `pre-import`
    backup, and a new data epoch so every device reconciles.
  - **Merge** of a JSON export into existing data. Duplicates are detected and existing data
    wins.
  - Legacy v1.0.0 JSON exports are imported too.
  - CSV import of products and purchase history (`;`/`,`/tab, ISO and Dutch dates), with per-line
    validation and duplicate detection.
  - CSV export of purchases, products, statistics, lists, categories and list items, plus a ZIP
    with all of them.
  - Every import is validated completely, runs in one transaction (rolled back on any error),
    and shows a readable Dutch preview and result.
- **AI-suggesties**: importable recommendation format (`8star-ai-recommendations`, format 1) with
  product validation, duplicate prevention, one-tap accept or dismiss (both undoable and synced),
  and a downloadable AI prompt. Suggestions are kept separate from local predictions, never
  change a list by themselves, and never touch purchase history.
- **`APP_PRIMARY_COLOR`**: one accent color for the whole app, read at runtime from Docker
  Compose/Dockhand (recreate, no rebuild).
  - WCAG AA light and dark variants are derived automatically; semantic colors are unchanged.
  - The color is injected server-side into the HTML shell, so the service worker keeps the last
    known theme offline.
  - The PWA manifest and app icons are generated in the configured color.
- `scripts/release.sh`: guarded GitHub CLI release from the terminal. It checks branch, clean
  tree, sync with origin, versions, changelog notes, existing tags and releases, and every CI
  check on the exact commit. It then asks for typed confirmation, creates an annotated tag and
  publishes notes from this changelog. It has a `--dry-run` mode.
- `scripts/ci/docker-test.sh` (run in CI): real upgrade from the v1.0.0 image with data, runtime
  theme change, JSON round trip, persistence, backup and restore.
- Database migration 3 (`ai_recommendations`, data epoch). Earlier migrations are unchanged.
- Docs: IMPORT-EXPORT.md, AI-RECOMMENDATIONS.md and RELEASE.md. DOCKHAND.md now has the correct
  repository URL and branch, plus update and rollback procedures.

### Fixed

- Backups made within the same second no longer collide: the second one used to fail.
- `restore.sh` takes the image and volume from the running stack (no hardcoded version), works
  from any directory, refuses path names, makes the pre-restore copy with SQLite's backup API
  (including WAL contents), and restarts the app unchanged if the restore fails.
- Undo of an op touching AI suggestions no longer assumes an `updated_at` column.
- Clients accept a dataset that was replaced elsewhere (epoch change), not only lowered sequence
  numbers.
- The default light accent tint was lightened slightly (`#dff0e5` → `#ebf6ee`): green text on it
  was 4.25:1 and is now above 4.5:1.

### Changed

- The import request body limit is 25 MB (`BODY_SIZE_LIMIT`; 100 MB since 1.2.0).
- The static manifest and icons were replaced by runtime-generated ones. `npm run icons` was
  removed.
- The image is tagged `8star-grocery-list:1.1.0` and carries OCI labels.

### Upgrade notes

Redeploy in Dockhand; the database migrates automatically after writing a `pre-migration-v2`
backup. The `8star-grocery-data` volume and the service name `app` are unchanged. See
docs/DOCKHAND.md §7 for the procedure and the rollback.

## 1.0.0

First release.

### Features

- Shared grocery lists with add (Enter or tap), quantity and unit parsing, autocomplete from
  history, duplicate prevention (case- and whitespace-insensitive), tap to complete and to
  reactivate, collapsible completed section, edit (name, quantity, unit, category, favourite,
  list), delete with confirmation, undo.
- Always-visible sorting: Nieuwste ↓ / Oudste ↑ / A–Z (Dutch collation), remembered per device.
  Optional grouping by category with configurable order.
- Multiple independent lists; moving items between lists.
- Purchase history per activation cycle, statistics (count, last purchase, average interval,
  frequency, next estimate), "Misschien nodig" suggestions (minimum 3 purchases, never
  auto-added), favourites, frequently bought products, searchable history.
- CSV and JSON export.
- Offline-first sync: IndexedDB operation queue, idempotent ops, SSE realtime updates,
  reconnect with backoff and watchdog, field-level last-writer-wins with notifications,
  duplicate merging via id aliases, sync log, backup-restore detection.
- PWA: manifest, maskable icons, service worker app shell, update prompt, install button.
- Docker: multi-stage non-root image, compose stack with healthcheck, persistent volume,
  automatic migrations with pre-migration backup, scheduled online backups, backup and restore
  scripts, Dockhand guide.

### Verified by automated tests

- 75 Vitest tests:
  - text and quantity parsing, category guessing, statistics, sorting, autocomplete, suggestions
  - every store operation: CRUD, duplicates, idempotency, undo, conflicts, aliases, lists,
    categories, favourites, history, persistence across reopen
  - sync engine against an in-process server: offline queue across reload, cancel and server
    undo, rejections, multi-device duplicate merge, last-writer-wins, backup rollback
  - IndexedDB storage
- 46 Playwright tests (Chromium, mobile emulation):
  - every CRUD flow, sorting and persistence, lists, categories, favourites, suggestions and
    statistics, exports
  - two-device realtime sync; offline edits and reconnect; concurrent offline duplicates;
    conflicting edits; edits to items deleted elsewhere
  - PWA install requirements and offline start through the service worker
  - layout audit at 320/360/390/430 px, portrait and landscape, light and dark: overflow,
    clipping, overlap, ≥ 48 px targets, visible sort controls, no dropdowns
  - keyboard-open layout, 130 %/160 % font scale, long lists
- CI Docker job: image build, healthy container, non-root user, persistence across container
  recreation, backup and restore.

### Known limitations

- Not tested on physical Galaxy A57 / Pixel 10 hardware. Mobile checks use Chromium emulation;
  the keyboard is simulated by shrinking the viewport.
- Installation and offline start need HTTPS (an Android/browser requirement). Plain-HTTP LAN
  access works without them.
- Undo is offered right after an action (toast); older actions can't be undone from the UI.
- The device only caches the 200 most recent purchases per product for offline statistics; the
  server keeps everything.
