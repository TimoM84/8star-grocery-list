# Import and export

Everything is available in the app under **Beheer → Gegevens** (`/beheer/gegevens`) and through
the HTTP API below. Imports always need a connection to the server (SQLite stays the single
source of truth); exports are plain downloads.

## Exports

| Download                | API                                          | Content                                                                                                          |
| ----------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Volledige export (JSON) | `GET /api/export?format=json`                | Everything, restorable (format below)                                                                            |
| Alles als CSV (ZIP)     | `GET /api/export?format=zip`                 | `purchases.csv`, `products.csv`, `statistics.csv`, `lists.csv`, `categories.csv`, `list-items.csv`, `README.txt` |
| Aankopen (CSV)          | `GET /api/export?format=csv&type=purchases`  | One row per purchase event                                                                                       |
| Producten (CSV)         | `GET /api/export?format=csv&type=products`   | Products with stable ids                                                                                         |
| Statistieken (CSV)      | `GET /api/export?format=csv&type=statistics` | Derived statistics per product                                                                                   |
| AI-opdracht             | `GET /api/export?format=ai-prompt`           | Instructions for ChatGPT/Claude (see [AI-RECOMMENDATIONS.md](AI-RECOMMENDATIONS.md))                             |

Other CSV datasets: `type=lists`, `type=categories`, `type=list-items`.

CSV files are UTF-8 with BOM, use `;` as separator and a decimal comma, so they open directly in
Dutch Excel. In Python: `pd.read_csv("purchases.csv", sep=";", decimal=",")`. All timestamps are
ISO 8601 in UTC (`2026-10-24T08:30:00.000Z`).

### JSON export format (version 1)

```jsonc
{
	"format": "8star-grocery-export",
	"formatVersion": 1,
	"app": { "name": "8star-grocery-list", "version": "1.1.0" },
	"databaseSchemaVersion": 3,
	"exportedAt": "2026-10-24T20:00:00.000Z",
	"data": {
		"lists": [
			{ "id": "default", "name": "Boodschappen", "position": 0, "createdAt": "…", "updatedAt": "…" }
		],
		"categories": [
			{
				"id": "cat-zuivel",
				"name": "Zuivel & eieren",
				"position": 2,
				"createdAt": "…",
				"updatedAt": "…"
			}
		],
		"products": [
			{
				"id": "p-…",
				"name": "Halfvolle melk",
				"categoryId": "cat-zuivel",
				"favorite": true,
				"createdAt": "…",
				"updatedAt": "…"
			}
		],
		"listItems": [
			{
				"id": "i-…",
				"listId": "default",
				"productId": "p-…",
				"status": "active",
				"quantity": 2,
				"unit": "l",
				"activatedAt": "…",
				"completedAt": null,
				"purchaseEventId": "c-…",
				"createdAt": "…",
				"updatedAt": "…"
			}
		],
		"purchaseEvents": [
			{
				"id": "c-…",
				"productId": "p-…",
				"listId": "default",
				"status": "purchased",
				"activatedAt": "…",
				"completedAt": "…",
				"cancelledAt": null,
				"quantity": 2,
				"unit": "l"
			}
		],
		"aiRecommendations": [
			{
				"id": "ai-…",
				"productId": "p-…",
				"suggestedQuantity": 2,
				"suggestedUnit": "l",
				"nextPurchaseAt": "…",
				"confidence": 0.82,
				"reasoning": "…",
				"source": "ChatGPT",
				"batchId": "batch-…",
				"status": "open",
				"importedAt": "…",
				"resolvedAt": null
			}
		]
	},
	"statistics": [/* derived per product; informational, ignored on import */]
}
```

- **Purchase events.** Every time a product was put on a list, with its outcome: `purchased`
  (`completedAt`), `cancelled` (removed from the list unbought, `cancelledAt`) or `open`
  (still on the list). The full purchase history is the `purchased` events.
- **Stable ids.** Ids never change, so an export → restore → export round trip yields an
  identical `data` section. This is covered by automated tests.
- **Restorable.** The JSON export contains all user data. It doesn't contain technical sync state
  (operation log, id aliases, sync sequence numbers). That state is rebuilt automatically, so a
  JSON restore is a complete data restore. For a byte-for-byte copy of the database, use the
  SQLite backups in `/data/backups` instead (see [DOCKHAND.md](DOCKHAND.md#9-backups-restore-and-data-import)).
- Older exports from v1.0.0 (`"app": "8star-grocery-list"` with raw tables) are recognised and
  converted on import.

## Imports

In the app: choose the file type, pick a file. A **preview** appears immediately; nothing has
changed at that point. Then choose:

- **Samenvoegen (merge):** adds what is new. Existing data on the server always wins.
- **Alles vervangen (replace, JSON only):** makes the server exactly match the file. This is
  destructive, so the app first shows what will be removed and asks for confirmation. The server
  then writes a `pre-import` backup to `/data/backups` and replaces everything in one
  transaction.

Every import is validated completely before anything is written. It runs in a single SQLite
transaction and is rolled back entirely on any error. The preview runs the same code and then
rolls back, so it always matches the real result. Results are shown as readable Dutch lines
(e.g. "12 aankopen toegevoegd, 3 dubbel (overgeslagen)") with warnings and per-line errors.

### Duplicate detection and merge rules

| Data             | Matched by                                                      | When matched                                                       |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Lists/categories | id, then name (case-insensitive)                                | existing kept                                                      |
| Products         | id, then name (case- and whitespace-insensitive)                | existing kept; favourite is added, a missing category is filled in |
| Purchase events  | id, then same product + same purchase/cancel time (CSV: ±1 min) | skipped as duplicate (never counted twice)                         |
| List items       | same list + same product                                        | the server's current list wins                                     |
| AI suggestions   | id or identical content                                         | skipped as duplicate                                               |

Importing the same file twice therefore changes nothing the second time.

### CSV: products

Required column: `product`. Optional: `categorie`, `favoriet` (`ja`/`nee`, also
`yes/true/1/x`) and `product_id`. Unknown categories are created. Separator `;`, `,` or tab
(detected automatically); quotes as usual in CSV.

```csv
product;categorie;favoriet
Halfvolle melk;Zuivel & eieren;ja
Pindakaas;Ontbijt;nee
```

The app's own `products.csv` export can be imported as is.

### CSV: purchase history

Required columns: `product` and `gekocht` (purchase time). Optional: `aantal` (decimal comma or
point), `eenheid`, `lijst` (existing list name or id), `categorie` (for new products),
`geactiveerd`, `status` (`gekocht`, `geannuleerd`; `open` rows are skipped), `geannuleerd`,
`purchase_id`, `product_id`. Unknown products are created.

Accepted date formats: ISO 8601 (`2026-10-24T18:30:00Z`), `2026-10-24 18:30`, `2026-10-24`
(counted as midday) and Dutch `24-10-2026 18:30`. Times without a time zone use the server's
time zone (`TZ`). Impossible dates such as `2026-13-45` are rejected.

```csv
product,gekocht,aantal,eenheid,lijst
Koffie,24-10-2026 18:30,"1,5",kg,Boodschappen
Brood,2026-10-23,,,
```

The app's own `purchases.csv` export can be imported as is; re-importing it reports every row as
a duplicate.

## Multiple devices and offline queues

Imports are server-side, so all devices see the result through the normal realtime sync:

- **Merge:** devices receive the new data like any other change.
- **Replace/restore:** the server starts a new _data epoch_. Every device notices it, shows
  "De gegevens zijn vervangen door een import of herstel", drops its locally cached state and
  reloads the server data. Changes a device made offline and had not sent yet are **not
  discarded**. They are sent after the restore and applied to the restored data. If one no
  longer fits (e.g. ticking off an item that doesn't exist in the restored data), it is
  rejected with a message and logged under Beheer → Synchronisatie.
- The device that starts an import first sends its own queued changes. If that is impossible
  (offline), the import is not started.
- A replace makes earlier "Ongedaan maken" (undo) actions impossible, because they refer to the
  data that was replaced.

See also [SYNC.md](SYNC.md).

## HTTP API

```
POST /api/import?kind=json|products-csv|purchases-csv|ai&mode=merge|replace[&preview=1]
Content-Type: application/octet-stream
X-Confirm-Replace: VERVANGEN          # required for mode=replace without preview
<raw file content, max 25 MB>
```

Responses: `200` with a report when the import succeeded (or the preview is valid), `422` with a
report listing the errors, and `428` when a replace was sent without the confirmation header.
