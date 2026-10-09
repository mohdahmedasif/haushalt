<p align="center">
  <img src="public/logo.svg" alt="Haushalt" width="72" height="72">
</p>

<h1 align="center">Haushalt</h1>

<p align="center">
  Local-first personal finance for German bank CSVs (Sparkasse CAMT / Umsatz).<br>
  Import bookings, categorize with rules, track budgets, cash, lending, and contracts — all on your machine in SQLite.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3D6B4F" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-2f5d50" alt="Node.js 22+">
  <a href="https://github.com/mohdahmedasif/haushalt/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22"><img src="https://img.shields.io/badge/good%20first%20issue-welcome-7057ff" alt="Good first issues"></a>
</p>

## Features

- Import German CAMT / Umsatz CSV (bank export)
- Rules-based auto-categorization (stored in your DB)
- Monthly budgets, year sheet, cash wallet, lending / repayments
- Recurring contracts detection, insights, and a simple ask assistant
- Setup wizard for first run; data stays in `data/haushalt.sqlite` (created automatically)

## Requirements

- Node.js 22+ (uses the built-in `node:sqlite` module)

## Quick start

```bash
npm install
cp .env.example .env   # optional — defaults work for local use
npm run dev
```

- UI: http://127.0.0.1:5173
- API: http://127.0.0.1:8787/api/v1

On first start the API creates `data/`, the SQLite file, tables, and a thin generic seed (categories + keyword rules). Your rules, people, and budgets live only in that database — not in the repo.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + Vite UI together |
| `npm run dev:api` | API only (`tsx watch`) |
| `npm run dev:ui` | Vite only |
| `npm start` | API without file watch |
| `npm run build` | Typecheck + production UI build |

## Configuration

Copy `.env.example` to `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HAUSHALT_API_KEY` | `haushalt-local` | Bearer / `X-Api-Key` for the API |
| `VITE_HAUSHALT_API_KEY` | `haushalt-local` | Same key for the UI |
| `PORT` | `8787` | API port |
| `HAUSHALT_AI_KEY` | — | Optional OpenAI-compatible key for contract labeling |
| `HAUSHALT_AI_BASE_URL` | OpenAI | Optional custom base URL |
| `HAUSHALT_AI_MODEL` | `gpt-4o-mini` | Optional model name |

## Backup and restore

**Import → Backup** downloads everything (bookings, categories, budgets, rules, people, cash, gold, settings) as one JSON file. On a fresh install, choose **Restore from a backup** on the welcome screen, or use **Import → Restore**, and upload that file to get the exact same state back. Restoring replaces whatever is in the app. The file holds your full bank history, so store it somewhere private.

## API

See [API.md](./API.md) for the full endpoint catalog. Auth:

```http
Authorization: Bearer <HAUSHALT_API_KEY>
```

## Privacy

- No cloud account; the ledger is a local SQLite file under `data/`
- `data/` and `.env` are gitignored — do not commit your bank history or API keys
- Seeds in `src/data/` are generics for **new** installs only; they do not overwrite an existing database
- Never paste CSVs, IBANs, or transaction dumps into issues or pull requests

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the privacy rule, and good first tasks.

Browse [good first issues](https://github.com/mohdahmedasif/haushalt/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) if you want a small place to start.

## Stack

React 19 · Vite · Ant Design · Express · TypeScript · SQLite (`node:sqlite`)

## License

[MIT](./LICENSE)
