# Offline sync and conflict resolution

8star Grocery List has no accounts: every device on the private network or VPN shares the same
lists. The server's SQLite database is the single source of truth; each device keeps a cached
copy so it can be used offline.

## Moving parts

| Piece               | Where                       | Role                                                                    |
| ------------------- | --------------------------- | ----------------------------------------------------------------------- |
| Operation (op)      | `src/lib/shared/ops.ts`     | Every change is an op with a client-generated UUID (`id`) and timestamp |
| Server store        | `src/lib/server/store.ts`   | Validates and applies ops in SQLite transactions, exactly once          |
| Ops log             | `ops` table                 | Stores each op's result (idempotency) and an inverse (undo)             |
| Sync engine         | `src/lib/client/sync.ts`    | Durable queue, batching, retries, snapshots, SSE                        |
| Optimistic reducer  | `src/lib/shared/reducer.ts` | Applies queued ops on top of the last snapshot for instant UI           |
| IndexedDB           | `src/lib/client/idb.ts`     | Persists the snapshot, the pending queue, aliases and sync issues       |
| SSE (`/api/events`) | `src/lib/server/events.ts`  | Pushes `{ seq }` to every device after each change                      |
| Photo queue         | IndexedDB `media` store     | Photos waiting for upload (`PUT /api/media/:id`), sent before the ops   |
| Presence            | `POST /api/presence`        | Winkelstand heartbeat; not an op (nothing to replay or undo)            |

## Life of a change

1. The user taps something. The app creates an op, writes it to the IndexedDB queue and applies
   it optimistically: the UI updates immediately, online or not.
2. Within ~30 ms the engine posts all queued ops in order (`POST /api/ops`, max 100 per batch).
3. The server applies each op in its own transaction. If the op id was seen before, it returns
   the stored result without applying it again. That makes retries after timeouts and
   reconnects safe.
4. Each applied op bumps the global sequence number (`seq`). The server notifies all devices via
   SSE, and they fetch a fresh snapshot (`GET /api/snapshot`).
5. An acknowledged op stays queued until a snapshot with `seq >= ackSeq` arrives. That way the UI
   never flickers back to the old state between the ack and the snapshot.

What the device shows is always the server snapshot with the still-pending ops replayed on
top. Every reducer case is idempotent, so replaying an op whose effect the snapshot already
contains changes nothing.

## Offline and reconnecting

- The app shell is cached by the service worker. Data comes from IndexedDB, so the app opens and
  works without a connection.
- The sync badge in the header shows **Live**, **Sync…**, **Verbinden** or **Offline · N**
  (N = changes waiting). Beheer → Synchronisatie shows details and a manual **Nu
  synchroniseren** button.
- The engine detects offline in three ways: browser `offline` events, failed or timed-out
  requests (10 s timeout), and a watchdog that spots silently dead SSE connections. A VPN
  dropping often hangs instead of failing, which is why the watchdog exists. The server sends
  a heartbeat every 20 s and the watchdog reconnects after 50 s of silence.
- Retries use exponential backoff (1 s → 30 s, with jitter). They are also triggered right away by
  the `online` event, by the app becoming visible, and by the SSE connection reopening.
- When the page is hidden or closed, pending ops are also sent with a `keepalive` request.
  Sending them twice is harmless.

## Protocol versions

Every request carries `protocol` (1 = v1.0/v1.1, 2 = v1.2, 3 = v1.3, 4 = v1.4) and every snapshot
reports the server's version. The server keeps accepting **every op type of older protocols**, so a phone
that still runs v1.1 after the server was upgraded can send its offline queue without losing
anything. A v1.2 phone that talks to an older server gets op types it doesn't know rejected
individually (shown and logged, never dropped silently); when the server reports a newer
protocol, Beheer shows “De server draait een nieuwere versie”. Snapshots cached by an older app
version are normalised with safe defaults when read.

## Intent ops (v1.2)

Quantity changes are explicit intents, never “set the row to what I saw”:

| Op                         | Meaning                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item.add`                 | Puts a product on a list. If it is already active it is a no-op (`duplicate`): the quantity is **never** changed by an add                                          |
| `item.increment`           | Adds `delta` (in `unit`) atomically on the server. Rejected for an unknown existing amount or incompatible units; only g↔kg and ml↔l are converted                  |
| `item.update` (`quantity`) | Explicit “Wijzigen naar”. Bumps the item's `quantity_rev`                                                                                                           |
| `item.purchasePartial`     | Records a partial purchase on the open cycle (`purchased_quantity`) and lowers the remaining quantity. The cycle completes once, so frequency is not inflated       |
| `items.addMany`            | Bulk paste, bundles, shared text: one transaction (savepoint), all or nothing. Each line says `add`, `extra` or `set`                                               |
| `item.setUnavailable`      | Parks an item as “Niet verkrijgbaar”; `list.retryUnavailable` and joining a new round reset it                                                                      |
| `round.join/leave/end`     | One active round per list (partial unique index), concurrent starts merge into the same round (`roundId` in the result). Ending or leaving never completes anything |
| `item.claim` / `release`   | “Ik pak dit”, expires after 20 min, removed on completion. A claim by someone else is a no-op with a message; it never blocks completing                            |
| `product.snooze`           | Shared “Niet nu” until a timestamp (`until: 0` clears)                                                                                                              |
| `product.setStock`         | Stock status with timestamp; never changed by predictions or checklists                                                                                             |
| `product.setPhoto`         | Points a product at an uploaded photo (or `null`)                                                                                                                   |
| `alias.add/remove`         | Manual alternative names; a name that already belongs to another product is rejected                                                                                |
| `bundle.save/delete`       | Upsert of a bundle with all its lines; deleting never touches products or history                                                                                   |
| `list.setKind`             | Grocery ↔ checklist. Open cycles are cancelled/created so checklist ticks never count as purchases; history is kept                                                 |
| `list.setCategoryOrder`    | Per-list walking route (`null` = global order)                                                                                                                      |
| `list.resetChecklist`      | Puts the given completed checklist items back to “Nog te doen”                                                                                                      |

Two devices that each add one extra to an item with 2 end at 4; a resent `item.increment` (same
op id) counts once.

## Conflict rules

The server applies ops in the order it receives them. Ops express _intent_ ("complete item X"),
not "set the whole row to Y", which avoids most conflicts by design.

| Situation                                                     | Result                                                                                                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two devices add the same product (any case/spacing)           | One product and one list item. The second add is a no-op (`duplicate`); its local ids are mapped to the existing ones (`id_aliases`)                            |
| A device keeps using the id of a merged duplicate             | The server resolves the alias, so e.g. completing the "local" item completes the real one                                                                       |
| Two devices complete the same item                            | First one wins. The second is a no-op (`already_completed`), so a purchase is **never counted twice**                                                           |
| Two devices reactivate the same item                          | First one wins, the second is a no-op                                                                                                                           |
| Concurrent edits of the same field (quantity, unit, name, …)  | **Last writer wins**, field by field. Each edit carries the value the device last saw (`base`); a mismatch is reported to the writing device                    |
| Edits of _different_ fields                                   | Both are kept (field-level merge)                                                                                                                               |
| Editing or completing an item deleted on another device       | Rejected (`not_found`). The device shows a message and the change is logged under Beheer → Synchronisatie                                                       |
| Adding to a list deleted on another device                    | Rejected (`list_not_found`), shown and logged                                                                                                                   |
| Renaming to a name that exists already                        | Rejected (`duplicate`), shown and logged                                                                                                                        |
| Moving an item to a list that already has the product         | Merged: the active row wins; a completed duplicate is removed                                                                                                   |
| Undo after someone else changed the same item                 | Rejected (`conflict`). Undo only applies when the item still has the version the original op produced                                                           |
| Server restored from a backup (seq goes down)                 | Devices accept the restored data, drop overlays of already-acknowledged ops, and re-send ops that never reached the server                                      |
| Full import/restore done on another device (new data epoch)   | Devices are told (toast), drop cached state and overlays, reload the server data and then send their unsent ops; ops that no longer fit are rejected and logged |
| Accepting or dismissing the same AI suggestion on two devices | First one wins, the second is a no-op; the product is put on the list only once                                                                                 |
| Two devices start a round on the same list                    | One round; the second join merges into it                                                                                                                       |
| Undo of “1 extra” after someone else added extra              | Only your own amount is removed; the other device's increment stays                                                                                             |
| Undo of “1 extra” after someone set the amount explicitly     | Rejected (`conflict`) with “het aantal is intussen op een andere manier gewijzigd”; nothing is reverted                                                         |

### No silent data loss

- Ops are written to IndexedDB before they are sent, and only removed after the server
  acknowledged them _and_ a snapshot containing them arrived.
- Every rejection and every last-writer-wins overwrite produces a toast and an entry in the sync
  log (Beheer → Synchronisatie → Meldingen). The log shows the reason in Dutch.
- One invalid op never blocks the queue: the server rejects it individually and continues with
  the rest of the batch. Server errors (5xx) keep the whole batch queued for retry.
- The server never deletes history implicitly. Deleting a list item keeps its purchase cycles.
  Only an explicit, confirmed "product en geschiedenis verwijderen" removes history.

## Imports, restores and data epochs

Bulk changes (imports, JSON restore, merges) don't go through the op queue. They run on the server
in one SQLite transaction and bump the sequence number once, so every device refreshes through
the normal SSE path.

A full replace also starts a new **data epoch** (random id in `meta.epoch`, sent with every
snapshot). A device that sees the epoch change:

1. shows "De gegevens zijn vervangen door een import of herstel";
2. drops its id aliases and the overlays of ops that were already acknowledged (they belong to
   the old data);
3. keeps every op that never reached the server and sends it afterwards. The server applies it
   to the restored data, or rejects it with a readable reason that ends up in the sync log.
   Nothing is discarded silently.

The replace also marks all recorded ops as no longer undoable, because their before-images
describe the replaced data. Before importing, the importing device sends its own queued ops
first. A restore of a SQLite backup lowers the sequence number instead, and devices handle that
the same way (see the conflict table).

## Household settings (v1.3, language since v1.4)

Settings that apply to every device are stored as `setting.*` rows in the `meta` table and sent
with every snapshot as `settings`:

| Setting     | Values                       | Default | Meaning                               |
| ----------- | ---------------------------- | ------- | ------------------------------------- |
| `aiEnabled` | `true`, `false`              | `true`  | "Show AI features" (v1.3)             |
| `language`  | `en`, `nl`, `de`, `fr`, `es` | `en`    | UI and server message language (v1.4) |

They change through one op:

| Op                | Meaning                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.update` | `{ aiEnabled?: boolean, language?: string }`, at least one field. Only the given fields change; applied when a value changes, otherwise `unchanged` |

The language decides the app's text on every device, the server's rejection and conflict
messages, import reports, the PWA manifest, the HTML shell (`lang`, title) and the AI prompt.
It does not change data: product, list and category names stay as typed. The categories and
the list seeded on a fresh install (stored with Dutch names) are shown translated as long as
they keep their original name; renaming one makes the name your own. Units are stored as Dutch
codes (`stuks`, `pak`, `fles`, …) and shown translated; typing accepts the unit words of every
language.

The op is idempotent, applied optimistically and queued offline like every other op, and it is
not undoable (switching back is the undo). The last device to send it wins. Snapshots from an
older server have no `settings`; the app then uses the defaults (`aiEnabled: true`, English), so
nothing is hidden. An older server rejects the op as unknown, which is shown and logged as usual.

## AI suggestions

`ai.accept` and `ai.dismiss` are ordinary, idempotent, undoable ops. Accepting puts the product
on the chosen list exactly like an `item.add` (or reactivates it) and marks the suggestion as
accepted, in one transaction. It never writes purchase history.

## Photos

Photos never travel through ops, snapshots or SSE. The phone scales and re-encodes a photo,
stores it in the IndexedDB `media` store and queues the `product.setPhoto` op. Every flush first
uploads waiting photos (`PUT /api/media/:id`, idempotent: the same bytes under the same id are
accepted again, different bytes are refused), then sends the ops, so the server never sees a
reference to a missing photo. A photo the server refuses is shown as an issue and can be
discarded. Images are immutable per id and served with long cache headers; the service worker
keeps up to 200 of them for offline viewing.

## Undo

- If the op has not left the device yet, undo removes it from the queue.
- Otherwise an `undo` op is queued. When the server applied the original op, it stored the
  before-images of every row it touched plus the resulting versions. Undo restores those rows
  if the versions still match. Undoing a completion therefore re-opens the same purchase cycle
  and keeps the original activation time: **no purchase is counted**.
- Intent ops (`item.increment`, `item.purchasePartial`) use a _semantic_ inverse instead of row
  images: undo subtracts exactly the amount that op added (or gives back the partial amount), so
  later increments by other devices survive. It refuses when the amount was changed explicitly
  in between (`quantity_rev`), the unit changed or the cycle ended.

## History model

- `cycles` holds one row per activation: `activated_at`, then either `completed_at` (a purchase)
  or `cancelled_at` (removed from the list unbought).
- `items` holds one row per (list, product). Reactivating a completed item starts a new cycle and
  sets a new `activated_at`, which moves the item to the top under "Nieuwste".
- Statistics (`src/lib/shared/stats.ts`) are computed locally from completion timestamps, on the
  server for exports and on the device for the UI, using the same code.
  - Completions within 6 hours count as one trip.
  - Average interval = time between first and last trip ÷ (trips − 1).
  - Frequency = 30 ÷ average interval (per month).
  - Next purchase is estimated at last trip + average interval, once there are at least
    **3 trips** (`MIN_HISTORY`).
  - "Misschien nodig" lists products not on the current list whose elapsed time is 80–400 % of
    their usual interval. Suggestions are never added automatically. "Niet nu" hides a
    suggestion on every device for half an interval (1–14 days), until a visible end date.
  - Suggestions are list-aware: a product with a preferred list is only suggested there;
    otherwise on every grocery list where it has an item row; a product without any row on a
    grocery list is suggested on all grocery lists. Checklists get no suggestions.
- Partial purchases count as one purchase with the total bought quantity. Checklist ticks never
  create purchase cycles.

## Clocks

Ops carry the device's time, corrected by the measured offset to the server clock, so offline
purchases keep their real time. The server caps timestamps at most 60 s into the future, and a
completion can never be earlier than its activation.
