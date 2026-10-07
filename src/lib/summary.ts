import { spreadMonthsFor } from "./dates";
import { lentPortion, paybacksByOrigin } from "./lending";
import { cents } from "./money";
import type { Category, MonthSummary, Transaction } from "../types";

function allocatedAmount(tx: Transaction, month: string): number {
  if (tx.excluded) return 0;
  if (tx.spreadMonths > 1 && tx.spreadStart) {
    const months = spreadMonthsFor(tx.spreadStart, tx.spreadMonths);
    if (!months.includes(month)) return 0;
    return Math.round((cents(tx.amount) / tx.spreadMonths)) / 100;
  }
  return tx.month === month ? tx.amount : 0;
}

/** Part of an outgoing booking you actually pay yourself — pending reimbursements already left out. */
export function keptShare(tx: Transaction, paybacks: Map<string, number>): number {
  if (tx.amount >= 0) return 1;
  const total = Math.abs(tx.amount);
  const reimbursed = Math.min(total, Math.max(lentPortion(tx), paybacks.get(tx.id) ?? 0));
  return total === 0 ? 1 : (total - reimbursed) / total;
}

function lineShare(tx: Transaction, line: Transaction["splits"][number], monthAmount: number): number {
  const total = tx.splits.reduce((sum, row) => sum + Math.abs(row.amount), 0);
  if (total === 0) return 0;
  const sign = monthAmount >= 0 ? 1 : -1;
  const fraction = tx.amount === 0 ? 1 : Math.abs(monthAmount) / Math.abs(tx.amount);
  return sign * round2(Math.abs(line.amount) * fraction);
}

export function summarizeMonth(
  month: string,
  transactions: Transaction[],
  categories: Category[],
): MonthSummary {
  const byCategory: Record<string, number> = {};
  for (const category of categories) byCategory[category.id] = 0;

  let income = 0;
  let expense = 0;
  let uncategorized = 0;
  const paybacks = paybacksByOrigin(transactions);
  const originIds = new Set(transactions.filter((tx) => tx.amount < 0).map((tx) => tx.id));

  for (const tx of transactions) {
    if (tx.loanOriginId && tx.amount > 0 && originIds.has(tx.loanOriginId)) continue;
    const amount = round2(allocatedAmount(tx, month) * keptShare(tx, paybacks));
    if (amount === 0 && !(tx.spreadMonths > 1 && tx.spreadStart)) {
      if (tx.month === month && !tx.excluded && !tx.categoryId && tx.splits.length === 0) {
        uncategorized += 1;
      }
      continue;
    }
    if (amount === 0) continue;

    if (tx.month === month && !tx.excluded && !tx.categoryId && tx.splits.length === 0) {
      uncategorized += 1;
    }

    const category = categories.find((c) => c.id === tx.categoryId);
    if (tx.splits.length) {
      for (const line of tx.splits) {
        const share = lineShare(tx, line, amount);
        byCategory[line.categoryId] = (byCategory[line.categoryId] ?? 0) + share;
        const splitCat = categories.find((c) => c.id === line.categoryId);
        if (splitCat && !splitCat.excludeFromBudget) {
          if (share > 0) income += share;
          if (share < 0) expense += Math.abs(share);
        }
      }
      continue;
    }

    if (tx.categoryId) {
      byCategory[tx.categoryId] = (byCategory[tx.categoryId] ?? 0) + amount;
    }

    if (category?.excludeFromBudget) continue;
    if (amount > 0) income += amount;
    if (amount < 0) expense += Math.abs(amount);
  }

  for (const id of Object.keys(byCategory)) {
    byCategory[id] = round2(byCategory[id]);
  }

  return {
    month,
    income: round2(income),
    expense: round2(expense),
    leftover: round2(income - expense),
    uncategorized,
    cashOnHand: 0,
    bankBalance: null,
    bankBalanceAsOf: null,
    byCategory,
  };
}

export function visibleInMonth(tx: Transaction, month: string): boolean {
  if (tx.spreadMonths > 1 && tx.spreadStart) {
    return spreadMonthsFor(tx.spreadStart, tx.spreadMonths).includes(month);
  }
  return tx.month === month;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
