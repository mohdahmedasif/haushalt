import type { Person, Transaction } from "../types";

export interface LendingLine {
  id: string;
  date: string;
  amount: number;
  direction: "lent" | "repaid";
  purpose: string;
}

export interface LendingRow {
  person: Person;
  lent: number;
  repaid: number;
  outstanding: number;
  lines: LendingLine[];
}

export interface LoanOriginStatus {
  origin: Transaction;
  lent: number;
  repaid: number;
  outstanding: number;
  settled: boolean;
  installments: Transaction[];
}

/** Money Lent part of a booking — loans to a person are always paid back in full by default. */
export function loanShare(tx: Pick<Transaction, "amount" | "categoryId" | "splits">): number {
  if (tx.amount >= 0) return 0;
  if (tx.splits.length) {
    return round2(
      tx.splits.filter((line) => line.categoryId === "loan_out").reduce((sum, line) => sum + Math.abs(line.amount), 0),
    );
  }
  return tx.categoryId === "loan_out" ? Math.abs(tx.amount) : 0;
}

/** "lent" for loans to a person (repayment wording), "back" for refunds and reimbursements. */
export type OriginKind = "lent" | "back";

export function originKind(tx: Transaction): OriginKind {
  return loanShare(tx) > 0 ? "lent" : "back";
}

/** Keeps reimburseAmount / loanDirection consistent with amount, category and links. */
export function normalizeReimburse<T extends Transaction>(tx: T): T {
  if (tx.amount >= 0) {
    return {
      ...tx,
      reimburseAmount: 0,
      loanDirection: tx.loanOriginId || tx.categoryId === "loan_in" ? "repaid" : null,
    };
  }
  let amount = Math.max(0, Number(tx.reimburseAmount) || 0);
  if (amount === 0) amount = loanShare(tx);
  amount = round2(Math.min(amount, Math.abs(tx.amount)));
  return { ...tx, reimburseAmount: amount, loanDirection: amount > 0 ? "lent" : null, loanOriginId: null };
}

const LENT_PURPOSE = /\b(loan|lending|lend)\b/i;
const REPAID_PURPOSE = /\b(payback|pay back|repay|loan amount|remaining amount|second half)\b/i;
const NOT_A_LOAN = /\b(badminton|splitwise|chatgpt|chat gpt|uno|danke|sim bill)\b/i;

export function looksLikeLoanOut(tx: Pick<Transaction, "amount" | "purpose" | "bookingText" | "counterparty">): boolean {
  if (tx.amount >= 0) return false;
  const hay = `${tx.purpose || ""} ${tx.bookingText || ""} ${tx.counterparty || ""}`;
  if (NOT_A_LOAN.test(hay) || /\b(wohnungsgesellschaft|wohnbau|miete)\b/i.test(hay)) return false;
  return LENT_PURPOSE.test(hay);
}

export function looksLikeLoanIn(tx: Pick<Transaction, "amount" | "purpose" | "bookingText">): boolean {
  if (tx.amount <= 0) return false;
  if (NOT_A_LOAN.test(tx.purpose || "")) return false;
  return REPAID_PURPOSE.test(`${tx.purpose || ""} ${tx.bookingText || ""}`);
}

export function repairLoanPatch(
  tx: Transaction,
  _personHasLent: boolean,
): Partial<Transaction> | null {
  if (tx.loanOriginId || tx.splits.length) return null;
  if (NOT_A_LOAN.test(tx.purpose) && (tx.categoryId === "loan_out" || tx.categoryId === "loan_in")) {
    return {
      categoryId: tx.amount > 0 ? "reimbursement" : "miscellaneous",
      loanDirection: null,
      loanOriginId: null,
      reimburseAmount: 0,
    };
  }
  if (!tx.categoryId && looksLikeLoanOut(tx)) {
    return { categoryId: "loan_out", loanDirection: "lent", loanOriginId: null, reimburseAmount: Math.abs(tx.amount) };
  }
  return null;
}

/** How much of an outgoing booking is to be reimbursed. */
export function lentPortion(tx: Transaction): number {
  if (tx.excluded || tx.amount >= 0) return 0;
  return round2(Math.min(Math.max(0, tx.reimburseAmount || 0), Math.abs(tx.amount)));
}

function personLentPortion(tx: Transaction): number {
  return originKind(tx) === "lent" ? lentPortion(tx) : 0;
}

/** An incoming booking linked as a payback counts in full. */
export function repaidPortion(tx: Transaction): number {
  if (tx.excluded || tx.amount <= 0 || !tx.loanOriginId) return 0;
  return Math.abs(tx.amount);
}

/** Received paybacks per outgoing booking id. */
export function paybacksByOrigin(ledger: Transaction[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const tx of ledger) {
    const portion = repaidPortion(tx);
    if (portion > 0 && tx.loanOriginId) map.set(tx.loanOriginId, round2((map.get(tx.loanOriginId) ?? 0) + portion));
  }
  return map;
}

export function isLoanOrigin(tx: Transaction): boolean {
  return lentPortion(tx) > 0;
}

export function loanOriginStatus(origin: Transaction, ledger: Transaction[]): LoanOriginStatus {
  const installments = ledger
    .filter((tx) => tx.loanOriginId === origin.id)
    .sort((a, b) => (a.valueDate || a.bookingDate).localeCompare(b.valueDate || b.bookingDate) || a.id.localeCompare(b.id));
  const lent = lentPortion(origin);
  const repaid = round2(installments.reduce((sum, tx) => sum + repaidPortion(tx), 0));
  const outstanding = round2(Math.max(0, lent - repaid));
  return {
    origin,
    lent,
    repaid,
    outstanding,
    settled: lent > 0 && outstanding <= 0.005,
    installments,
  };
}

export function allLoanOrigins(ledger: Transaction[]): Transaction[] {
  return ledger
    .filter(isLoanOrigin)
    .sort((a, b) => (a.valueDate || a.bookingDate).localeCompare(b.valueDate || b.bookingDate) || a.id.localeCompare(b.id));
}

export function matchingOpenOrigins(
  row: Pick<Transaction, "counterparty" | "iban" | "id">,
  people: Person[] = [],
  ledger: Transaction[],
): LoanOriginStatus[] {
  return allLoanOrigins(ledger)
    .filter((origin) => origin.id !== row.id)
    .map((origin) => loanOriginStatus(origin, ledger))
    .filter((status) => status.outstanding > 0.005 && originMatchesIncoming(status.origin, row, people));
}

/** All still-open lent bookings — for manually attaching a return. Matching names first. */
export function openOriginsForAttach(
  row: Pick<Transaction, "counterparty" | "iban" | "id"> & Partial<Pick<Transaction, "valueDate" | "bookingDate">>,
  people: Person[] = [],
  ledger: Transaction[],
  kind?: OriginKind,
  includeClosed = false,
): LoanOriginStatus[] {
  const matchingIds = new Set(matchingOpenOrigins(row, people, ledger).map((hit) => hit.origin.id));
  const rowDate = row.valueDate || row.bookingDate || "";
  return allLoanOrigins(ledger)
    .filter((origin) => origin.id !== row.id)
    .filter((origin) => !kind || originKind(origin) === kind)
    .filter((origin) => {
      const date = origin.valueDate || origin.bookingDate || "";
      return !rowDate || !date || date <= rowDate;
    })
    .map((origin) => loanOriginStatus(origin, ledger))
    .filter((status) => status.outstanding > 0.005 || (includeClosed && acceptsLateReimbursement(status)))
    .sort((a, b) => {
      const am = matchingIds.has(a.origin.id) ? 0 : 1;
      const bm = matchingIds.has(b.origin.id) ? 0 : 1;
      if (am !== bm) return am - bm;
      return (b.origin.valueDate || b.origin.bookingDate).localeCompare(a.origin.valueDate || a.origin.bookingDate);
    });
}

/** A closed reimbursement can still take a late refund, up to the booking amount. */
export function acceptsLateReimbursement(status: LoanOriginStatus): boolean {
  return originKind(status.origin) === "back" && status.repaid < Math.abs(status.origin.amount) - 0.005;
}

/** Reimburse amount after linking `incoming` — a closed booking grows to cover a late refund. */
export function reimburseAfterLink(origin: Transaction, incoming: Transaction, ledger: Transaction[]): number {
  const received = ledger
    .filter((tx) => tx.loanOriginId === origin.id && tx.id !== incoming.id)
    .reduce((sum, tx) => sum + repaidPortion(tx), 0);
  const next = round2(Math.min(Math.abs(origin.amount), received + Math.abs(incoming.amount)));
  return Math.max(origin.reimburseAmount, next);
}

/** Incoming bookings you can attach as returns for this lent origin. */
export function candidateReturnBookings(origin: Transaction, ledger: Transaction[]): Transaction[] {
  const originDate = origin.valueDate || origin.bookingDate || "";
  return ledger
    .filter((tx) => {
      if (tx.id === origin.id || tx.excluded || tx.amount <= 0) return false;
      if (tx.loanOriginId && tx.loanOriginId !== origin.id) return false;
      if (tx.loanOriginId === origin.id) return false;
      const date = tx.valueDate || tx.bookingDate || "";
      if (originDate && date && date < originDate) return false;
      return true;
    })
    .sort((a, b) => {
      const aMatch = originMatchesIncoming(origin, a, []) ? 0 : 1;
      const bMatch = originMatchesIncoming(origin, b, []) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return (b.valueDate || b.bookingDate).localeCompare(a.valueDate || a.bookingDate);
    });
}

/** Category a linked incoming booking gets: Paid back for loans, Reimbursed for everything else. */
export function paybackCategory(origin: Transaction): string {
  return originKind(origin) === "lent" ? "loan_in" : "reimbursement";
}

export const PAYBACK_CATEGORIES = new Set(["loan_in", "reimbursement"]);

export function attachReturnPatch(origin: Transaction): Partial<Transaction> {
  return {
    loanOriginId: origin.id,
    categoryId: paybackCategory(origin),
    loanDirection: "repaid",
    loanPersonId: originKind(origin) === "lent" ? origin.loanPersonId : null,
    splits: [],
  };
}

export function detachReturnPatch(tx: Transaction): Partial<Transaction> {
  return {
    loanOriginId: null,
    loanDirection: null,
    categoryId: tx.splits.length || !PAYBACK_CATEGORIES.has(tx.categoryId ?? "") ? tx.categoryId : null,
  };
}

/** Incoming money that looks like it pays back a pending booking of this kind (or any kind). */
export function isWaitingToAttach(tx: Transaction, ledger: Transaction[], people: Person[], kind?: OriginKind): boolean {
  if (tx.amount <= 0 || tx.excluded || tx.loanOriginId || tx.splits.length) return false;
  if (tx.categoryId) {
    if (tx.categoryId === "loan_in") {
      if (kind === "back") return false;
      kind = "lent";
    } else if (tx.categoryId === "reimbursement") {
      if (kind === "lent") return false;
      kind = "back";
    } else {
      return false;
    }
  }
  return openOriginsForAttach(tx, people, ledger, kind).length > 0;
}

export function isOpenLoan(tx: Transaction, ledger: Transaction[], kind?: OriginKind): boolean {
  if (!isLoanOrigin(tx)) return false;
  if (kind && originKind(tx) !== kind) return false;
  return loanOriginStatus(tx, ledger).outstanding > 0.005;
}

export function categoryPatch(categoryId: string | null): Partial<Transaction> {
  if (categoryId === "loan_out") {
    return { categoryId, splits: [], loanOriginId: null };
  }
  if (categoryId === "loan_in" || categoryId === "reimbursement") {
    return { categoryId, splits: [] };
  }
  return { categoryId, splits: [], loanOriginId: null, loanPersonId: null };
}

export function reimbursePatch(amount: number): Partial<Transaction> {
  return { reimburseAmount: Math.max(0, round2(amount)) };
}

export function splitLoanPatch(
  tx: Transaction,
  splits: Transaction["splits"],
  loanPersonId: string | null,
): Partial<Transaction> {
  const personLoan = splits.some((line) => line.categoryId === "loan_out");
  return {
    splits,
    categoryId: null,
    loanOriginId: tx.amount < 0 ? null : tx.loanOriginId,
    loanPersonId: personLoan ? loanPersonId : null,
  };
}

export function belongsToPerson(
  tx: Pick<Transaction, "loanPersonId" | "counterparty" | "iban">,
  person: Person,
): boolean {
  if (tx.loanPersonId === person.id) return true;
  const name = (tx.counterparty || "").toLowerCase();
  const iban = (tx.iban || "").replace(/\s/g, "").toUpperCase();
  if (iban && (person.ibans || []).some((own) => own.replace(/\s/g, "").toUpperCase() === iban)) return true;
  return (person.aliases || []).some((alias) => name.includes(alias.toLowerCase()));
}

export function originMatchesIncoming(
  origin: Pick<Transaction, "loanPersonId" | "counterparty" | "iban">,
  incoming: Pick<Transaction, "counterparty" | "iban">,
  people: Person[] = [],
): boolean {
  if (origin.loanPersonId) {
    const person = people.find((p) => p.id === origin.loanPersonId);
    return person ? belongsToPerson({ ...incoming, loanPersonId: null }, person) : false;
  }
  const originIban = (origin.iban || "").replace(/\s/g, "").toUpperCase();
  const incomingIban = (incoming.iban || "").replace(/\s/g, "").toUpperCase();
  if (originIban && incomingIban && originIban === incomingIban) return true;
  return namesOverlap(origin.counterparty || "", incoming.counterparty || "");
}

export function buildLending(people: Person[], transactions: Transaction[]): LendingRow[] {
  return people
    .map((person) => {
      const origins = allLoanOrigins(transactions).filter(
        (tx) => personLentPortion(tx) > 0 && (tx.loanPersonId === person.id || belongsToPerson(tx, person)),
      );
      const originIds = new Set(origins.map((tx) => tx.id));
      const installments = transactions.filter((tx) => tx.loanOriginId && originIds.has(tx.loanOriginId));
      const lines: LendingLine[] = [
        ...origins.map((tx) => line(tx, "lent", personLentPortion(tx))),
        ...installments.map((tx) => line(tx, "repaid", repaidPortion(tx))),
      ].sort((a, b) => a.date.localeCompare(b.date));
      const lent = round2(origins.reduce((sum, tx) => sum + personLentPortion(tx), 0));
      const repaid = round2(installments.reduce((sum, tx) => sum + repaidPortion(tx), 0));
      return {
        person,
        lent,
        repaid,
        outstanding: round2(lent - repaid),
        lines,
      };
    })
    .filter((row) => row.lent > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
}

function namesOverlap(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const tokens = (value: string) => value.split(/\s+/).filter((part) => part.length > 3);
  const shorter = tokens(left).length <= tokens(right).length ? tokens(left) : tokens(right);
  const longer = new Set(tokens(left).length <= tokens(right).length ? tokens(right) : tokens(left));
  return shorter.length > 0 && shorter.every((part) => longer.has(part));
}

function line(tx: Transaction, direction: "lent" | "repaid", amount: number): LendingLine {
  return {
    id: tx.id,
    date: tx.valueDate || tx.bookingDate,
    amount,
    direction,
    purpose: tx.purpose || tx.bookingText,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
