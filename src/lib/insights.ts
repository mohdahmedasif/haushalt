import { monthKey } from "./dates";
import type { Category, Transaction } from "../types";

/** Trade Republic BIC prefix — used only to flag possible investment transfers for review. */
export const TRADE_REPUBLIC_BIC = "TRBKDEBB";

export type InsightSeverity = "info" | "watch" | "ok";

export interface InsightNote {
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
}

export interface InsightLine {
  id: string;
  date: string;
  month: string;
  payee: string;
  purpose: string;
  amount: number;
  categoryId: string | null;
  label?: string;
}

export interface AssessmentRefund {
  assessmentYear: number | null;
  paidOn: string;
  amount: number;
  finanzamt: string;
  taxId: string | null;
  transactionId: string;
}

export interface InsightsReport {
  year: number;
  disclaimer: string;
  tax: {
    filingFees: number;
    filingRefunds: number;
    filingNet: number;
    returnsReceived: number;
    netAfterFees: number;
    byAssessment: AssessmentRefund[];
    taxfix: InsightLine[];
    refunds: InsightLine[];
    calendar: { when: string; title: string; detail: string }[];
  };
  investment: {
    monthlyBudget: number;
    yearBudget: number;
    monthsElapsed: number;
    paceTarget: number;
    spentYtd: number;
    vsPace: number;
    vsYearBudget: number;
    savingsYtd: number;
    months: { month: string; spent: number; budget: number }[];
    booked: InsightLine[];
    possibleTradeRepublic: InsightLine[];
  };
  notes: InsightNote[];
}

const DISCLAIMER =
  "This screen reads your bank ledger only. It is not tax, investment, or legal advice. German tax rules change; a Steuerberater or Finanzamt can confirm what applies to you.";

export function buildInsights(
  year: number,
  transactions: Transaction[],
  categories: Category[],
  now = new Date(),
): InsightsReport {
  const inYear = transactions.filter((tx) => yearOf(tx) === year && !tx.excluded);
  const investmentCat = categories.find((c) => c.id === "investment");
  const monthlyBudget = investmentCat?.budget ?? 0;
  const yearBudget = round2(monthlyBudget * 12);
  const monthsElapsed = monthsElapsedInYear(year, now);
  const paceTarget = round2(monthlyBudget * monthsElapsed);

  const taxfixAll = inYear.filter(isTaxfix);
  const taxfixOut = taxfixAll.filter((tx) => tx.amount < 0);
  const taxfixIn = taxfixAll.filter((tx) => tx.amount > 0);
  const filingFees = round2(sumAbs(taxfixOut));
  const filingRefunds = round2(sumAmt(taxfixIn));
  const filingNet = round2(filingFees - filingRefunds);

  const refundTx = inYear.filter(isFinanzamtRefund);
  const returnsReceived = round2(sumAmt(refundTx));
  const byAssessment = mergeAssessments(refundTx);

  const bookedInvest = inYear.filter((tx) => categoryHits(tx, "investment") && tx.amount < 0);
  const spentYtd = round2(sumAbs(bookedInvest));
  const savingsYtd = round2(sumAbs(inYear.filter((tx) => categoryHits(tx, "savings") && tx.amount < 0)));

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const spent = round2(
      sumAbs(bookedInvest.filter((tx) => (tx.month || monthKey(tx.valueDate || tx.bookingDate)) === month)),
    );
    return { month, spent, budget: monthlyBudget };
  });

  const possibleTradeRepublic = inYear
    .filter((tx) => tx.amount < 0 && isTradeRepublic(tx) && !categoryHits(tx, "investment"))
    .map((tx) => toLine(tx, "Trade Republic BIC — review, do not auto-tag"));

  const notes = buildNotes({
    year,
    monthsElapsed,
    spentYtd,
    paceTarget,
    yearBudget,
    monthlyBudget,
    savingsYtd,
    filingNet,
    returnsReceived,
    byAssessment,
    possibleTradeRepublic,
    inYear,
    now,
  });

  return {
    year,
    disclaimer: DISCLAIMER,
    tax: {
      filingFees,
      filingRefunds,
      filingNet,
      returnsReceived,
      netAfterFees: round2(returnsReceived - filingNet),
      byAssessment,
      taxfix: taxfixAll.map((tx) => toLine(tx, tx.amount < 0 ? "Taxfix fee" : "Taxfix refund")),
      refunds: refundTx.map((tx) => toLine(tx, assessmentLabel(tx))),
      calendar: taxCalendar(year, byAssessment, taxfixAll.length > 0, now),
    },
    investment: {
      monthlyBudget,
      yearBudget,
      monthsElapsed,
      paceTarget,
      spentYtd,
      vsPace: round2(spentYtd - paceTarget),
      vsYearBudget: round2(spentYtd - yearBudget),
      savingsYtd,
      months,
      booked: bookedInvest.map((tx) => toLine(tx)),
      possibleTradeRepublic,
    },
    notes,
  };
}

export function isTradeRepublic(tx: Pick<Transaction, "iban" | "bic">): boolean {
  const bic = tx.bic.replace(/\s/g, "").toUpperCase();
  return bic.startsWith(TRADE_REPUBLIC_BIC);
}

export function extractAssessmentYear(purpose: string): number | null {
  const m = purpose.match(/EST[- ]?VERANL\.?\s*(\d{2,4})/i);
  if (!m) return null;
  let y = Number(m[1]);
  if (y < 100) y += 2000;
  return y;
}

export function extractSteuernummer(purpose: string): string | null {
  const m = purpose.match(/(\d{3}\/\d{3}\/\d{5})/);
  return m?.[1] ?? null;
}

function isTaxfix(tx: Transaction): boolean {
  return /taxfix/i.test(tx.counterparty) || /taxfix/i.test(tx.purpose);
}

function isFinanzamtRefund(tx: Transaction): boolean {
  if (tx.amount <= 0) return false;
  if (tx.categoryId === "tax_return") return true;
  const blob = `${tx.counterparty} ${tx.purpose} ${tx.bookingText}`;
  return /finanz(amt|kasse)/i.test(blob) || /EST[- ]?VERANL/i.test(blob);
}

function categoryHits(tx: Transaction, categoryId: string): boolean {
  if (tx.splits.some((s) => s.categoryId === categoryId)) return true;
  return tx.categoryId === categoryId;
}

function yearOf(tx: Transaction): number {
  const iso = tx.valueDate || tx.bookingDate || tx.month;
  const y = Number((iso || "").slice(0, 4));
  return Number.isFinite(y) ? y : 0;
}

function monthsElapsedInYear(year: number, now: Date): number {
  if (now.getFullYear() > year) return 12;
  if (now.getFullYear() < year) return 0;
  return now.getMonth() + 1;
}

function mergeAssessments(rows: Transaction[]): AssessmentRefund[] {
  const map = new Map<string, AssessmentRefund>();
  for (const tx of rows) {
    const assessmentYear = extractAssessmentYear(tx.purpose);
    const taxId = extractSteuernummer(tx.purpose);
    const key = `${assessmentYear ?? "unknown"}|${taxId ?? tx.counterparty}`;
    const current = map.get(key);
    if (current) {
      current.amount = round2(current.amount + tx.amount);
      if (tx.valueDate > current.paidOn) current.paidOn = tx.valueDate;
    } else {
      map.set(key, {
        assessmentYear,
        paidOn: tx.valueDate || tx.bookingDate,
        amount: round2(tx.amount),
        finanzamt: tx.counterparty,
        taxId,
        transactionId: tx.id,
      });
    }
  }
  return [...map.values()].sort((a, b) => (a.assessmentYear ?? 0) - (b.assessmentYear ?? 0));
}

function assessmentLabel(tx: Transaction): string {
  const y = extractAssessmentYear(tx.purpose);
  return y ? `Einkommensteuer ${y}` : "Finanzamt refund";
}

function taxCalendar(
  year: number,
  assessments: AssessmentRefund[],
  usedTaxfix: boolean,
  now: Date,
): { when: string; title: string; detail: string }[] {
  const items: { when: string; title: string; detail: string }[] = [];
  const selfDeadline = `${year + 1}-07-31`;
  const advisorDeadline = `${year + 2}-04-30`;
  const assessed = assessments.some((a) => a.assessmentYear === year);

  items.push({
    when: selfDeadline,
    title: `Self-filed return for ${year}`,
    detail: assessed
      ? `Finanzamt already paid out an assessment that looks like year ${year}. Deadline is informational.`
      : `Usual employee deadline if you file yourself (Elster / Taxfix): 31 July ${year + 1}.`,
  });
  items.push({
    when: advisorDeadline,
    title: `Return for ${year} with a tax advisor`,
    detail: `If a Steuerberater files for you, the usual deadline is 30 April ${year + 2}.`,
  });
  if (usedTaxfix) {
    items.push({
      when: monthKey(now.toISOString()),
      title: "Taxfix on this account",
      detail: "Fees and refunds from Taxfix are listed above. Keep the Elster / Taxfix PDF with the year they belong to.",
    });
  }
  for (const row of assessments) {
    if (!row.assessmentYear) continue;
    items.push({
      when: row.paidOn,
      title: `Assessment ${row.assessmentYear} paid out`,
      detail: `${row.finanzamt}${row.taxId ? ` · ${row.taxId}` : ""} arrived ${row.paidOn}.`,
    });
  }
  return items.sort((a, b) => a.when.localeCompare(b.when));
}

function buildNotes(input: {
  year: number;
  monthsElapsed: number;
  spentYtd: number;
  paceTarget: number;
  yearBudget: number;
  monthlyBudget: number;
  savingsYtd: number;
  filingNet: number;
  returnsReceived: number;
  byAssessment: AssessmentRefund[];
  possibleTradeRepublic: InsightLine[];
  inYear: Transaction[];
  now: Date;
}): InsightNote[] {
  const notes: InsightNote[] = [];
  const gap = round2(input.paceTarget - input.spentYtd);
  const paceLabel = input.monthlyBudget > 0 ? `${fmt(input.monthlyBudget)} / month` : "your investment budget";

  if (input.monthsElapsed === 0) {
    notes.push({
      id: "invest-empty-year",
      severity: "info",
      title: "No months elapsed yet",
      body: `Your investment budget is ${fmt(input.monthlyBudget)} / month (${fmt(input.yearBudget)} / year).`,
    });
  } else if (input.monthlyBudget <= 0) {
    notes.push({
      id: "invest-no-budget",
      severity: "info",
      title: "No investment monthly budget set",
      body: `Booked ${fmt(input.spentYtd)} in ${input.year}. Set a budget on the Investment category to track pace.`,
    });
  } else if (Math.abs(gap) < 1) {
    notes.push({
      id: "invest-on-pace",
      severity: "ok",
      title: "Investment is on pace",
      body: `Booked ${fmt(input.spentYtd)} vs ${fmt(input.paceTarget)} after ${input.monthsElapsed} months.`,
    });
  } else if (gap > 0) {
    notes.push({
      id: "invest-behind",
      severity: "watch",
      title: `Investment is ${fmt(gap)} behind the monthly pace`,
      body: `Target is ${paceLabel}. Booked ${fmt(input.spentYtd)} in ${input.year} so far (${fmt(input.paceTarget)} if you had put aside ${fmt(input.monthlyBudget)} each month). This is a budget gap, not a recommendation to buy anything.`,
    });
  } else {
    notes.push({
      id: "invest-ahead",
      severity: "info",
      title: `Investment is ${fmt(-gap)} ahead of the monthly pace`,
      body: `Booked ${fmt(input.spentYtd)} vs ${fmt(input.paceTarget)} after ${input.monthsElapsed} months. Year budget is still ${fmt(input.yearBudget)}.`,
    });
  }

  const possibleSum = round2(input.possibleTradeRepublic.reduce((s, l) => s + Math.abs(l.amount), 0));
  if (input.possibleTradeRepublic.length) {
    notes.push({
      id: "tr-review",
      severity: "watch",
      title: `${input.possibleTradeRepublic.length} Trade Republic transfers need a human check`,
      body: `BIC ${TRADE_REPUBLIC_BIC} matched ${input.possibleTradeRepublic.length} outgoing booking(s) not tagged Investment (total ${fmt(possibleSum)}). Confirm on Transactions — the app will not auto-tag them.`,
    });
  }

  if (input.returnsReceived > 0) {
    const years = input.byAssessment
      .map((a) => a.assessmentYear)
      .filter((y): y is number => y != null)
      .join(", ");
    notes.push({
      id: "tax-refund",
      severity: "ok",
      title: `${fmt(input.returnsReceived)} came back from Finanzamt in ${input.year}`,
      body: `Net of Taxfix fees (${fmt(input.filingNet)}) that is ${fmt(input.returnsReceived - input.filingNet)}. Assessment year(s) on the purpose line: ${years || "not printed"}. Your Steuernummer appears on those credits — keep the Bescheid.`,
    });
  } else if (input.filingNet > 0) {
    notes.push({
      id: "taxfix-only",
      severity: "info",
      title: `Taxfix fees of ${fmt(input.filingNet)} this year, no Finanzamt credit yet`,
      body: "Refunds often arrive months after filing. Match them to EST-VERANL. on the purpose when they land.",
    });
  }

  const offices = [...new Set(input.byAssessment.map((a) => a.finanzamt).filter(Boolean))];
  if (offices.length > 1) {
    notes.push({
      id: "fa-move",
      severity: "info",
      title: "Finanzamt name changed on the credits",
      body: `This account shows: ${offices.join(" · ")}. Different Finanzamt names usually mean a move or a new tax district. Use the Steuernummer printed on the latest credit.`,
    });
  }

  const ramp = input.inYear.filter((tx) => /revolut ramp/i.test(tx.counterparty));
  if (ramp.length) {
    notes.push({
      id: "crypto-ramp",
      severity: "watch",
      title: "Revolut Ramp is crypto, not a bank ETF",
      body: `${ramp.length} card payment(s) totaling ${fmt(sumAbs(ramp))}. German crypto and capital-gains rules differ from depot ETFs. Keep the Ramp receipt; this app cannot tell holding period or gains.`,
    });
  }

  if (input.savingsYtd === 0 && input.spentYtd >= 0) {
    notes.push({
      id: "savings-zero",
      severity: "info",
      title: "Savings category is unused this year",
      body: "Leftover after expenses is not the same as money parked in savings — tag a transfer if you want that bar to move.",
    });
  }

  const education = round2(sumAbs(input.inYear.filter((tx) => categoryHits(tx, "education") && tx.amount < 0)));
  if (education > 50) {
    notes.push({
      id: "education",
      severity: "info",
      title: `Education is ${fmt(education)} this year`,
      body: "Course and exam fees show up here. Whether any of that is Werbungskosten is a Steuerberater question — keep invoices either way.",
    });
  }

  const tk = input.inYear.filter((tx) => /techniker krankenkasse/i.test(tx.counterparty));
  const lastTk = [...tk].sort((a, b) => (b.valueDate || "").localeCompare(a.valueDate || ""))[0];
  if (lastTk) {
    notes.push({
      id: "tk",
      severity: "info",
      title: "Health-insurance contributions on this bank account",
      body: `Last direct debit ${lastTk.valueDate}: ${fmt(Math.abs(lastTk.amount))}. Later months may be taken from salary instead.`,
    });
  }

  const donations = round2(sumAbs(input.inYear.filter((tx) => categoryHits(tx, "donation") && tx.amount < 0)));
  if (donations > 0) {
    notes.push({
      id: "donation",
      severity: "info",
      title: `Donations ${fmt(donations)} this year`,
      body: "Ask a Steuerberater before treating any of this as Sonderausgaben.",
    });
  }

  if (input.inYear.length === 0) {
    notes.push({
      id: "no-data",
      severity: "watch",
      title: `No ${input.year} transactions in the ledger yet`,
      body: "Import a bank CSV first. Insights are computed from booked lines.",
    });
  }

  return notes;
}

function toLine(tx: Transaction, label?: string): InsightLine {
  return {
    id: tx.id,
    date: tx.valueDate || tx.bookingDate,
    month: tx.month || monthKey(tx.valueDate || tx.bookingDate),
    payee: tx.counterparty || tx.bookingText,
    purpose: tx.purpose,
    amount: tx.amount,
    categoryId: tx.categoryId,
    label,
  };
}

function sumAbs(rows: Transaction[]): number {
  return rows.reduce((s, tx) => s + Math.abs(tx.amount), 0);
}

function sumAmt(rows: Transaction[]): number {
  return rows.reduce((s, tx) => s + tx.amount, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  return `${n.toFixed(2)} €`;
}
