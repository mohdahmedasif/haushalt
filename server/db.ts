import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { SEED_CATEGORIES } from "../src/data/categories.ts";
import { SEED_PEOPLE } from "../src/data/people.ts";
import { SEED_RULES } from "../src/data/rules.ts";
import { accountFeeMonth, feeSpreadStart, matchPerson, spreadMonthsForCategory } from "../src/lib/categorize.ts";
import { normalizeGoldPieces, piecesFromLegacy, piecesSummary } from "../src/lib/gold.ts";
import { normalizeReimburse } from "../src/lib/lending.ts";
import type {
  AccountState,
  AppSettings,
  CashMovement,
  Category,
  CategoryRule,
  GoldForm,
  GoldLot,
  GoldPiece,
  ImportBatch,
  ParsedRow,
  Person,
  Transaction,
} from "../src/types.ts";

function defaultSettings(): AppSettings {
  return {
    monthBasis: "valueDate",
    skipZeroAmount: true,
    openingBalance: null,
    openingBalanceDate: null,
    onboarded: false,
    bankBalance: null,
    bankBalanceAsOf: null,
  };
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Runtime store only — created and seeded by the API on first start. Do not check in. */
const dataDir = join(root, "data");
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, "haushalt.sqlite"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  budget REAL NOT NULL,
  color TEXT NOT NULL,
  sort INTEGER NOT NULL,
  exclude_from_budget INTEGER NOT NULL,
  show_in_report INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  account_iban TEXT,
  booking_date TEXT,
  value_date TEXT,
  month TEXT,
  booking_text TEXT,
  purpose TEXT,
  counterparty TEXT,
  iban TEXT,
  bic TEXT,
  amount REAL NOT NULL,
  currency TEXT,
  end_to_end_ref TEXT,
  mandate_ref TEXT,
  creditor_id TEXT,
  info TEXT,
  category_id TEXT,
  splits TEXT NOT NULL DEFAULT '[]',
  spread_months INTEGER NOT NULL DEFAULT 1,
  spread_start TEXT,
  excluded INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  loan_person_id TEXT,
  loan_direction TEXT,
  loan_origin_id TEXT,
  import_id TEXT,
  source TEXT NOT NULL DEFAULT 'bank',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  priority INTEGER NOT NULL,
  category_id TEXT NOT NULL,
  field TEXT NOT NULL,
  match TEXT NOT NULL,
  value TEXT NOT NULL,
  note TEXT,
  learned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  aliases TEXT NOT NULL,
  ibans TEXT NOT NULL,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  added INTEGER NOT NULL,
  duplicates INTEGER NOT NULL,
  skipped INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  month TEXT NOT NULL,
  category_id TEXT,
  note TEXT,
  transaction_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gold_lots (
  id TEXT PRIMARY KEY,
  purchased_at TEXT NOT NULL,
  grams REAL NOT NULL,
  purity TEXT NOT NULL,
  form TEXT NOT NULL,
  dealer TEXT,
  invoice_ref TEXT,
  total_paid REAL NOT NULL,
  price_per_gram REAL NOT NULL,
  note TEXT,
  pieces TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

ensureColumn("transactions", "loan_origin_id", "TEXT");
ensureColumn("transactions", "reimburse_amount", "REAL NOT NULL DEFAULT 0");
db.exec(`UPDATE transactions SET reimburse_amount = ABS(amount)
  WHERE reimburse_amount = 0 AND amount < 0 AND category_id IN ('loan_out', 'money_back')`);
db.exec(`UPDATE transactions SET category_id = NULL WHERE category_id = 'money_back'`);
db.exec(`UPDATE transactions SET category_id = 'reimbursement'
  WHERE category_id = 'loan_in' AND loan_origin_id IN (
    SELECT id FROM transactions
    WHERE IFNULL(category_id, '') <> 'loan_out' AND splits NOT LIKE '%"loan_out"%'
  )`);
ensureColumn("gold_lots", "pieces", "TEXT");
const addedShowInReport = ensureColumn("categories", "show_in_report", "INTEGER NOT NULL DEFAULT 0");

function ensureColumn(table: string, name: string, spec: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((col) => col.name === name)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${spec}`);
  return true;
}

export function persistSeedRules(): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO rules (id, priority, category_id, field, match, value, note, learned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of SEED_RULES) {
    insert.run(r.id, r.priority, r.categoryId, r.field, r.match, r.value, r.note ?? "", r.learned ? 1 : 0);
  }
}

export function seedIfEmpty(): void {
  const count = db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number };
  if (count.n > 0) {
    ensureSeedCategories();
    return;
  }

  const insertCat = db.prepare(
    `INSERT INTO categories (id, name, kind, budget, color, sort, exclude_from_budget, show_in_report)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of SEED_CATEGORIES) {
    insertCat.run(
      c.id,
      c.name,
      c.kind,
      c.budget,
      c.color,
      c.sort,
      c.excludeFromBudget ? 1 : 0,
      c.showInReport ? 1 : 0,
    );
  }

  const insertRule = db.prepare(
    `INSERT INTO rules (id, priority, category_id, field, match, value, note, learned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of SEED_RULES) {
    insertRule.run(r.id, r.priority, r.categoryId, r.field, r.match, r.value, r.note ?? "", r.learned ? 1 : 0);
  }

  const insertPerson = db.prepare(
    `INSERT INTO people (id, name, role, aliases, ibans, notes) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const p of SEED_PEOPLE) {
    insertPerson.run(p.id, p.name, p.role, JSON.stringify(p.aliases), JSON.stringify(p.ibans), p.notes);
  }

  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    "settings",
    JSON.stringify(defaultSettings()),
  );
}

/** Add any seed categories missing from an existing DB. */
export function ensureSeedCategories(): void {
  const insertCat = db.prepare(
    `INSERT OR IGNORE INTO categories (id, name, kind, budget, color, sort, exclude_from_budget, show_in_report)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of SEED_CATEGORIES) {
    insertCat.run(
      c.id,
      c.name,
      c.kind,
      c.budget,
      c.color,
      c.sort,
      c.excludeFromBudget ? 1 : 0,
      c.showInReport ? 1 : 0,
    );
  }
  const rename = db.prepare("UPDATE categories SET name=? WHERE id=? AND name=?");
  rename.run("Money Lent", "loan_out", "Money back (expected)");
  for (const old of ["Money Returned", "Money back (received)"]) rename.run("Paid back", "loan_in", old);
  rename.run("Reimbursed", "reimbursement", "Reimbursement");
  db.prepare("DELETE FROM categories WHERE id = 'money_back'").run();
  const insertRule = db.prepare(
    `INSERT OR IGNORE INTO rules (id, priority, category_id, field, match, value, note, learned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of SEED_RULES.filter((rule) => rule.id === "r-cash-deposit" || rule.id === "r-cash-deposit2")) {
    insertRule.run(r.id, r.priority, r.categoryId, r.field, r.match, r.value, r.note ?? "", r.learned ? 1 : 0);
  }
  migrateZakatToDonation();
  removeCashUnclassified();
  if (addedShowInReport) backfillShowInReport();
}

function backfillShowInReport(): void {
  const update = db.prepare("UPDATE categories SET show_in_report = ? WHERE id = ?");
  for (const c of SEED_CATEGORIES) {
    update.run(c.showInReport ? 1 : 0, c.id);
  }
  // User-created expense/income categories default onto the year sheet.
  db.prepare(
    `UPDATE categories SET show_in_report = 1
     WHERE kind IN ('expense', 'income')
       AND id NOT IN (${SEED_CATEGORIES.map(() => "?").join(",")})`,
  ).run(...SEED_CATEGORIES.map((c) => c.id));
}

function migrateZakatToDonation(): void {
  const zakat = db.prepare("SELECT budget FROM categories WHERE id = 'zakat'").get() as { budget: number } | undefined;
  if (!zakat) return;

  const existingDonation = db.prepare("SELECT budget FROM categories WHERE id = 'donation'").get() as
    | { budget: number }
    | undefined;
  if (!existingDonation) {
    insertCategory({
      id: "donation",
      name: "Donation",
      kind: "expense",
      budget: Number(zakat.budget),
      color: "#b7791f",
      sort: 250,
      excludeFromBudget: false,
      showInReport: true,
    });
  } else {
    db.prepare("UPDATE categories SET budget = ? WHERE id = 'donation'").run(
      Math.round((existingDonation.budget + Number(zakat.budget)) * 100) / 100,
    );
  }

  db.prepare("UPDATE transactions SET category_id = 'donation' WHERE category_id = 'zakat'").run();
  db.prepare(
    `UPDATE transactions SET splits = REPLACE(splits, '"categoryId":"zakat"', '"categoryId":"donation"')
     WHERE splits LIKE '%"zakat"%'`,
  ).run();
  db.prepare("UPDATE cash_movements SET category_id = 'donation' WHERE category_id = 'zakat'").run();
  db.prepare("UPDATE rules SET category_id = 'donation' WHERE category_id = 'zakat'").run();
  db.prepare("DELETE FROM categories WHERE id = 'zakat'").run();
}

function removeCashUnclassified(): void {
  const exists = db.prepare("SELECT 1 AS ok FROM categories WHERE id = 'cash_unclassified'").get();
  if (!exists) return;
  db.prepare("UPDATE transactions SET category_id = 'miscellaneous' WHERE category_id = 'cash_unclassified'").run();
  db.prepare(
    `UPDATE transactions SET splits = REPLACE(splits, '"categoryId":"cash_unclassified"', '"categoryId":"miscellaneous"')
     WHERE splits LIKE '%"cash_unclassified"%'`,
  ).run();
  db.prepare("UPDATE cash_movements SET category_id = 'miscellaneous' WHERE category_id = 'cash_unclassified'").run();
  db.prepare("UPDATE rules SET category_id = 'miscellaneous' WHERE category_id = 'cash_unclassified'").run();
  db.prepare("DELETE FROM categories WHERE id = 'cash_unclassified'").run();
}

export function getSettings(): AppSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'settings'").get() as { value: string } | undefined;
  if (!row) return defaultSettings();
  return { ...defaultSettings(), ...(JSON.parse(row.value) as Partial<AppSettings>) };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch };
  db.prepare("INSERT INTO settings (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify(next),
  );
  return next;
}

export function currentBankBalance(): number {
  const opening = getSettings().openingBalance ?? 0;
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS bal FROM transactions WHERE source = 'bank'`,
  ).get() as { bal: number };
  return Math.round((opening + Number(row.bal)) * 100) / 100;
}

export function currentBankBalanceAsOf(): string | null {
  const row = db.prepare(
    `SELECT value_date, booking_date FROM transactions
     WHERE source = 'bank'
     ORDER BY value_date DESC, booking_date DESC, id DESC
     LIMIT 1`,
  ).get() as { value_date: string; booking_date: string } | undefined;
  if (row) return row.value_date || row.booking_date || null;
  return getSettings().openingBalanceDate;
}

export function accountState(): AccountState {
  const settings = getSettings();
  return {
    bankBalance: currentBankBalance(),
    bankBalanceAsOf: currentBankBalanceAsOf(),
    cashOnHand: cashBalance(),
    openingBalance: settings.openingBalance ?? 0,
    openingBalanceDate: settings.openingBalanceDate,
    onboarded: Boolean(settings.onboarded),
  };
}

export function resetLedger(): AccountState {
  db.exec("DELETE FROM cash_movements");
  db.exec("DELETE FROM transactions");
  db.exec("DELETE FROM imports");
  db.exec("DELETE FROM rules WHERE learned = 1");
  persistSeedRules();
  saveSettings(defaultSettings());
  return accountState();
}

export function listCategories(): Category[] {
  const rows = db.prepare("SELECT * FROM categories ORDER BY kind, sort").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as Category["kind"],
    budget: Number(r.budget),
    color: String(r.color),
    sort: Number(r.sort),
    excludeFromBudget: Boolean(r.exclude_from_budget),
    showInReport: Boolean(r.show_in_report),
  }));
}

export function listRules(): CategoryRule[] {
  const rows = db.prepare("SELECT * FROM rules ORDER BY priority, id").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    priority: Number(r.priority),
    categoryId: String(r.category_id),
    field: r.field as CategoryRule["field"],
    match: r.match as CategoryRule["match"],
    value: String(r.value),
    note: String(r.note ?? ""),
    learned: Boolean(r.learned),
  }));
}

export function listPeople(): Person[] {
  const rows = db.prepare("SELECT * FROM people ORDER BY name").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    role: r.role as Person["role"],
    aliases: JSON.parse(String(r.aliases)),
    ibans: JSON.parse(String(r.ibans)),
    notes: String(r.notes ?? ""),
  }));
}

export function insertPerson(person: Person): void {
  db.prepare(
    `INSERT INTO people (id, name, role, aliases, ibans, notes) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(person.id, person.name, person.role, JSON.stringify(person.aliases), JSON.stringify(person.ibans), person.notes);
}

export function findOrCreateBorrower(name: string, iban = ""): Person {
  const people = listPeople();
  const matched = matchPerson({ counterparty: name, iban }, people);
  if (matched) return matched;
  const trimmed = name.trim() || "Borrower";
  const base = `borrower-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "person"}`;
  let id = base;
  let n = 2;
  while (people.some((person) => person.id === id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  const person: Person = {
    id,
    name: trimmed,
    role: "borrower",
    aliases: [trimmed],
    ibans: iban.replace(/\s/g, "") ? [iban.replace(/\s/g, "").toUpperCase()] : [],
    notes: "Created when money was marked as lent",
  };
  insertPerson(person);
  return person;
}

export function listTransactions(): Transaction[] {
  const rows = db.prepare("SELECT * FROM transactions ORDER BY value_date DESC, booking_date DESC").all() as Record<string, unknown>[];
  return rows.map(rowToTransaction);
}

export function getTransaction(id: string): Transaction | undefined {
  const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToTransaction(row) : undefined;
}

export function listImports(): ImportBatch[] {
  const rows = db.prepare("SELECT * FROM imports ORDER BY imported_at DESC").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    fileName: String(r.file_name),
    importedAt: String(r.imported_at),
    added: Number(r.added),
    duplicates: Number(r.duplicates),
    skipped: Number(r.skipped),
  }));
}

export function listCashMovements(): CashMovement[] {
  const rows = db.prepare("SELECT * FROM cash_movements ORDER BY date DESC, created_at DESC").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    type: r.type as CashMovement["type"],
    amount: Number(r.amount),
    date: String(r.date),
    month: String(r.month),
    categoryId: r.category_id ? String(r.category_id) : null,
    note: String(r.note ?? ""),
    transactionId: r.transaction_id ? String(r.transaction_id) : null,
    createdAt: String(r.created_at),
  }));
}

export function cashBalance(): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN type IN ('cash_out', 'bank_out') THEN -amount ELSE amount END
    ), 0) AS bal
    FROM cash_movements
  `).get() as { bal: number };
  return Math.round(Number(row.bal) * 100) / 100;
}

export function replaceOpeningCash(amount: number, date: string): void {
  db.prepare("DELETE FROM cash_movements WHERE type = 'opening'").run();
  if (!(amount > 0)) return;
  insertCashMovement({
    id: crypto.randomUUID(),
    type: "opening",
    amount: Math.round(amount * 100) / 100,
    date,
    month: date.slice(0, 7),
    categoryId: null,
    note: "Opening cash",
    transactionId: null,
    createdAt: new Date().toISOString(),
  });
}

export function insertTransaction(input: Transaction): void {
  const tx = normalizeReimburse(input);
  db.prepare(
    `INSERT INTO transactions (
      id, fingerprint, account_iban, booking_date, value_date, month, booking_text, purpose,
      counterparty, iban, bic, amount, currency, end_to_end_ref, mandate_ref, creditor_id, info,
      category_id, splits, spread_months, spread_start, excluded, notes, loan_person_id,
      loan_direction, loan_origin_id, import_id, source, created_at, reimburse_amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    tx.id,
    tx.fingerprint,
    tx.accountIban,
    tx.bookingDate,
    tx.valueDate,
    tx.month,
    tx.bookingText,
    tx.purpose,
    tx.counterparty,
    tx.iban,
    tx.bic,
    tx.amount,
    tx.currency,
    tx.endToEndRef,
    tx.mandateRef,
    tx.creditorId,
    tx.info,
    tx.categoryId,
    JSON.stringify(tx.splits),
    tx.spreadMonths,
    tx.spreadStart,
    tx.excluded ? 1 : 0,
    tx.notes,
    tx.loanPersonId,
    tx.loanDirection,
    tx.loanOriginId,
    tx.importId,
    tx.source,
    tx.createdAt,
    tx.reimburseAmount,
  );
}

export function updateTransaction(id: string, patch: Partial<Transaction>): Transaction | undefined {
  const current = getTransaction(id);
  if (!current) return undefined;
  const next = normalizeReimburse({ ...current, ...patch, id: current.id, fingerprint: current.fingerprint });
  db.prepare(
    `UPDATE transactions SET
      category_id=?, splits=?, spread_months=?, spread_start=?, excluded=?, notes=?,
      loan_person_id=?, loan_direction=?, loan_origin_id=?, month=?, reimburse_amount=?
     WHERE id=?`,
  ).run(
    next.categoryId,
    JSON.stringify(next.splits),
    next.spreadMonths,
    next.spreadStart,
    next.excluded ? 1 : 0,
    next.notes,
    next.loanPersonId,
    next.loanDirection,
    next.loanOriginId,
    next.month,
    next.reimburseAmount,
    id,
  );
  return getTransaction(id);
}

export function insertCashMovement(m: CashMovement): void {
  db.prepare(
    `INSERT INTO cash_movements (id, type, amount, date, month, category_id, note, transaction_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(m.id, m.type, m.amount, m.date, m.month, m.categoryId, m.note, m.transactionId, m.createdAt);
}

const EDITABLE_CASH_TYPES = new Set<CashMovement["type"]>(["cash_in", "cash_out", "bank_out"]);

export function getCashMovement(id: string): CashMovement | undefined {
  return listCashMovements().find((m) => m.id === id);
}

export function getCashMovementByTransaction(transactionId: string): CashMovement | undefined {
  return listCashMovements().find((m) => m.transactionId === transactionId);
}

export function syncCashMovementCategory(transactionId: string, categoryId: string | null): void {
  db.prepare("UPDATE cash_movements SET category_id = ? WHERE transaction_id = ?").run(categoryId, transactionId);
}

/** Keep wallet in sync when a bank booking is tagged ATM / cash deposit (or untagged). */
export function syncWalletForBankTransfer(tx: Transaction, previousCategoryId: string | null): void {
  if (tx.source !== "bank") return;

  const linked = getCashMovementByTransaction(tx.id);
  const wantsAtm = tx.categoryId === "to_cash" && tx.amount < 0;
  const wantsDeposit = tx.categoryId === "from_cash" && tx.amount > 0;

  if (!wantsAtm && !wantsDeposit) {
    if (
      linked &&
      ((previousCategoryId === "to_cash" && linked.type === "atm_in") ||
        (previousCategoryId === "from_cash" && linked.type === "bank_out"))
    ) {
      db.prepare("DELETE FROM cash_movements WHERE id = ?").run(linked.id);
    }
    return;
  }

  const amount = Math.abs(tx.amount);
  const date = tx.valueDate || tx.bookingDate;
  const month = date.slice(0, 7);
  const type = wantsAtm ? "atm_in" : "bank_out";
  const categoryId = wantsAtm ? "to_cash" : "from_cash";
  const note = wantsAtm ? tx.purpose || "ATM withdrawal" : tx.purpose || "Cash to bank";

  if (linked) {
    db.prepare(
      `UPDATE cash_movements SET type = ?, amount = ?, date = ?, month = ?, category_id = ?, note = ? WHERE id = ?`,
    ).run(type, amount, date, month, categoryId, note, linked.id);
    return;
  }

  if (wantsDeposit) {
    const orphan = listCashMovements().find(
      (m) =>
        m.type === "bank_out" &&
        !m.transactionId &&
        Math.abs(m.amount - amount) < 0.005 &&
        Math.abs(Date.parse(m.date) - Date.parse(date)) <= 7 * 86400000,
    );
    if (orphan) {
      db.prepare(
        `UPDATE cash_movements SET transaction_id = ?, category_id = ?, date = ?, month = ?, note = ? WHERE id = ?`,
      ).run(tx.id, categoryId, date, month, orphan.note || note, orphan.id);
      return;
    }
  }

  insertCashMovement({
    id: crypto.randomUUID(),
    type,
    amount,
    date,
    month,
    categoryId,
    note,
    transactionId: tx.id,
    createdAt: new Date().toISOString(),
  });
}

export function updateCashMovement(
  id: string,
  patch: { amount?: number; date?: string; categoryId?: string | null; note?: string },
): CashMovement | undefined {
  const current = getCashMovement(id);
  if (!current || !EDITABLE_CASH_TYPES.has(current.type)) return undefined;
  // Bank-linked ATM / deposit rows follow the bank booking — edit there.
  if (current.transactionId) {
    const linked = getTransaction(current.transactionId);
    if (linked?.source === "bank") return undefined;
  }

  const amount = patch.amount != null ? Math.abs(Number(patch.amount)) : current.amount;
  const date = patch.date ?? current.date;
  const month = date.slice(0, 7);
  const categoryId =
    current.type === "bank_out"
      ? "from_cash"
      : patch.categoryId !== undefined
        ? patch.categoryId
        : current.categoryId;
  const note = patch.note !== undefined ? patch.note : current.note;

  if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;

  db.prepare(
    `UPDATE cash_movements SET amount = ?, date = ?, month = ?, category_id = ?, note = ? WHERE id = ?`,
  ).run(amount, date, month, categoryId, note, id);

  if (current.transactionId) {
    const tx = getTransaction(current.transactionId);
    if (tx && tx.source === "cash") {
      const signed = current.type === "cash_out" ? -amount : amount;
      const catName =
        (categoryId && listCategories().find((c) => c.id === categoryId)?.name) ||
        (current.type === "cash_out" ? "Cash spend" : "Cash in");
      const bookingText = note || (current.type === "cash_out" ? "Cash spend" : "Cash in");
      db.prepare(
        `UPDATE transactions SET
          booking_date = ?, value_date = ?, month = ?, amount = ?,
          booking_text = ?, purpose = ?, counterparty = ?, notes = ?, category_id = ?
         WHERE id = ?`,
      ).run(date, date, month, signed, bookingText, note, catName, note, categoryId, current.transactionId);
      const refreshed = getTransaction(current.transactionId);
      if (refreshed) {
        const normalized = normalizeReimburse(refreshed);
        if (normalized.reimburseAmount !== refreshed.reimburseAmount) {
          db.prepare("UPDATE transactions SET reimburse_amount = ? WHERE id = ?").run(
            normalized.reimburseAmount,
            current.transactionId,
          );
        }
      }
    }
  }

  return getCashMovement(id);
}

export function deleteCashMovement(id: string): boolean {
  const current = getCashMovement(id);
  if (!current || !EDITABLE_CASH_TYPES.has(current.type)) return false;
  if (current.transactionId) {
    const linked = getTransaction(current.transactionId);
    if (linked?.source === "bank") return false;
  }
  db.prepare("DELETE FROM cash_movements WHERE id = ?").run(id);
  if (current.transactionId) {
    const tx = getTransaction(current.transactionId);
    if (tx?.source === "cash") db.prepare("DELETE FROM transactions WHERE id = ?").run(current.transactionId);
  }
  return true;
}

function parseJson(value: unknown): unknown {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function goldPiecesFromRow(r: Record<string, unknown>): GoldPiece[] {
  const pieces = normalizeGoldPieces(parseJson(r.pieces)).filter((piece) => piece.grams > 0);
  if (pieces.length) return pieces;
  return piecesFromLegacy(String(r.id), Number(r.grams), String(r.purity ?? ""), (r.form as GoldForm) || "bar");
}

function backfillGoldPieces(): void {
  const rows = db.prepare("SELECT id, grams, purity, form, pieces FROM gold_lots").all() as Record<string, unknown>[];
  const update = db.prepare("UPDATE gold_lots SET pieces = ? WHERE id = ?");
  for (const row of rows) {
    const raw = String(row.pieces ?? "").trim();
    if (raw && raw !== "[]") continue;
    update.run(JSON.stringify(goldPiecesFromRow(row)), String(row.id));
  }
}

backfillGoldPieces();

function rowToGoldLot(r: Record<string, unknown>): GoldLot {
  const pieces = goldPiecesFromRow(r);
  const summary = piecesSummary(pieces);
  return {
    id: String(r.id),
    purchasedAt: String(r.purchased_at),
    grams: summary.grams || Number(r.grams),
    purity: summary.purity,
    form: summary.form,
    dealer: String(r.dealer ?? ""),
    invoiceRef: String(r.invoice_ref ?? ""),
    totalPaid: Number(r.total_paid),
    pricePerGram: Number(r.price_per_gram),
    note: String(r.note ?? ""),
    pieces,
    createdAt: String(r.created_at),
  };
}

export function listGoldLots(): GoldLot[] {
  const rows = db.prepare("SELECT * FROM gold_lots ORDER BY purchased_at DESC, created_at DESC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(rowToGoldLot);
}

export function getGoldLot(id: string): GoldLot | undefined {
  const row = db.prepare("SELECT * FROM gold_lots WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToGoldLot(row) : undefined;
}

export function insertGoldLot(lot: GoldLot): void {
  const pieces = lot.pieces?.length ? lot.pieces : piecesFromLegacy(lot.id, lot.grams, lot.purity, lot.form);
  const summary = piecesSummary(pieces);
  db.prepare(
    `INSERT INTO gold_lots (
      id, purchased_at, grams, purity, form, dealer, invoice_ref, total_paid, price_per_gram, note, pieces, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    lot.id,
    lot.purchasedAt,
    summary.grams || lot.grams,
    summary.purity,
    summary.form,
    lot.dealer,
    lot.invoiceRef,
    lot.totalPaid,
    lot.pricePerGram,
    lot.note,
    JSON.stringify(pieces),
    lot.createdAt,
  );
}

export function updateGoldLot(id: string, patch: Partial<GoldLot>): GoldLot | undefined {
  const current = getGoldLot(id);
  if (!current) return undefined;
  const next = { ...current, ...patch, id: current.id, createdAt: current.createdAt };
  const pieces = next.pieces?.length ? next.pieces : piecesFromLegacy(next.id, next.grams, next.purity, next.form);
  const summary = piecesSummary(pieces);
  next.pieces = pieces;
  next.grams = summary.grams;
  next.purity = summary.purity;
  next.form = summary.form;
  next.pricePerGram = next.grams > 0 ? Math.round((next.totalPaid / next.grams) * 100) / 100 : 0;
  db.prepare(
    `UPDATE gold_lots SET
      purchased_at=?, grams=?, purity=?, form=?, dealer=?, invoice_ref=?, total_paid=?, price_per_gram=?, note=?, pieces=?
     WHERE id=?`,
  ).run(
    next.purchasedAt,
    next.grams,
    next.purity,
    next.form,
    next.dealer,
    next.invoiceRef,
    next.totalPaid,
    next.pricePerGram,
    next.note,
    JSON.stringify(next.pieces),
    id,
  );
  return getGoldLot(id);
}

export function deleteGoldLot(id: string): boolean {
  return db.prepare("DELETE FROM gold_lots WHERE id = ?").run(id).changes > 0;
}

export function insertImport(batch: ImportBatch): void {
  db.prepare(
    `INSERT INTO imports (id, file_name, imported_at, added, duplicates, skipped) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(batch.id, batch.fileName, batch.importedAt, batch.added, batch.duplicates, batch.skipped);
}

export function insertRule(rule: CategoryRule): void {
  db.prepare(
    `INSERT INTO rules (id, priority, category_id, field, match, value, note, learned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(rule.id, rule.priority, rule.categoryId, rule.field, rule.match, rule.value, rule.note ?? "", rule.learned ? 1 : 0);
}

export function deleteRule(id: string): boolean {
  return db.prepare(`DELETE FROM rules WHERE id = ?`).run(id).changes > 0;
}

export function insertCategory(category: Category): void {
  db.prepare(
    `INSERT INTO categories (id, name, kind, budget, color, sort, exclude_from_budget, show_in_report)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    category.id,
    category.name,
    category.kind,
    category.budget,
    category.color,
    category.sort,
    category.excludeFromBudget ? 1 : 0,
    category.showInReport ? 1 : 0,
  );
}

export function updateCategory(
  id: string,
  patch: { budget?: number; name?: string; showInReport?: boolean },
): Category | undefined {
  const current = listCategories().find((c) => c.id === id);
  if (!current) return undefined;
  const next = {
    ...current,
    budget: patch.budget !== undefined ? patch.budget : current.budget,
    name: patch.name !== undefined ? patch.name : current.name,
    showInReport: patch.showInReport !== undefined ? patch.showInReport : current.showInReport,
  };
  if (!next.name.trim()) return undefined;
  db.prepare("UPDATE categories SET budget=?, name=?, show_in_report=? WHERE id=?").run(
    next.budget,
    next.name.trim(),
    next.showInReport ? 1 : 0,
    id,
  );
  return listCategories().find((c) => c.id === id);
}

/** @deprecated Prefer updateCategory */
export function updateCategoryBudget(id: string, budget: number, name?: string): void {
  updateCategory(id, { budget, name });
}

export function categoryUsage(id: string): { bookings: number; rules: number } {
  const tx = db
    .prepare(
      `SELECT COUNT(*) AS n FROM transactions
       WHERE category_id = ? OR splits LIKE ?`,
    )
    .get(id, `%"categoryId":"${id}"%`) as { n: number };
  const cash = db.prepare("SELECT COUNT(*) AS n FROM cash_movements WHERE category_id = ?").get(id) as { n: number };
  const rules = db.prepare("SELECT COUNT(*) AS n FROM rules WHERE category_id = ?").get(id) as { n: number };
  return { bookings: Number(tx.n) + Number(cash.n), rules: Number(rules.n) };
}

export function deleteCategory(
  id: string,
  moveToId?: string | null,
): { ok: true } | { ok: false; error: string } {
  const current = listCategories().find((c) => c.id === id);
  if (!current) return { ok: false, error: "Category not found" };
  if (current.kind === "transfer") {
    return { ok: false, error: "Transfer categories cannot be deleted" };
  }

  const usage = categoryUsage(id);
  const moveTo = moveToId ? listCategories().find((c) => c.id === moveToId) : undefined;

  if (usage.bookings > 0) {
    if (!moveTo) return { ok: false, error: "Pick a category to move existing bookings into" };
    if (moveTo.id === id) return { ok: false, error: "Move target must be a different category" };
    if (moveTo.kind === "transfer") {
      return { ok: false, error: "Cannot move bookings into a transfer category" };
    }
    if (moveTo.kind !== current.kind) {
      return { ok: false, error: `Move target must be ${current.kind}` };
    }
    reassignCategory(id, moveTo.id);
    db.prepare("UPDATE categories SET budget = ? WHERE id = ?").run(
      Math.round((moveTo.budget + current.budget) * 100) / 100,
      moveTo.id,
    );
  } else if (moveTo) {
    if (moveTo.id === id) return { ok: false, error: "Move target must be a different category" };
    if (moveTo.kind !== current.kind) {
      return { ok: false, error: `Move target must be ${current.kind}` };
    }
    db.prepare("UPDATE rules SET category_id = ? WHERE category_id = ?").run(moveTo.id, id);
    db.prepare("UPDATE categories SET budget = ? WHERE id = ?").run(
      Math.round((moveTo.budget + current.budget) * 100) / 100,
      moveTo.id,
    );
  } else {
    // No bookings — drop rules that pointed here.
    db.prepare("DELETE FROM rules WHERE category_id = ?").run(id);
  }

  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  return { ok: true };
}

function reassignCategory(fromId: string, toId: string): void {
  db.prepare("UPDATE transactions SET category_id = ? WHERE category_id = ?").run(toId, fromId);
  const splitRows = db
    .prepare(`SELECT id, splits FROM transactions WHERE splits LIKE ?`)
    .all(`%"categoryId":"${fromId}"%`) as { id: string; splits: string }[];
  const updateSplits = db.prepare("UPDATE transactions SET splits = ? WHERE id = ?");
  for (const row of splitRows) {
    try {
      const splits = JSON.parse(String(row.splits || "[]")) as { categoryId?: string }[];
      if (!Array.isArray(splits)) continue;
      const next = splits.map((line) =>
        line?.categoryId === fromId ? { ...line, categoryId: toId } : line,
      );
      updateSplits.run(JSON.stringify(next), row.id);
    } catch {
      /* keep original */
    }
  }
  db.prepare("UPDATE cash_movements SET category_id = ? WHERE category_id = ?").run(toId, fromId);
  db.prepare("UPDATE rules SET category_id = ? WHERE category_id = ?").run(toId, fromId);
}

export type ImportMatchKind = "fingerprint" | "endToEnd" | "settled" | "soft";

export function findImportMatch(row: ParsedRow): { kind: ImportMatchKind; tx: Transaction } | null {
  const byFingerprint = db.prepare("SELECT * FROM transactions WHERE fingerprint = ?").get(row.fingerprint) as
    | Record<string, unknown>
    | undefined;
  if (byFingerprint) return { kind: "fingerprint", tx: rowToTransaction(byFingerprint) };

  const endToEnd = row.endToEndRef.trim();
  if (endToEnd) {
    const found = db
      .prepare(
        `SELECT * FROM transactions
         WHERE source = 'bank' AND end_to_end_ref = ? AND ROUND(amount * 100) = ROUND(? * 100)
         LIMIT 1`,
      )
      .get(endToEnd, row.amount) as Record<string, unknown> | undefined;
    if (found) return { kind: "endToEnd", tx: rowToTransaction(found) };
  }

  const purpose = row.purpose.trim();
  const valueDate = row.valueDate || row.bookingDate;
  if (purpose && valueDate) {
    const found = db
      .prepare(
        `SELECT * FROM transactions
         WHERE source = 'bank' AND purpose = ? AND value_date = ? AND ROUND(amount * 100) = ROUND(? * 100)
         LIMIT 1`,
      )
      .get(purpose, valueDate, row.amount) as Record<string, unknown> | undefined;
    if (found) return { kind: "settled", tx: rowToTransaction(found) };
  }

  const date = valueDate || row.bookingDate;
  const soft = db
    .prepare(
      `SELECT * FROM transactions
       WHERE source = 'bank'
         AND counterparty = ?
         AND iban = ?
         AND ROUND(amount * 100) = ROUND(? * 100)
         AND (value_date = ? OR booking_date = ?)
       LIMIT 1`,
    )
    .get(row.counterparty, row.iban, row.amount, date, row.bookingDate) as Record<string, unknown> | undefined;
  if (soft) return { kind: "soft", tx: rowToTransaction(soft) };
  return null;
}

export function adoptImportedDetails(id: string, row: ParsedRow): void {
  db.prepare(
    `UPDATE transactions
     SET fingerprint = ?, booking_date = ?, value_date = ?, booking_text = ?,
         end_to_end_ref = ?, purpose = ?
     WHERE id = ?`,
  ).run(row.fingerprint, row.bookingDate, row.valueDate, row.bookingText, row.endToEndRef, row.purpose, id);
}

function rowToTransaction(r: Record<string, unknown>): Transaction {
  return {
    id: String(r.id),
    fingerprint: String(r.fingerprint),
    accountIban: String(r.account_iban ?? ""),
    bookingDate: String(r.booking_date ?? ""),
    valueDate: String(r.value_date ?? ""),
    month: String(r.month ?? ""),
    bookingText: String(r.booking_text ?? ""),
    purpose: String(r.purpose ?? ""),
    counterparty: String(r.counterparty ?? ""),
    iban: String(r.iban ?? ""),
    bic: String(r.bic ?? ""),
    amount: Number(r.amount),
    currency: String(r.currency ?? "EUR"),
    endToEndRef: String(r.end_to_end_ref ?? ""),
    mandateRef: String(r.mandate_ref ?? ""),
    creditorId: String(r.creditor_id ?? ""),
    info: String(r.info ?? ""),
    categoryId: r.category_id ? String(r.category_id) : null,
    splits: JSON.parse(String(r.splits || "[]")),
    spreadMonths: Number(r.spread_months ?? 1),
    spreadStart: r.spread_start ? String(r.spread_start) : null,
    excluded: Boolean(r.excluded),
    notes: String(r.notes ?? ""),
    loanPersonId: r.loan_person_id ? String(r.loan_person_id) : null,
    loanDirection: (r.loan_direction as Transaction["loanDirection"]) ?? null,
    loanOriginId: r.loan_origin_id ? String(r.loan_origin_id) : null,
    reimburseAmount: Number(r.reimburse_amount ?? 0),
    importId: r.import_id ? String(r.import_id) : null,
    source: (r.source as Transaction["source"]) || "bank",
    createdAt: String(r.created_at),
  };
}

export function repairSpreads(): void {
  const bank = listTransactions()
    .filter((tx) => tx.source === "bank" && tx.categoryId)
    .sort((a, b) => (a.valueDate || a.bookingDate).localeCompare(b.valueDate || b.bookingDate));

  const byCat = new Map<string, Transaction[]>();
  for (const tx of bank) {
    const list = byCat.get(tx.categoryId!) ?? [];
    list.push(tx);
    byCat.set(tx.categoryId!, list);
  }

  for (const tx of bank) {
    let months = spreadMonthsForCategory(tx.categoryId!, tx.amount, tx.counterparty, tx.purpose);
    const peers = byCat.get(tx.categoryId!) ?? [];
    const nextAnnual = peers.find((other) => {
      if (other.month <= tx.month) return false;
      return spreadMonthsForCategory(other.categoryId!, other.amount, other.counterparty, other.purpose) > 1;
    });
    if (nextAnnual && months > 1) {
      const gap = monthGap(tx.month, nextAnnual.month);
      months = Math.max(1, Math.min(months, gap));
    }
    const start = months > 1 ? feeSpreadStart(tx.purpose, tx.spreadStart || tx.month) : null;
    if (tx.spreadMonths === months && tx.spreadStart === start) continue;
    updateTransaction(tx.id, {
      spreadMonths: months,
      spreadStart: start,
    });
  }
}

export function repairAccountFeeMonths(): void {
  for (const tx of listTransactions()) {
    const month = accountFeeMonth(tx.valueDate || tx.bookingDate, tx.bookingText);
    if (!month || month === tx.month) continue;
    updateTransaction(tx.id, { month });
  }
}

function monthGap(from: string, to: string): number {
  const [y1, m1] = from.split("-").map(Number);
  const [y2, m2] = to.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
