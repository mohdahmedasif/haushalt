import { useMemo } from "react";
import { Button, Flex, InputNumber } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { formatSheetNumber } from "../lib/money";
import { currentMonth } from "../lib/dates";
import { buildYearSheet, yearSheetToCsv, type YearSheetRow } from "../lib/report";
import { PageHeader } from "../ui/PageHeader";
import { Money } from "../ui/Money";
import { StatCard } from "../ui/StatCard";
import type { Category, Transaction } from "../types";

export function ReportPage({
  year,
  onYearChange,
  transactions,
  categories,
}: {
  year: number;
  onYearChange: (year: number) => void;
  transactions: Transaction[];
  categories: Category[];
}) {
  const sheet = useMemo(
    () => buildYearSheet(year, transactions, categories),
    [year, transactions, categories],
  );
  const currentKey = currentMonth();
  const expenses = sheet.rows.filter((r) => r.kind === "expense");
  const incomes = sheet.rows.filter((r) => r.kind === "income");
  const totalExpense = sheet.rows.find((r) => r.kind === "total-expense");
  const totalIncome = sheet.rows.find((r) => r.kind === "total-income");
  const grand = sheet.rows.find((r) => r.kind === "grand");

  function downloadCsv() {
    const blob = new Blob([yearSheetToCsv(sheet)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Haushalt year ${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title={`Year ${year}`}
        extra={
          <Flex gap={8}>
            <Button onClick={() => onYearChange(year - 1)}>‹</Button>
            <InputNumber min={2020} max={2100} value={year} onChange={(v) => onYearChange(Number(v || year))} />
            <Button onClick={() => onYearChange(year + 1)}>›</Button>
            <Button icon={<DownloadOutlined />} onClick={downloadCsv}>
              Download CSV
            </Button>
          </Flex>
        }
      >
        Budget, twelve months, totals, then leftover — like a spreadsheet.
      </PageHeader>

      <div className="page-hero cols-3">
        <div className="hero-panel">
          <div className="stat-label">Year leftover</div>
          <div className="stat-value hero">
            <Money value={grand?.total ?? 0} />
          </div>
          <div className="stat-caption">
            Income minus expenses in {year}
            {grand ? ` · planned ${formatSheetNumber(grand.budget)}` : ""}
          </div>
        </div>
        <StatCard
          label="Expenses"
          value={<span style={{ color: "var(--negative)" }}>{formatSheetNumber(totalExpense?.total ?? 0)}</span>}
          caption="All expense categories"
        />
        <StatCard label="Income" value={<Money value={totalIncome?.total ?? 0} />} caption="All income categories" />
      </div>

      <div className="sheet-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th className="sticky-num">#</th>
              <th className="sticky-name">Category</th>
              <th className="col-budget">Budget</th>
              {sheet.headers.map((header, i) => (
                <th key={header} className={monthClass(sheet.monthKeys[i], currentKey)}>
                  {header.replace("-", " ")}
                </th>
              ))}
              <th className="col-total">Total</th>
            </tr>
          </thead>
          <tbody>
            <SectionRow label="Expenses" />
            {expenses.map((row) => (
              <SheetRow key={row.id} row={row} sheet={sheet} currentKey={currentKey} />
            ))}
            {totalExpense && <SheetRow row={totalExpense} sheet={sheet} currentKey={currentKey} />}
            <SectionRow label="Income" />
            {incomes.map((row) => (
              <SheetRow key={row.id} row={row} sheet={sheet} currentKey={currentKey} />
            ))}
            {totalIncome && <SheetRow row={totalIncome} sheet={sheet} currentKey={currentKey} />}
            {grand && <SheetRow row={grand} sheet={sheet} currentKey={currentKey} />}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SectionRow({ label }: { label: string }) {
  return (
    <tr className="sheet-section">
      <td className="sticky-num" />
      <td className="sticky-name">{label}</td>
      <td className="col-budget" />
      {Array.from({ length: 12 }, (_, i) => (
        <td key={i} />
      ))}
      <td className="col-total" />
    </tr>
  );
}

function SheetRow({
  row,
  sheet,
  currentKey,
}: {
  row: YearSheetRow;
  sheet: { monthKeys: string[] };
  currentKey: string;
}) {
  return (
    <tr className={rowClass(row)}>
      <td className="sticky-num">{row.number}</td>
      <td className="sticky-name">{row.label}</td>
      <td className="col-budget">{formatSheetNumber(row.budget)}</td>
      {row.months.map((value, i) => (
        <td key={sheet.monthKeys[i]} className={cellClass(row, value, sheet.monthKeys[i], currentKey)}>
          {formatSheetNumber(value)}
        </td>
      ))}
      <td className={`col-total ${cellClass(row, row.total, "", currentKey)}`}>{formatSheetNumber(row.total)}</td>
    </tr>
  );
}

function rowClass(row: YearSheetRow): string {
  if (row.kind === "total-expense" || row.kind === "total-income") return "sheet-total";
  if (row.kind === "grand") return "sheet-grand";
  if (row.kind === "income") return "sheet-income";
  return "sheet-expense";
}

function monthClass(monthKey: string, currentKey: string): string {
  const parts: string[] = [];
  if (monthKey === currentKey) parts.push("current");
  if (monthKey > currentKey) parts.push("future");
  return parts.join(" ");
}

function cellClass(row: YearSheetRow, value: number, monthKey: string, currentKey: string): string {
  const parts: string[] = [];
  if (monthKey && monthKey === currentKey) parts.push("current");
  if (monthKey && monthKey > currentKey) parts.push("future");
  if (value === 0) parts.push("zero");
  if (row.kind === "expense" && row.budget > 0 && value > row.budget) parts.push("over");
  if (row.kind === "grand") parts.push(value >= 0 ? "positive" : "negative");
  return parts.join(" ");
}
