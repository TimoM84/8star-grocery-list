# Changelog

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

- The import request body limit is 25 MB (`BODY_SIZE_LIMIT`).
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
