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

## Conflict rules

The server applies ops in the order it receives them. Ops express _intent_ ("complete item X"),
not "set the whole row to Y", which avoids most conflicts by design.

| Situation                                                    | Result                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Two devices add the same product (any case/spacing)          | One product and one list item. The second add is a no-op (`duplicate`); its local ids are mapped to the existing ones (`id_aliases`)         |
| A device keeps using the id of a merged duplicate            | The server resolves the alias, so e.g. completing the "local" item completes the real one                                                    |
| Two devices complete the same item                           | First one wins. The second is a no-op (`already_completed`), so a purchase is **never counted twice**                                        |
| Two devices reactivate the same item                         | First one wins, the second is a no-op                                                                                                        |
| Concurrent edits of the same field (quantity, unit, name, …) | **Last writer wins**, field by field. Each edit carries the value the device last saw (`base`); a mismatch is reported to the writing device |
| Edits of _different_ fields                                  | Both are kept (field-level merge)                                                                                                            |
| Editing or completing an item deleted on another device      | Rejected (`not_found`). The device shows a message and the change is logged under Beheer → Synchronisatie                                    |
| Adding to a list deleted on another device                   | Rejected (`list_not_found`), shown and logged                                                                                                |
| Renaming to a name that exists already                       | Rejected (`duplicate`), shown and logged                                                                                                     |
| Moving an item to a list that already has the product        | Merged: the active row wins; a completed duplicate is removed                                                                                |
| Undo after someone else changed the same item                | Rejected (`conflict`). Undo only applies when the item still has the version the original op produced                                        |
| Server restored from a backup (seq goes down)                | Devices accept the restored data, drop overlays of already-acknowledged ops, and re-send ops that never reached the server                   |

### No silent data loss

- Ops are written to IndexedDB before they are sent, and only removed after the server
  acknowledged them _and_ a snapshot containing them arrived.
- Every rejection and every last-writer-wins overwrite produces a toast and an entry in the sync
  log (Beheer → Synchronisatie → Meldingen). The log shows the reason in Dutch.
- One invalid op never blocks the queue: the server rejects it individually and continues with
  the rest of the batch. Server errors (5xx) keep the whole batch queued for retry.
- The server never deletes history implicitly. Deleting a list item keeps its purchase cycles.
  Only an explicit, confirmed "product en geschiedenis verwijderen" removes history.

## Undo

- If the op has not left the device yet, undo removes it from the queue.
- Otherwise an `undo` op is queued. When the server applied the original op, it stored the
  before-images of every row it touched plus the resulting versions. Undo restores those rows
  if the versions still match. Undoing a completion therefore re-opens the same purchase cycle
  and keeps the original activation time: **no purchase is counted**.

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
    suggestion on that device for half an interval.

## Clocks

Ops carry the device's time, corrected by the measured offset to the server clock, so offline
purchases keep their real time. The server caps timestamps at most 60 s into the future, and a
completion can never be earlier than its activation.
