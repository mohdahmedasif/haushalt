# Haushalt API v1

Local JSON API for the Haushalt web app.

- Base: `http://127.0.0.1:8787/api/v1`
- Access is by cookie, set by the server; there is no API key header
- Open to anyone: `GET /device` and `POST /device/pair`
- Everything else needs a paired device, or it answers `403 { "code": "unpaired" }`
- Data routes also need an unlocked profile, or they answer `401 { "code": "locked" }`, and only ever see that profile's books

Start both UI and API from the repo root:

```
npm install
npm run dev
```

UI: http://127.0.0.1:5173  
Catalog: `GET /api/v1`

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness |
| GET | `/device` | `{ paired, name }` |
| POST | `/device/pair` | `{ "adminKey" }` Pairs this browser. 20 tries per 5 minutes per address |
| DELETE | `/device` | Unpair this browser |
| DELETE | `/devices/others` | Unpair every other browser (needs an unlocked profile) |
| GET | `/profiles` | `[{ id, name }]` |
| POST | `/profiles` | `{ "name", "pin" }` PIN is 4 to 8 digits |
| POST | `/profiles/:id/unlock` | `{ "pin" }` On failure: `wrong_pin` with `attemptsLeft`, or `locked_out` with `lockedUntil` |
| POST | `/profiles/:id/reset-pin` | `{ "adminKey", "newPin" }` Signs the profile out everywhere |
| GET | `/session` | `{ profile }` or `{ profile: null }` |
| POST | `/session/lock` | End this session |
| POST | `/profile/pin` | `{ "currentPin", "newPin" }` |
| DELETE | `/profile` | `{ "pin" }` Deletes the unlocked profile and its books |
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
| POST | `/contracts/analyze` | Re-run detection (uses Gemini when a key is saved in Settings) |
| GET | `/forecast` | Payday, upcoming contracts, Fixkosten, tomorrow / 7-day balance |
| GET | `/report?year=2026` | Year sheet: category × month, totals, leftover |
| GET | `/ai` | Gemini status: `{ hasKey, keyHint, unreadable, model }` (never the key) |
| GET | `/ai/models` | Gemini models the saved key can use |
| PUT | `/ai/key` | `{ "apiKey" }` Checks the key with Gemini, then stores it encrypted |
| DELETE | `/ai/key` | Remove the saved key |
| PATCH | `/ai` | `{ "model": "gemini-flash-latest" }` |
| GET | `/backup` | Full backup: every table and column as one JSON file |
| POST | `/backup/restore` | Body = a backup file. Replaces the whole database with it |
| POST | `/ask` | `{ "question": "How much until payday?", "month?": "2026-09" }` |
