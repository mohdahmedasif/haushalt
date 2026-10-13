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
| `KEY` | generated | Admin key for pairing devices and resetting PINs |
| `PORT` | `8787` | Port the app is served on |
| `TRUST_PROXY` | not set | Number of reverse proxies in front of the app, if any |

### Access: pairing and PINs

Haushalt has two layers, so a stranger who finds the URL sees nothing and can guess nothing.

1. **Pairing.** A browser must enter the admin key once before it can do anything at all, including seeing which profiles exist or trying a PIN. Set the key as `KEY` in `.env`; if you leave it unset, one is generated on first start and saved to `data/admin.key`. A paired browser stays paired for a year, renewed every time you unlock.
2. **Profiles.** Each person has a profile with its own books and a PIN of 4 to 8 digits. Day to day you only type the PIN. Five wrong PINs lock the profile for 1 minute, then 5, 30 and 120 minutes for each further wrong one.

The app locks itself after 5 minutes in the background or closed. **Lock now** and **Switch profile** are at the bottom of the menu. Under **Settings** you can change your PIN, unpair this device, unpair all other devices (for a lost phone) and delete the profile. A forgotten PIN is reset from the PIN screen with the admin key, which signs that profile out everywhere.

Each profile's books are a separate database file under `data/profiles/`. If you are upgrading from a version without profiles, the first profile you create takes over the existing books.

**HTTPS.** The pairing and session cookies are marked `Secure`, so browsers only keep them over HTTPS. Plain `http://` works on `localhost` only. To use the app from another device, put it behind HTTPS (a reverse proxy with a certificate, or Tailscale's HTTPS), and set `TRUST_PROXY` if a proxy is in front.

**Behind a proxy without `TRUST_PROXY`,** rate limits become shared. The limit of 20 pairing attempts per 5 minutes counts everyone together instead of per visitor. Guessing is still capped just as hard, but someone hammering the pairing screen could block you from pairing a new device for a few minutes.

### Gemini (optional)

Contract labeling can use Google Gemini. Add your API key under **Settings** and pick a model from the list your key can use. The key is stored encrypted in the database (AES-256-GCM, with a per-install secret in `data/secret.key`) and is never sent back to the browser. A backup restored on another machine cannot decrypt it, so you enter the key again there. Without a key, contracts are labeled locally and nothing leaves your machine.

## Backup and restore

**Import → Backup** downloads everything in your profile (bookings, categories, budgets, rules, people, cash, gold, settings) as one JSON file. On a fresh install, choose **Restore from a backup** on the welcome screen, or use **Import → Restore**, and upload that file to get the exact same state back. Restoring replaces whatever is in that profile; other profiles, PINs and paired devices are not part of a backup. The file holds your full bank history, so store it somewhere private.

## API

See [API.md](./API.md) for the endpoint catalog. The API is for the web app: every route needs a paired device, and data routes need an unlocked profile.

## Tests

`npm test` starts the server on a temporary data folder and checks pairing, PIN lockout and that profiles cannot reach each other's data.

## Privacy

- No cloud account; each profile is a local SQLite file under `data/`
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
