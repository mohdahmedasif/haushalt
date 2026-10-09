# Haushalt API v1

Local JSON API for the Haushalt web app.

- Base: `http://127.0.0.1:8787/api/v1`
- Auth: `Authorization: Bearer haushalt-local` (change `HAUSHALT_API_KEY` in `.env`)
- Also accepted: `X-Api-Key: haushalt-local`

Start both UI and API from the repo root:

```
npm install
npm run dev
```

UI: http://127.0.0.1:5173  
Catalog: `GET /api/v1` (no auth)

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness |
| GET | `/summary?month=2026-09` | Income, expense, leftover, cash on hand, per-category |
| GET | `/categories` | Category list + budgets |
| POST | `/categories` | `{ "name": "Pets", "kind": "expense", "budget": 50 }` |
| PATCH | `/categories/:id` | `{ "budget": 400 }` |
| GET | `/transactions?month=&uncategorized=1&category=` | Ledger |
| PATCH | `/transactions/:id` | `{ "categoryId", "splits", "loanPersonId", "loanDirection", "spreadMonths" }` |
| POST | `/imports/preview` | `{ "fileName", "csvText" }` Sparkasse CAMT CSV |
| POST | `/imports` | `{ "fileName", "csvText", "includeSoft": false }` |
| GET | `/imports` | Past import batches |
| GET | `/cash` | `{ balance, movements }` |
| POST | `/cash/movements` | `{ "type": "in"\|"out"\|"opening", "amount", "date", "categoryId?", "note?" }` |
| GET | `/people` | Known counterparties |
| GET | `/rules` | Auto-category rules |
| POST | `/rules` | `{ "field", "value", "categoryId" }` |
| DELETE | `/rules/:id` | Remove a rule |
| POST | `/rules/apply` | Tag uncategorized bookings that match rules |
| GET | `/contracts` | Recurring SEPA/salary contracts + AI labels |
| POST | `/contracts/analyze` | Re-run detection (uses `HAUSHALT_AI_KEY` or local Ollama if present) |
| GET | `/forecast` | Payday, upcoming contracts, Fixkosten, tomorrow / 7-day balance |
| GET | `/report?year=2026` | Year sheet: category × month, totals, leftover |
| GET | `/backup` | Full backup: every table and column as one JSON file |
| POST | `/backup/restore` | Body = a backup file. Replaces the whole database with it |
| POST | `/ask` | `{ "question": "How much until payday?", "month?": "2026-09" }` |

Telegram later can call the same routes, for example:

- “how much cash?” → `GET /cash`
- “spent 12 leisure” → `POST /cash/movements` `{ "type": "out", "amount": 12, "categoryId": "leisure", "date": "2026-09-20" }`
- “month left?” → `GET /summary?month=2026-09`
- “until payday?” → `GET /forecast` or `POST /ask` `{ "question": "How much until payday?" }`
- “contracts?” → `GET /contracts`
