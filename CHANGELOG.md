# Changelog

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
