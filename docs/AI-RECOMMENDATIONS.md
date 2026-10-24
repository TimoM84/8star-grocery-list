# External AI recommendations

8star has no built-in AI and no API keys. You can analyse your own data with any tool (ChatGPT,
Claude, a local model or a Python script) and import the result as **AI-suggesties**:

1. **Beheer → Gegevens → Volledige export (JSON)**, or the CSV ZIP for spreadsheets/pandas.
2. **Beheer → Gegevens → AI-opdracht downloaden**: ready-made instructions that include the exact
   output format below.
3. Give both to the AI tool and save its answer as a `.json` file.
4. **Suggesties → AI-suggesties → AI-bestand importeren**: check the preview, then _Importeren_.

What the app does with AI suggestions:

- They are shown in their own section, separate from the app's own "Misschien nodig" predictions.
- **Toevoegen** puts the product on the current list with the suggested quantity, in one tap.
  **Negeren** hides the suggestion. Both can be undone right away.
- Nothing is ever added to a list automatically.
- Purchase history and statistics are never changed by suggestions.
- Re-importing the same suggestion is detected and skipped. A newer suggestion for a product
  replaces the older open one, so there is only one open suggestion per product.

## File format (version 1)

```json
{
	"format": "8star-ai-recommendations",
	"formatVersion": 1,
	"generatedAt": "2026-10-24T08:00:00Z",
	"source": "ChatGPT",
	"recommendations": [
		{
			"productId": "p-3f9c2a",
			"productName": "Halfvolle melk",
			"suggestedQuantity": 2,
			"unit": "l",
			"nextPurchaseDate": "2026-10-28",
			"confidence": 0.82,
			"reasoning": "Je koopt elke week 2 liter; de laatste aankoop was 6 dagen geleden."
		},
		{
			"productId": "p-91b0d4",
			"confidence": 0.55,
			"reasoning": "Koffiebonen koop je ongeveer elke twee weken."
		}
	]
}
```

| Field               | Required | Rules                                                                                                       |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `format`            | yes      | exactly `"8star-ai-recommendations"`                                                                        |
| `formatVersion`     | yes      | `1`                                                                                                         |
| `source`            | no       | shown in the app, max 80 characters (e.g. `"ChatGPT"`, `"Claude"`, `"pandas-script"`)                       |
| `generatedAt`       | no       | ISO 8601, informational                                                                                     |
| `recommendations`   | yes      | 1–1000 entries                                                                                              |
| `productId`         | yes      | an existing `data.products[].id` from the export; unknown ids are skipped with a warning                    |
| `productName`       | no       | for humans; a mismatch with the id gives a warning (the id wins)                                            |
| `suggestedQuantity` | no       | number > 0, or `null`                                                                                       |
| `unit`              | no       | `stuks`, `g`, `kg`, `ml`, `l`, `pak`, `fles`, `blik`, `zak`, `bos`, `doos`, `pot` (also `liter`, `gram`, …) |
| `nextPurchaseDate`  | no       | ISO 8601 date or date-time                                                                                  |
| `confidence`        | yes      | number from 0 to 1 (`0.82`, not `82`)                                                                       |
| `reasoning`         | yes      | text, 1–1000 characters, shown as is                                                                        |

Validation: the file is rejected only if it is not this format or has no valid entry at all.
Invalid entries (unknown product, confidence outside 0–1, bad date, …) are skipped and listed
in the preview, so you can see what the AI got wrong. If an entry appears twice for the same
product, the last one counts.

## Example: Python

```python
import json, pandas as pd

export = json.load(open("8star-export-2026-10-24.json"))
products = {p["id"]: p["name"] for p in export["data"]["products"]}
events = pd.DataFrame(e for e in export["data"]["purchaseEvents"] if e["status"] == "purchased")
events["completedAt"] = pd.to_datetime(events["completedAt"])

recs = []
for pid, g in events.sort_values("completedAt").groupby("productId"):
    if len(g) < 3:
        continue
    interval = g["completedAt"].diff().mean()
    next_date = g["completedAt"].iloc[-1] + interval
    recs.append({
        "productId": pid,
        "productName": products[pid],
        "nextPurchaseDate": next_date.date().isoformat(),
        "confidence": 0.6,
        "reasoning": f"Gemiddeld elke {interval.days} dagen gekocht.",
    })

json.dump({"format": "8star-ai-recommendations", "formatVersion": 1, "source": "pandas",
           "recommendations": recs}, open("ai-suggesties.json", "w"), ensure_ascii=False, indent=2)
```
