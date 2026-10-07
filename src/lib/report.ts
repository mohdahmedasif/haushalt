import { summarizeMonth } from "./summary";
import type { Category, Transaction } from "../types";

export type SheetRowKind = "expense" | "income" | "total-expense" | "total-income" | "grand";

export interface YearSheetRow {
  id: string;
  number: string;
  label: string;
  budget: number;
  months: number[];
  total: number;
  kind: SheetRowKind;
}

export interface YearSheet {
  year: number;
  monthKeys: string[];
  headers: string[];
  rows: YearSheetRow[];
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function buildYearSheet(
  year: number,
  transactions: Transaction[],
  categories: Category[],
): YearSheet {
  const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const headers = MONTH_SHORT.map((name) => `${name}-${String(year).slice(2)}`);
  const summaries = monthKeys.map((month) => summarizeMonth(month, transactions, categories));

  const onSheet = categories.filter((c) => c.showInReport);
  const expenses = onSheet.filter((c) => c.kind === "expense").sort((a, b) => a.sort - b.sort);
  const incomes = onSheet.filter((c) => c.kind === "income").sort((a, b) => a.sort - b.sort);

  const expenseRows = expenses.map((cat, i) =>
    categoryRow(cat, i + 1, "expense", summaries, (raw) => -raw),
  );

  const incomeRows = incomes.map((cat, i) =>
    categoryRow(cat, i + 1, "income", summaries, (raw) => raw),
  );

  const totalExpense = sumRows("total-expense", "Total Expense", expenseRows);
  const totalIncome = sumRows("total-income", "Total Income", incomeRows);
  const grand: YearSheetRow = {
    id: "grand",
    number: "",
    label: "Grand Total",
    budget: round2(totalIncome.budget - totalExpense.budget),
    months: totalIncome.months.map((value, i) => round2(value - totalExpense.months[i])),
    total: round2(totalIncome.total - totalExpense.total),
    kind: "grand",
  };

  return {
    year,
    monthKeys,
    headers,
    rows: [...expenseRows, totalExpense, ...incomeRows, totalIncome, grand],
  };
}

export function yearSheetToCsv(sheet: YearSheet): string {
  const header = ["#", "Expenses/Month", "Budget", ...sheet.headers, "Total"];
  const lines = [header.join(",")];
  for (const row of sheet.rows) {
    const cells = [
      row.number,
      csvCell(row.label),
      csvMoney(row.budget),
      ...row.months.map(csvMoney),
      csvMoney(row.total),
    ];
    lines.push(cells.join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function categoryRow(
  category: Category,
  number: number,
  kind: "expense" | "income",
  summaries: { byCategory: Record<string, number> }[],
  sign: (raw: number) => number,
): YearSheetRow {
  const months = summaries.map((summary) => round2(sign(summary.byCategory[category.id] ?? 0)));
  return {
    id: category.id,
    number: String(number),
    label: category.name,
    budget: category.budget,
    months,
    total: round2(months.reduce((sum, value) => sum + value, 0)),
    kind,
  };
}

function sumRows(id: SheetRowKind, label: string, rows: YearSheetRow[]): YearSheetRow {
  const months = Array.from({ length: 12 }, (_, i) =>
    round2(rows.reduce((sum, row) => sum + row.months[i], 0)),
  );
  return {
    id,
    number: "",
    label,
    budget: round2(rows.reduce((sum, row) => sum + row.budget, 0)),
    months,
    total: round2(months.reduce((sum, value) => sum + value, 0)),
    kind: id,
  };
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvMoney(value: number): string {
  return value.toFixed(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
