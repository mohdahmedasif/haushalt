# Contributing to Haushalt

Thanks for wanting to help. This is a local-first finance app — keep other people's (and your own) bank data out of the repo.

## Privacy first

Do **not** commit, upload, or paste:

- Bank CSVs or screenshots of a real ledger
- IBANs, account numbers, or counterparties
- `data/haushalt.sqlite` or `.env`
- Real API keys

Use a tiny fake CSV if you need a fixture (made-up names, `DE00…` placeholders, round amounts).

## Dev setup

You need Node.js 22+.

```bash
git clone https://github.com/mohdahmedasif/haushalt.git
cd haushalt
npm install
cp .env.example .env
npm run dev
```

- UI: http://127.0.0.1:5173
- API: http://127.0.0.1:8787/api/v1

`npm run build` typechecks and builds the UI. Run that before you open a PR.

## Pull requests

1. Open an issue first for larger changes, or grab a [good first issue](https://github.com/mohdahmedasif/haushalt/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
2. Keep the diff focused — one problem per PR.
3. Match the existing TypeScript / React style. Do not reformat unrelated files.
4. Describe *why* the change exists, not only what you edited.

## Useful places to contribute

- Extra German bank CSV dialects (DKB, ING, Volksbank) in `src/lib/parseSparkasse.ts`
- Tests around CSV parsing and categorization
- UI copy (German), empty states, accessibility
- Docs and a sanitized product screenshot for the README

## License

By contributing you agree your work is licensed under the [MIT License](./LICENSE).

Please follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
