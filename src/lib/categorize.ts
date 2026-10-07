import type { CategoryRule, ParsedRow, Person, Transaction } from "../types";
import { looksLikeLoanIn, looksLikeLoanOut, matchingOpenOrigins, paybackCategory } from "./lending";
import { addMonths, monthKey } from "./dates";

export interface Suggestion {
  categoryId: string;
  personId: string | null;
  loanDirection: "lent" | "repaid" | null;
  loanOriginId?: string | null;
  spreadMonths: number;
  confidence: "high" | "medium";
  reason: string;
}

export const SPREAD_HINTS: { categoryId: string; months: number }[] = [
  { categoryId: "insurance", months: 12 },
  { categoryId: "radio", months: 3 },
  { categoryId: "education", months: 12 },
];

export function spreadMonthsForCategory(
  categoryId: string,
  amount: number,
  counterparty = "",
  purpose = "",
): number {
  const hay = `${counterparty} ${purpose}`.toLowerCase();
  if (categoryId === "bank_fee") {
    if (/spkcard|debitkarte|jahres/.test(hay) || Math.abs(amount) >= 20) return 12;
    return 1;
  }
  if (categoryId === "education") {
    if (Math.abs(amount) >= 100) return 12;
    return 1;
  }
  return SPREAD_HINTS.find((s) => s.categoryId === categoryId)?.months ?? 1;
}

/** Bank often posts last month’s ENTGELTABSCHLUSS on the 1st. */
export function accountFeeMonth(valueDate: string, bookingText: string): string | null {
  if (!bookingText.toUpperCase().includes("ENTGELTABSCHLUSS") || !valueDate) return null;
  const month = monthKey(valueDate);
  if (Number(valueDate.slice(8, 10)) === 1) return addMonths(month, -1);
  return month;
}

/** Annual card fee “für 2026” belongs to January of that year. */
export function feeSpreadStart(purpose: string, fallbackMonth: string): string {
  const year = purpose.match(/f[uü]r (\d{4})/i)?.[1];
  return year ? `${year}-01` : fallbackMonth;
}

export function suggestCategory(
  row: Pick<ParsedRow, "amount" | "bookingText" | "purpose" | "counterparty" | "iban"> & { id?: string },
  rules: CategoryRule[],
  people: Person[],
  ledger: Transaction[] = [],
): Suggestion | null {
  const person = matchPerson(row, people);

  if (
    row.bookingText.toUpperCase().includes("BARGELDAUSZAHLUNG") ||
    row.bookingText.toUpperCase().includes("AUSZAHLUNG MIT KUNDENENTGELT")
  ) {
    return {
      categoryId: "to_cash",
      personId: null,
      loanDirection: null,
      spreadMonths: 1,
      confidence: "high",
      reason: "ATM withdrawal — fills the cash wallet",
    };
  }

  if (
    row.amount > 0 &&
    (row.bookingText.toUpperCase().includes("BARGELDEINZAHLUNG") ||
      row.bookingText.toUpperCase().includes("EINZAHLUNG BAR") ||
      row.purpose.toUpperCase().includes("BARGELDEINZAHLUNG"))
  ) {
    return {
      categoryId: "from_cash",
      personId: null,
      loanDirection: null,
      spreadMonths: 1,
      confidence: "high",
      reason: "Cash deposit — leaves the cash wallet",
    };
  }

  if (person?.role === "self") {
    return {
      categoryId: "internal",
      personId: person.id,
      loanDirection: null,
      spreadMonths: 1,
      confidence: "high",
      reason: `Own account (${person.name})`,
    };
  }

  if (person && looksLikeLoanOut(row)) {
    return {
      categoryId: "loan_out",
      personId: person.id,
      loanDirection: "lent",
      spreadMonths: 1,
      confidence: "high",
      reason: `Lent wording to ${person.name}`,
    };
  }

  if (row.amount > 0 && ledger.length) {
    const openHits = matchingOpenOrigins(
      { id: row.id ?? "", counterparty: row.counterparty, iban: row.iban },
      people,
      ledger,
    );
    if (openHits.length === 1 && looksLikeLoanIn(row)) {
      const hit = openHits[0];
      return {
        categoryId: paybackCategory(hit.origin),
        personId: hit.origin.loanPersonId ?? person?.id ?? null,
        loanDirection: "repaid",
        loanOriginId: hit.origin.id,
        spreadMonths: 1,
        confidence: "high",
        reason: "Repayment of money lent — linked automatically",
      };
    }
    if (openHits.length > 0) {
      return null;
    }
  }

  if (person?.role === "spouse" && row.amount < 0) {
    return {
      categoryId: "wifey",
      personId: person.id,
      loanDirection: null,
      spreadMonths: 1,
      confidence: "high",
      reason: `Transfer to ${person.name}`,
    };
  }

  if (person?.role === "family" && row.amount > 0) {
    return {
      categoryId: "reimbursement",
      personId: person.id,
      loanDirection: null,
      spreadMonths: 1,
      confidence: "medium",
      reason: `Incoming from family (${person.name})`,
    };
  }

  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    const haystack = fieldValue(row, rule.field);
    if (!haystack) continue;
    const needle = rule.value.toLowerCase().replace(/\s+/g, " ").trim();
    const hit =
      rule.match === "equals"
        ? haystack === needle
        : haystack.includes(needle);
    if (!hit) continue;
    if (rule.categoryId === "loan_in") continue;
    if (row.amount > 0 && (rule.categoryId === "taxation" || rule.categoryId === "shopping")) {
      return {
        categoryId: "reimbursement",
        personId: person?.id ?? null,
        loanDirection: null,
        spreadMonths: 1,
        confidence: "medium",
        reason:
          rule.categoryId === "taxation"
            ? "Credit from Taxfix / tax software"
            : "Refund / credit from a shop",
      };
    }
    if (
      row.amount > 0 &&
      (rule.categoryId === "electricity" ||
        rule.categoryId === "internet" ||
        rule.categoryId === "transport" ||
        rule.categoryId === "mobile" ||
        rule.categoryId === "heating")
    ) {
      return {
        categoryId: rule.categoryId,
        personId: person?.id ?? null,
        loanDirection: null,
        spreadMonths: 1,
        confidence: "medium",
        reason: `Credit on ${rule.categoryId}`,
      };
    }
    if (!ruleFitsAmount(rule.categoryId, row.amount)) continue;

    if (rule.categoryId === "family" && row.amount > 0) {
      return {
        categoryId: "reimbursement",
        personId: person?.id ?? null,
        loanDirection: null,
        spreadMonths: 1,
        confidence: "medium",
        reason: "Incoming from a family counterparty",
      };
    }

    if (rule.categoryId === "shopping" && row.amount > 0) {
      return {
        categoryId: "reimbursement",
        personId: person?.id ?? null,
        loanDirection: null,
        spreadMonths: 1,
        confidence: "medium",
        reason: "Refund / credit from a shop",
      };
    }

    return {
      categoryId: rule.categoryId,
      personId: person?.id ?? null,
      loanDirection: rule.categoryId === "loan_in" ? "repaid" : rule.categoryId === "loan_out" ? "lent" : null,
      spreadMonths: spreadMonthsForCategory(rule.categoryId, row.amount, row.counterparty, row.purpose),
      confidence: rule.priority <= 20 ? "high" : "medium",
      reason: rule.note || `Matched ${rule.field} “${rule.value}”`,
    };
  }

  if (row.bookingText.includes("ENTGELTABSCHLUSS")) {
    return {
      categoryId: "bank_fee",
      personId: null,
      loanDirection: null,
      spreadMonths: 1,
      confidence: "high",
      reason: "Bank account fee",
    };
  }

  if (row.bookingText.includes("ABSCHLUSS") && row.amount === 0) {
    return {
      categoryId: "ignore",
      personId: null,
      loanDirection: null,
      spreadMonths: 1,
      confidence: "high",
      reason: "Zero-amount statement close",
    };
  }

  return person
    ? {
        categoryId: row.amount > 0 ? "other_income" : "miscellaneous",
        personId: person.id,
        loanDirection: null,
        spreadMonths: 1,
        confidence: "medium",
        reason: `Known person ${person.name}, no category rule`,
      }
    : null;
}

export function matchPerson(
  row: Pick<ParsedRow | Transaction, "counterparty" | "iban">,
  people: Person[],
): Person | null {
  const name = row.counterparty.trim().toLowerCase();
  const iban = row.iban.replace(/\s/g, "").toUpperCase();

  for (const person of people) {
    if (iban && person.ibans.some((own) => own.replace(/\s/g, "").toUpperCase() === iban)) {
      return person;
    }
  }
  for (const person of people) {
    if (person.aliases.some((alias) => name && name.includes(alias.toLowerCase()))) {
      return person;
    }
  }
  return null;
}

function fieldValue(
  row: Pick<ParsedRow, "bookingText" | "purpose" | "counterparty" | "iban">,
  field: CategoryRule["field"],
): string {
  switch (field) {
    case "counterparty":
      return row.counterparty.toLowerCase().replace(/\s+/g, " ").trim();
    case "iban":
      return row.iban.toLowerCase();
    case "purpose":
      return row.purpose.toLowerCase().replace(/\s+/g, " ").trim();
    case "bookingText":
      return row.bookingText.toLowerCase().replace(/\s+/g, " ").trim();
  }
}

const INCOME_CATEGORIES = new Set([
  "salary",
  "tax_return",
  "deposit_refund",
  "reimbursement",
  "referral",
  "other_income",
  "loan_in",
]);

const TRANSFER_CATEGORIES = new Set(["internal", "to_cash", "from_cash", "loan_out", "loan_in", "ignore"]);

function ruleFitsAmount(categoryId: string, amount: number): boolean {
  if (TRANSFER_CATEGORIES.has(categoryId)) return true;
  if (amount > 0) return INCOME_CATEGORIES.has(categoryId);
  if (amount < 0) return !INCOME_CATEGORIES.has(categoryId);
  return true;
}

export function learnRuleFrom(
  tx: Pick<Transaction, "counterparty" | "iban" | "categoryId">,
  existing: CategoryRule[],
): CategoryRule | null {
  if (!tx.categoryId || !tx.counterparty.trim()) return null;
  if (
    tx.categoryId === "loan_out" ||
    tx.categoryId === "loan_in" ||
    tx.categoryId === "internal" ||
    tx.categoryId === "to_cash" ||
    tx.categoryId === "from_cash" ||
    tx.categoryId === "ignore"
  ) {
    return null;
  }
  const value = tx.counterparty.trim();
  const already = existing.some(
    (r) =>
      r.categoryId === tx.categoryId &&
      r.field === "counterparty" &&
      r.value.toLowerCase() === value.toLowerCase(),
  );
  if (already) return null;
  return {
    id: crypto.randomUUID(),
    priority: 25,
    categoryId: tx.categoryId,
    field: "counterparty",
    match: "contains",
    value,
    note: "Learned from a manual assignment",
    learned: true,
  };
}
