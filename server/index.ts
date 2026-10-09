import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { accountFeeMonth, feeSpreadStart, learnRuleFrom, suggestCategory } from "../src/lib/categorize.ts";
import { currentMonth, monthKey } from "../src/lib/dates.ts";
import { parseSparkasseCsv } from "../src/lib/parseSparkasse.ts";
import { buildInsights } from "../src/lib/insights.ts";
import { detectContracts } from "../src/lib/contracts.ts";
import { enrichContractsWithAI } from "../src/lib/ai.ts";
import { buildForecast } from "../src/lib/forecast.ts";
import { answerFinanceQuestion } from "../src/lib/ask.ts";
import { summarizeMonth } from "../src/lib/summary.ts";
import { buildYearSheet } from "../src/lib/report.ts";
import {
  buildLending,
  loanShare,
  normalizeReimburse,
  originKind,
  PAYBACK_CATEGORIES,
  paybackCategory,
  reimburseAfterLink,
} from "../src/lib/lending.ts";
import { goldPiecesError, goldTotals, normalizeGoldPieces, piecesSummary } from "../src/lib/gold.ts";
import type { CashMovement, GoldForm, GoldLot, GoldPiece, ImportPreviewRow, Transaction } from "../src/types.ts";
import {
  adoptImportedDetails,
  cashBalance,
  replaceOpeningCash,
  db,
  findImportMatch,
  getSettings,
  getTransaction,
  insertCashMovement,
  updateCashMovement,
  deleteCashMovement,
  syncCashMovementCategory,
  syncWalletForBankTransfer,
  insertCategory,
  insertGoldLot,
  updateGoldLot,
  deleteGoldLot,
  getGoldLot,
  listGoldLots,
  insertImport,
  findOrCreateBorrower,
  insertRule,
  deleteRule,
  insertTransaction,
  listCashMovements,
  listCategories,
  listImports,
  listPeople,
  listRules,
  listTransactions,
  saveSettings,
  accountState,
  currentBankBalance,
  currentBankBalanceAsOf,
  resetLedger,
  seedIfEmpty,
  ensureSeedCategories,
  repairAccountFeeMonths,
  repairSpreads,
  updateCategory,
  deleteCategory,
  updateTransaction,
  exportBackup,
  restoreBackup,
} from "./db.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(join(root, ".env"));

const API_KEY = process.env.HAUSHALT_API_KEY || "haushalt-local";
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);

seedIfEmpty();
ensureSeedCategories();
repairAccountFeeMonths();
repairSpreads();

const app = express();
app.use(cors());
// A full backup can outgrow the normal body limit; once parsed here the default parser skips it.
app.use("/api/v1/backup/restore", express.json({ limit: "512mb" }));
app.use(express.json({ limit: "12mb" }));

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/v1" && req.method === "GET") return next();
  if (req.path === "/v1/health") return next();
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.header("x-api-key") || "";
  if (token !== API_KEY) {
    res.status(401).json({ error: "Unauthorized. Send Authorization: Bearer <HAUSHALT_API_KEY>." });
    return;
  }
  next();
});

app.get("/api/v1/health", (_req, res) => {
  res.json({ ok: true, name: "haushalt", version: "v1" });
});

app.get("/api/v1", (_req, res) => {
  res.json({
    name: "Haushalt API",
    version: "v1",
    auth: "Authorization: Bearer <HAUSHALT_API_KEY>",
    endpoints: [
      "GET /api/v1/health",
      "GET /api/v1/summary?month=YYYY-MM",
      "GET /api/v1/account",
      "POST /api/v1/setup  { openingBalance, openingBalanceDate, openingCash?, onboarded? }",
      "POST /api/v1/reset",
      "PATCH /api/v1/settings  { openingBalance, openingBalanceDate }",
      "GET /api/v1/categories",
      "POST /api/v1/categories  { name, kind, budget? }",
      "PATCH /api/v1/categories/:id  { budget?, name?, showInReport? }",
      "DELETE /api/v1/categories/:id  { moveTo? }",
      "GET /api/v1/transactions?month=&uncategorized=&category=",
      "PATCH /api/v1/transactions/:id",
      "POST /api/v1/imports/preview  { fileName, csvText }",
      "POST /api/v1/imports  { fileName, csvText, includeSoft }",
      "GET /api/v1/imports",
      "GET /api/v1/cash",
      "POST /api/v1/cash/movements  { type: in|out|bank|opening, amount, categoryId?, date, note? }",
      "PATCH /api/v1/cash/movements/:id  { amount?, date?, categoryId?, note? }",
      "DELETE /api/v1/cash/movements/:id",
      "GET /api/v1/gold",
      "POST /api/v1/gold  { purchasedAt, pieces?: [{ grams, form?, purity?, note? }], grams?, purity?, form?, dealer?, invoiceRef?, totalPaid, note? }",
      "PATCH /api/v1/gold/:id",
      "DELETE /api/v1/gold/:id",
      "GET /api/v1/lending",
      "GET /api/v1/contracts",
      "POST /api/v1/contracts/analyze",
      "GET /api/v1/forecast",
      "POST /api/v1/ask  { question, month? }",
      "GET /api/v1/report?year=YYYY",
      "GET /api/v1/people",
      "POST /api/v1/people",
      "GET /api/v1/rules",
      "POST /api/v1/rules",
      "DELETE /api/v1/rules/:id",
      "POST /api/v1/rules/apply",
      "GET /api/v1/export",
      "GET /api/v1/backup",
      "POST /api/v1/backup/restore  <backup file contents>",
    ],
  });
});

app.get("/api/v1/categories", (_req, res) => {
  res.json(listCategories());
});

app.post("/api/v1/categories", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const kind = req.body?.kind === "income" ? "income" : "expense";
  const budget = Number(req.body?.budget ?? 0);
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (Number.isNaN(budget) || budget < 0) {
    res.status(400).json({ error: "budget must be 0 or more" });
    return;
  }
  const existing = listCategories();
  const id = uniqueCategoryId(name, existing);
  const sort =
    Math.max(0, ...existing.filter((c) => c.kind === kind).map((c) => c.sort)) + 10;
  const colors = ["#2f5d50", "#c4a35a", "#b4533c", "#2b6cb0", "#805ad5", "#c05621", "#2c7a7b", "#b7791f"];
  const category = {
    id,
    name,
    kind,
    budget,
    color: colors[existing.length % colors.length],
    sort,
    excludeFromBudget: false,
    showInReport: true,
  };
  insertCategory(category);
  res.status(201).json(category);
});

app.patch("/api/v1/categories/:id", (req, res) => {
  const body = req.body ?? {};
  const patch: { budget?: number; name?: string; showInReport?: boolean } = {};
  if ("budget" in body) {
    const budget = Number(body.budget);
    if (Number.isNaN(budget) || budget < 0) {
      res.status(400).json({ error: "budget must be 0 or more" });
      return;
    }
    patch.budget = budget;
  }
  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) {
      res.status(400).json({ error: "name cannot be empty" });
      return;
    }
    patch.name = name;
  }
  if ("showInReport" in body) patch.showInReport = Boolean(body.showInReport);
  if (!("budget" in patch) && !("name" in patch) && !("showInReport" in patch)) {
    res.status(400).json({ error: "budget, name, or showInReport required" });
    return;
  }
  const updated = updateCategory(req.params.id, patch);
  if (!updated) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  res.json(updated);
});

app.delete("/api/v1/categories/:id", (req, res) => {
  const moveTo = req.body?.moveTo
    ? String(req.body.moveTo)
    : req.query.moveTo
      ? String(req.query.moveTo)
      : null;
  const result = deleteCategory(req.params.id, moveTo);
  if (!result.ok) {
    res.status(result.error === "Category not found" ? 404 : 400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, categories: listCategories() });
});

app.get("/api/v1/people", (_req, res) => {
  res.json(listPeople());
});

app.post("/api/v1/people", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const iban = String(req.body?.iban ?? "").replace(/\s/g, "").toUpperCase();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const person = findOrCreateBorrower(name, iban);
  res.status(201).json(person);
});

app.get("/api/v1/rules", (_req, res) => {
  res.json(listRules());
});

app.post("/api/v1/rules", (req, res) => {
  const body = req.body ?? {};
  if (!body.categoryId || !body.value || !body.field) {
    res.status(400).json({ error: "categoryId, field, value required" });
    return;
  }
  const rule = {
    id: crypto.randomUUID(),
    priority: Number(body.priority ?? 25),
    categoryId: String(body.categoryId),
    field: body.field,
    match: body.match === "equals" ? "equals" as const : "contains" as const,
    value: String(body.value),
    note: String(body.note ?? "Added via API"),
    learned: true,
  };
  insertRule(rule);
  res.status(201).json(rule);
});

app.delete("/api/v1/rules/:id", (req, res) => {
  if (!deleteRule(req.params.id)) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/v1/rules/apply", (_req, res) => {
  const rules = listRules();
  const people = listPeople();
  const all = listTransactions();
  const rows = all.filter((tx) => !tx.categoryId && tx.splits.length === 0);
  let applied = 0;
  for (const tx of rows) {
    const suggestion = suggestCategory(tx, rules, people, all);
    if (!suggestion) continue;
    if (suggestion.reason.startsWith("Known person")) continue;
    updateTransaction(tx.id, {
      categoryId: suggestion.categoryId,
      loanPersonId: suggestion.personId,
      loanDirection: suggestion.loanDirection,
      loanOriginId: suggestion.loanOriginId ?? null,
      spreadMonths: suggestion.spreadMonths,
      spreadStart: suggestion.spreadMonths > 1 ? feeSpreadStart(tx.purpose, tx.spreadStart || tx.month) : null,
      excluded:
        suggestion.categoryId === "ignore" ||
        suggestion.categoryId === "to_cash" ||
        suggestion.categoryId === "from_cash" ||
        suggestion.categoryId === "internal",
    });
    const updated = getTransaction(tx.id);
    if (updated) syncWalletForBankTransfer(updated, tx.categoryId);
    const index = all.findIndex((row) => row.id === tx.id);
    if (index >= 0) {
      all[index] = normalizeReimburse({
        ...all[index],
        categoryId: suggestion.categoryId,
        loanPersonId: suggestion.personId,
        loanOriginId: suggestion.loanOriginId ?? null,
      });
    }
    applied += 1;
  }
  repairSpreads();
  res.json({ scanned: rows.length, applied });
});

app.get("/api/v1/transactions", (req, res) => {
  let rows = listTransactions();
  const month = str(req.query.month);
  const category = str(req.query.category);
  if (month) rows = rows.filter((tx) => tx.month === month || (tx.spreadStart && tx.spreadMonths > 1));
  if (req.query.uncategorized === "1") rows = rows.filter((tx) => !tx.categoryId && tx.splits.length === 0);
  if (category) rows = rows.filter((tx) => tx.categoryId === category);
  res.json(rows);
});

app.patch("/api/v1/transactions/:id", (req, res) => {
  const allowed = [
    "categoryId",
    "splits",
    "spreadMonths",
    "spreadStart",
    "excluded",
    "notes",
    "loanPersonId",
    "loanDirection",
    "loanOriginId",
    "month",
    "reimburseAmount",
  ] as const;
  const patch: Partial<Transaction> = {};
  for (const key of allowed) {
    if (key in (req.body ?? {})) (patch as Record<string, unknown>)[key] = req.body[key];
  }
  const current = getTransaction(req.params.id);
  if (!current) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  if ("reimburseAmount" in patch) {
    const value = Number(patch.reimburseAmount);
    if (!Number.isFinite(value) || value < 0) {
      res.status(400).json({ error: "reimburseAmount must be 0 or more" });
      return;
    }
    patch.reimburseAmount = Math.min(round2(value), Math.abs(current.amount));
  }
  if ("categoryId" in patch && patch.categoryId) {
    const transferExclude = new Set(["ignore", "to_cash", "from_cash", "internal"]);
    if (transferExclude.has(patch.categoryId) && !("excluded" in patch)) patch.excluded = true;
  }
  applyLoanSemantics(current, patch);
  const updated = updateTransaction(req.params.id, patch);
  if (!updated) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  if (updated.source === "cash" && ("categoryId" in patch || "splits" in patch)) {
    syncCashMovementCategory(updated.id, updated.splits.length ? null : updated.categoryId);
  }
  if (updated.source === "bank" && "categoryId" in patch) {
    syncWalletForBankTransfer(updated, current.categoryId);
  }
  if (
    updated.categoryId &&
    req.body?.learn !== false &&
    updated.counterparty &&
    updated.splits.length === 0
  ) {
    const learned = learnRuleFrom(updated, listRules());
    if (learned) insertRule(learned);
  }
  res.json(updated);
});

app.get("/api/v1/imports", (_req, res) => {
  res.json(listImports());
});

app.post("/api/v1/imports/preview", (req, res) => {
  try {
    const csvText = String(req.body?.csvText ?? "");
    if (!csvText.trim()) {
      res.status(400).json({ error: "csvText is required" });
      return;
    }
    res.json(previewImport(csvText));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not parse CSV" });
  }
});

app.post("/api/v1/imports", (req, res) => {
  try {
    const csvText = String(req.body?.csvText ?? "");
    const fileName = String(req.body?.fileName ?? "upload.csv");
    const includeSoft = Boolean(req.body?.includeSoft);
    if (!csvText.trim()) {
      res.status(400).json({ error: "csvText is required" });
      return;
    }
    const preview = previewImport(csvText);
    const batch = commitImport(fileName, preview, includeSoft);
    res.status(201).json({ ...batch, previewCounts: counts(preview) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Import failed" });
  }
});

app.get("/api/v1/summary", (req, res) => {
  const month = str(req.query.month) || new Date().toISOString().slice(0, 7);
  const summary = summarizeMonth(month, listTransactions(), listCategories());
  res.json({
    ...summary,
    cashOnHand: cashBalance(),
    bankBalance: currentBankBalance(),
    bankBalanceAsOf: currentBankBalanceAsOf(),
  });
});

app.get("/api/v1/account", (_req, res) => {
  res.json(accountState());
});

app.post("/api/v1/setup", (req, res) => {
  const amount = Number(req.body?.openingBalance);
  const date = String(req.body?.openingBalanceDate ?? "").slice(0, 10);
  if (!Number.isFinite(amount)) {
    res.status(400).json({ error: "openingBalance must be a number" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "openingBalanceDate must be YYYY-MM-DD" });
    return;
  }
  saveSettings({
    openingBalance: Math.round(amount * 100) / 100,
    openingBalanceDate: date,
    onboarded: req.body?.onboarded === false ? false : Boolean(req.body?.onboarded) || getSettings().onboarded,
  });
  if ("openingCash" in (req.body ?? {})) {
    const openingCash = Number(req.body.openingCash || 0);
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      res.status(400).json({ error: "openingCash must be 0 or more" });
      return;
    }
    replaceOpeningCash(Math.round(openingCash * 100) / 100, date);
  }
  res.json(accountState());
});

app.post("/api/v1/reset", (_req, res) => {
  res.json(resetLedger());
});

app.patch("/api/v1/settings", (req, res) => {
  const patch: Record<string, unknown> = {};
  if (req.body?.openingBalance != null || req.body?.bankBalance != null) {
    const n = Number(req.body?.openingBalance ?? req.body.bankBalance);
    if (Number.isNaN(n)) {
      res.status(400).json({ error: "openingBalance must be a number" });
      return;
    }
    patch.openingBalance = Math.round(n * 100) / 100;
    patch.openingBalanceDate = String(req.body?.openingBalanceDate || req.body?.bankBalanceAsOf || "").slice(0, 10) || getSettings().openingBalanceDate;
  }
  if (req.body?.monthBasis === "bookingDate" || req.body?.monthBasis === "valueDate") {
    patch.monthBasis = req.body.monthBasis;
  }
  saveSettings(patch);
  res.json(accountState());
});

app.get("/api/v1/cash", (_req, res) => {
  res.json({
    balance: cashBalance(),
    movements: listCashMovements(),
  });
});

app.post("/api/v1/cash/movements", (req, res) => {
  const typeRaw = String(req.body?.type ?? "");
  const type =
    typeRaw === "in"
      ? "cash_in"
      : typeRaw === "out"
        ? "cash_out"
        : typeRaw === "bank"
          ? "bank_out"
          : typeRaw === "opening"
            ? "opening"
            : "";
  const amount = Number(req.body?.amount);
  const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10));
  const note = String(req.body?.note ?? "");
  const categoryId = req.body?.categoryId ? String(req.body.categoryId) : null;
  if (!type || !(amount > 0)) {
    res.status(400).json({ error: "type must be in|out|bank|opening and amount must be > 0" });
    return;
  }

  const now = new Date().toISOString();
  const month = monthKey(date);
  let transactionId: string | null = null;
  const movementAmount = Math.abs(amount);
  const txCategoryId = categoryId ?? (type === "cash_out" ? "miscellaneous" : "other_income");

  if (type === "cash_out" || type === "cash_in") {
    const txId = crypto.randomUUID();
    transactionId = txId;
    const signed = type === "cash_out" ? -Math.abs(movementAmount) : Math.abs(movementAmount);
    const catName =
      listCategories().find((c) => c.id === categoryId)?.name ||
      (type === "cash_out" ? "Cash spend" : "Cash in");
    insertTransaction({
      id: txId,
      fingerprint: `cash:${txId}`,
      accountIban: "",
      bookingDate: date,
      valueDate: date,
      month,
      bookingText: note || (type === "cash_out" ? "Cash spend" : "Cash in"),
      purpose: note,
      counterparty: catName,
      iban: "",
      bic: "",
      amount: signed,
      currency: "EUR",
      endToEndRef: "",
      mandateRef: "",
      creditorId: "",
      info: "",
      categoryId: txCategoryId,
      splits: [],
      spreadMonths: 1,
      spreadStart: null,
      excluded: false,
      notes: note,
      loanPersonId: req.body?.loanPersonId ?? null,
      loanDirection: req.body?.loanDirection ?? null,
      loanOriginId: req.body?.loanOriginId ?? null,
      reimburseAmount: 0,
      importId: null,
      source: "cash",
      createdAt: now,
    });
  }

  const movement: CashMovement = {
    id: crypto.randomUUID(),
    type,
    amount: movementAmount,
    date,
    month,
    categoryId: type === "bank_out" ? "from_cash" : categoryId,
    note: note || (type === "bank_out" ? "Cash to bank" : ""),
    transactionId,
    createdAt: now,
  };
  insertCashMovement(movement);
  res.status(201).json({ movement, balance: cashBalance() });
});

app.patch("/api/v1/cash/movements/:id", (req, res) => {
  const body = req.body ?? {};
  const patch: { amount?: number; date?: string; categoryId?: string | null; note?: string } = {};
  if ("amount" in body) patch.amount = Number(body.amount);
  if ("date" in body) patch.date = String(body.date);
  if ("categoryId" in body) patch.categoryId = body.categoryId ? String(body.categoryId) : null;
  if ("note" in body) patch.note = String(body.note ?? "");
  const updated = updateCashMovement(req.params.id, patch);
  if (!updated) {
    res.status(404).json({ error: "Cash movement not found or not editable" });
    return;
  }
  res.json({ movement: updated, balance: cashBalance() });
});

app.delete("/api/v1/cash/movements/:id", (req, res) => {
  if (!deleteCashMovement(req.params.id)) {
    res.status(404).json({ error: "Cash movement not found or not editable" });
    return;
  }
  res.json({ ok: true, balance: cashBalance() });
});

app.get("/api/v1/gold", (_req, res) => {
  const lots = listGoldLots();
  res.json({ lots, totals: goldTotals(lots) });
});

app.post("/api/v1/gold", (req, res) => {
  const parsed = parseGoldInput(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const lot: GoldLot = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    purchasedAt: parsed.purchasedAt ?? "",
    grams: parsed.grams ?? 0,
    purity: parsed.purity ?? "999.9",
    form: parsed.form ?? "bar",
    dealer: parsed.dealer ?? "",
    invoiceRef: parsed.invoiceRef ?? "",
    totalPaid: parsed.totalPaid ?? 0,
    pricePerGram: parsed.pricePerGram ?? 0,
    note: parsed.note ?? "",
    pieces: parsed.pieces ?? [],
  };
  insertGoldLot(lot);
  res.status(201).json(lot);
});

app.patch("/api/v1/gold/:id", (req, res) => {
  if (!getGoldLot(req.params.id)) {
    res.status(404).json({ error: "Gold lot not found" });
    return;
  }
  const parsed = parseGoldInput(req.body, true);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const updated = updateGoldLot(req.params.id, parsed);
  res.json(updated);
});

app.delete("/api/v1/gold/:id", (req, res) => {
  if (!deleteGoldLot(req.params.id)) {
    res.status(404).json({ error: "Gold lot not found" });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/v1/lending", (_req, res) => {
  res.json(buildLending(listPeople(), listTransactions()));
});

app.get("/api/v1/report", (req, res) => {
  const year = Number(str(req.query.year)) || new Date().getFullYear();
  res.json(buildYearSheet(year, listTransactions(), listCategories()));
});

app.get("/api/v1/insights", (req, res) => {
  const year = Number(str(req.query.year)) || new Date().getFullYear();
  res.json(buildInsights(year, listTransactions(), listCategories()));
});

app.get("/api/v1/contracts", async (_req, res) => {
  const detected = detectContracts(listTransactions());
  const { contracts, provider } = await enrichContractsWithAI(detected);
  res.json({ provider, contracts });
});

app.post("/api/v1/contracts/analyze", async (_req, res) => {
  const detected = detectContracts(listTransactions());
  const { contracts, provider } = await enrichContractsWithAI(detected);
  res.json({ provider, contracts });
});

app.get("/api/v1/forecast", (_req, res) => {
  res.json(makeForecast());
});

app.post("/api/v1/ask", (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }
  const month = String(req.body?.month ?? currentMonth());
  const transactions = listTransactions();
  const categories = listCategories();
  const contracts = detectContracts(transactions);
  const forecast = makeForecast(transactions, categories, contracts);
  res.json(answerFinanceQuestion(question, { month, transactions, categories, contracts, forecast }));
});

app.get("/api/v1/export", (_req, res) => {
  res.json({
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    categories: listCategories(),
    people: listPeople(),
    rules: listRules(),
    transactions: listTransactions(),
    cashMovements: listCashMovements(),
    goldLots: listGoldLots(),
    imports: listImports(),
  });
});

app.get("/api/v1/backup", (_req, res) => {
  const backup = exportBackup();
  res.setHeader("Content-Disposition", `attachment; filename="haushalt-backup-${backup.exportedAt.slice(0, 10)}.json"`);
  res.json(backup);
});

app.post("/api/v1/backup/restore", (req, res) => {
  try {
    const restored = restoreBackup(req.body);
    res.json({ ok: true, restored, account: accountState() });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Restore failed" });
  }
});

const dist = join(root, "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(join(dist, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Haushalt API http://${HOST}:${PORT}/api/v1`);
});

const GOLD_FORMS = new Set<GoldForm>(["bar", "coin", "jewelry", "other"]);

function parseGoldInput(
  body: Record<string, unknown> | undefined,
  partial = false,
): Partial<Omit<GoldLot, "id" | "createdAt">> | { error: string } {
  const raw = body ?? {};
  const out: Partial<Omit<GoldLot, "id" | "createdAt">> = {};

  if (!partial || "purchasedAt" in raw) {
    const date = String(raw.purchasedAt ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "purchasedAt must be YYYY-MM-DD" };
    out.purchasedAt = date;
  }
  if (!partial || "pieces" in raw || "grams" in raw) {
    let pieces: GoldPiece[] = [];
    if (Array.isArray(raw.pieces) && raw.pieces.length > 0) {
      pieces = normalizeGoldPieces(raw.pieces);
    } else {
      const grams = Number(raw.grams);
      if (!Number.isFinite(grams) || grams <= 0) return { error: "grams must be greater than 0" };
      const form = String(raw.form || "bar") as GoldForm;
      if (!GOLD_FORMS.has(form)) return { error: "form must be bar, coin, jewelry or other" };
      pieces = [
        {
          id: crypto.randomUUID(),
          grams: Math.round(grams * 1000) / 1000,
          purity: String(raw.purity ?? "999.9").trim() || "999.9",
          form,
          note: "",
        },
      ];
    }
    const piecesError = goldPiecesError(pieces);
    if (piecesError) return { error: piecesError };
    const summary = piecesSummary(pieces);
    out.pieces = pieces;
    out.grams = summary.grams;
    out.purity = summary.purity;
    out.form = summary.form;
  }
  if (!partial || "totalPaid" in raw) {
    const totalPaid = Number(raw.totalPaid ?? 0);
    if (!Number.isFinite(totalPaid) || totalPaid < 0) return { error: "totalPaid must be 0 or more" };
    out.totalPaid = Math.round(totalPaid * 100) / 100;
  }
  if ((!partial || "form" in raw) && out.form == null) {
    const form = String(raw.form || "bar") as GoldForm;
    if (!GOLD_FORMS.has(form)) return { error: "form must be bar, coin, jewelry or other" };
    out.form = form;
  }
  if ((!partial || "purity" in raw) && out.purity == null) {
    out.purity = String(raw.purity ?? "999.9").trim() || "999.9";
  }
  if (!partial || "dealer" in raw) out.dealer = String(raw.dealer ?? "").trim();
  if (!partial || "invoiceRef" in raw) out.invoiceRef = String(raw.invoiceRef ?? "").trim();
  if (!partial || "note" in raw) out.note = String(raw.note ?? "").trim();

  const grams = out.grams;
  const totalPaid = out.totalPaid;
  if (grams != null && totalPaid != null) {
    out.pricePerGram = grams > 0 ? Math.round((totalPaid / grams) * 100) / 100 : 0;
  }

  return out;
}

function previewImport(csvText: string): ImportPreviewRow[] {
  const settings = getSettings();
  const rows = parseSparkasseCsv(csvText);
  return rows.map((row) => {
    if (settings.skipZeroAmount && row.amount === 0) {
      return { row, status: "skip" as const, reason: "Zero-amount statement row" };
    }
    const match = findImportMatch(row);
    if (!match) return { row, status: "new" as const };
    if (match.kind === "soft") {
      return {
        row,
        status: "soft" as const,
        existingId: match.tx.id,
        reason: `Same date, amount and payee as “${(match.tx.purpose || match.tx.counterparty).slice(0, 60)}”`,
      };
    }
    const reason =
      match.kind === "endToEnd"
        ? "Same End-to-End reference — already imported (pending booking that later settled)"
        : match.kind === "settled"
          ? "Same purpose, amount and value date — already imported"
          : "Exact match of date, amount, payee, purpose and references";
    return { row, status: "duplicate" as const, existingId: match.tx.id, reason };
  });
}

function commitImport(fileName: string, preview: ImportPreviewRow[], includeSoft: boolean) {
  const settings = getSettings();
  const rules = listRules();
  const people = listPeople();
  const importId = crypto.randomUUID();
  const now = new Date().toISOString();
  const toAdd = preview.filter((item) => item.status === "new" || (item.status === "soft" && includeSoft));
  const ledger = listTransactions();

  db.exec("BEGIN");
  try {
    for (const item of toAdd) {
      const suggestion = suggestCategory(item.row, rules, people, ledger);
      const basis = settings.monthBasis === "bookingDate" ? item.row.bookingDate : item.row.valueDate;
      const rawMonth = monthKey(basis || item.row.bookingDate);
      const month = accountFeeMonth(item.row.valueDate || basis, item.row.bookingText) ?? rawMonth;
      const excluded =
        suggestion?.categoryId === "ignore" ||
        suggestion?.categoryId === "to_cash" ||
        suggestion?.categoryId === "from_cash";
      const tx: Transaction = normalizeReimburse({
        id: crypto.randomUUID(),
        fingerprint: item.row.fingerprint,
        accountIban: item.row.accountIban,
        bookingDate: item.row.bookingDate,
        valueDate: item.row.valueDate,
        month,
        bookingText: item.row.bookingText,
        purpose: item.row.purpose,
        counterparty: item.row.counterparty,
        iban: item.row.iban,
        bic: item.row.bic,
        amount: item.row.amount,
        currency: item.row.currency,
        endToEndRef: item.row.endToEndRef,
        mandateRef: item.row.mandateRef,
        creditorId: item.row.creditorId,
        info: item.row.info,
        categoryId: suggestion?.categoryId ?? null,
        splits: [],
        spreadMonths: suggestion?.spreadMonths ?? 1,
        spreadStart:
          suggestion && suggestion.spreadMonths > 1 ? feeSpreadStart(item.row.purpose, month) : null,
        excluded,
        notes: suggestion?.reason ?? "",
        loanPersonId: suggestion?.personId ?? null,
        loanDirection: suggestion?.loanDirection ?? null,
        loanOriginId: suggestion?.loanOriginId ?? null,
        reimburseAmount: 0,
        importId,
        source: "bank",
        createdAt: now,
      });
      insertTransaction(tx);
      ledger.push(tx);
      syncWalletForBankTransfer(tx, null);
    }
    for (const item of preview) {
      if (item.status !== "duplicate" || !item.existingId) continue;
      const existing = getTransaction(item.existingId);
      if (!existing) continue;
      if (existing.bookingDate === item.row.bookingDate && existing.fingerprint === item.row.fingerprint) continue;
      adoptImportedDetails(item.existingId, item.row);
    }
    const batch = {
      id: importId,
      fileName,
      importedAt: now,
      added: toAdd.length,
      duplicates: preview.filter((p) => p.status === "duplicate").length,
      skipped: preview.filter((p) => p.status === "skip" || (p.status === "soft" && !includeSoft)).length,
    };
    insertImport(batch);
    db.exec("COMMIT");
    return batch;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function counts(preview: ImportPreviewRow[]) {
  return {
    new: preview.filter((p) => p.status === "new").length,
    duplicate: preview.filter((p) => p.status === "duplicate").length,
    soft: preview.filter((p) => p.status === "soft").length,
    skip: preview.filter((p) => p.status === "skip").length,
  };
}

function makeForecast(
  transactions = listTransactions(),
  categories = listCategories(),
  contracts = detectContracts(transactions),
) {
  return buildForecast({
    transactions,
    contracts,
    categories,
    bankBalance: currentBankBalance(),
    cashOnHand: cashBalance(),
  });
}

function matchesName(tx: Transaction, person: { aliases: string[] }): boolean {
  const name = tx.counterparty.toLowerCase();
  return person.aliases.some((alias) => name.includes(alias.toLowerCase()));
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function applyLoanSemantics(current: Transaction, patch: Partial<Transaction>): void {
  const next = { ...current, ...patch };
  const nowLoan = loanShare(next);
  const wasLoan = loanShare(current);

  if (current.amount < 0) {
    if (!("reimburseAmount" in patch)) {
      if (nowLoan > 0 && wasLoan === 0) patch.reimburseAmount = nowLoan;
      else if (nowLoan === 0 && wasLoan > 0 && !hasPaybacks(current.id)) patch.reimburseAmount = 0;
    } else if (nowLoan > 0 && (patch.reimburseAmount ?? 0) <= 0) {
      patch.reimburseAmount = nowLoan;
    }
    if (nowLoan > 0 && !next.splits.length && !next.loanPersonId) {
      patch.loanPersonId = findOrCreateBorrower(current.counterparty, current.iban).id;
    }
    const reimburse = "reimburseAmount" in patch ? patch.reimburseAmount ?? 0 : current.reimburseAmount;
    if (reimburse <= 0 && current.reimburseAmount > 0) detachPaybacks(current.id);
    else if (originKind(next) !== originKind(current)) retagPaybacks(current.id, paybackCategory(next));
    return;
  }

  if (patch.loanOriginId) {
    const origin = getTransaction(patch.loanOriginId);
    if (!origin || origin.amount >= 0) {
      patch.loanOriginId = null;
      return;
    }
    const lent = originKind(origin) === "lent";
    if (!("loanPersonId" in patch)) patch.loanPersonId = lent ? origin.loanPersonId : null;
    if (next.splits.length === 0 && (!("categoryId" in patch) || PAYBACK_CATEGORIES.has(patch.categoryId ?? ""))) {
      patch.categoryId = paybackCategory(origin);
    }
    if (!lent) {
      const reimburse = reimburseAfterLink(origin, current, listTransactions());
      if (reimburse > origin.reimburseAmount + 0.004) updateTransaction(origin.id, { reimburseAmount: reimburse });
    }
  }
}

function retagPaybacks(originId: string, categoryId: string): void {
  for (const tx of listTransactions()) {
    if (tx.loanOriginId !== originId || !PAYBACK_CATEGORIES.has(tx.categoryId ?? "")) continue;
    updateTransaction(tx.id, { categoryId });
  }
}

function hasPaybacks(originId: string): boolean {
  return listTransactions().some((tx) => tx.loanOriginId === originId);
}

function detachPaybacks(originId: string): void {
  for (const tx of listTransactions()) {
    if (tx.loanOriginId !== originId) continue;
    updateTransaction(tx.id, {
      loanOriginId: null,
      categoryId: PAYBACK_CATEGORIES.has(tx.categoryId ?? "") ? null : tx.categoryId,
    });
  }
}

function uniqueCategoryId(name: string, existing: { id: string }[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "category";
  const used = new Set(existing.map((c) => c.id));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

function loadEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}
