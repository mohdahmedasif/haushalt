import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Typography } from "antd";
import { PageHeader } from "../ui/PageHeader";
import { Money } from "../ui/Money";
import { formatEur } from "../lib/money";
import { StatCard } from "../ui/StatCard";
import { SectionCard } from "../ui/SectionCard";
import { EmptyState } from "../ui/EmptyState";
import { TrendChart } from "../ui/TrendChart";
import { MixChart } from "../ui/MixChart";
import { addMonths, currentMonth, formatDay, formatMonth, monthsBetween } from "../lib/dates";
import { summarizeMonth, visibleInMonth } from "../lib/summary";
import { buildForecast } from "../lib/forecast";
import { buildInsights } from "../lib/insights";
import { withMonth } from "../hooks/useMonth";
import type { DetectedContract } from "../lib/contracts";
import type { CashMovement, Category, GoldLot, Transaction } from "../types";
import { formatGrams, goldTotals } from "../lib/gold";

export function OverviewPage({
  month,
  transactions,
  categories,
  cashOnHand,
  cashMovements,
  goldLots = [],
  bankBalance,
  bankBalanceAsOf,
  contracts,
}: {
  month: string;
  transactions: Transaction[];
  categories: Category[];
  cashOnHand: number;
  cashMovements: CashMovement[];
  goldLots?: GoldLot[];
  bankBalance: number | null;
  bankBalanceAsOf: string | null;
  contracts: DetectedContract[];
}) {
  const navigate = useNavigate();
  const forecast = buildForecast({
    transactions,
    contracts,
    categories,
    bankBalance,
    cashOnHand,
  });
  const summary = summarizeMonth(month, transactions, categories);
  const monthTx = transactions.filter((tx) => visibleInMonth(tx, month) && !tx.excluded);
  const uncat = monthTx.filter((tx) => !tx.categoryId && tx.splits.length === 0).length;
  const hasAtm = cashMovements.some((m) => m.type === "atm_in" && m.month === month);
  const hasCashSpend = cashMovements.some((m) => m.type === "cash_out" && m.month === month);
  const needCashSpend = hasAtm && !hasCashSpend;
  const gold = goldTotals(goldLots);
  const today = currentMonth();
  const trend = monthsBetween(addMonths(month, -5), month).map((m) => ({
    label: formatMonth(m).replace(/ \d{4}$/, "").slice(0, 3),
    value: summarizeMonth(m, transactions, categories).leftover,
  }));
  const mix = categories
    .filter((c) => c.kind === "expense")
    .map((c) => ({
      name: c.name,
      value: Math.abs(Math.min(0, summary.byCategory[c.id] ?? 0)),
      color: c.color,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const insights = useMemo(
    () => buildInsights(Number(month.slice(0, 4)), transactions, categories),
    [month, transactions, categories],
  );

  return (
    <>
      <PageHeader
        title="Home"
        extra={
          <Button type="primary" onClick={() => navigate(withMonth("/import", month))}>
            Import CSV
          </Button>
        }
      >
        {formatMonth(month)} · {monthTx.length} booking{monthTx.length === 1 ? "" : "s"}
      </PageHeader>

      <div className="hero-row">
        <div className="hero-panel">
          <BankCard value={bankBalance} asOf={bankBalanceAsOf} />
        </div>
        <div className="hero-panel">
          <div className="stat-label">Until payday</div>
          <div className="stat-value hero">
            <Money value={forecast.availableUntilSalary ?? 0} />
          </div>
          <div className="stat-caption">
            {forecast.nextSalaryDate
              ? `${forecast.daysUntilSalary} day${forecast.daysUntilSalary === 1 ? "" : "s"} left · next salary ${formatDay(forecast.nextSalaryDate)}`
              : "No salary pattern detected yet"}
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          label="This month leftover"
          value={<Money value={summary.leftover} />}
          caption={`In ${formatEur(summary.income)} · out ${formatEur(summary.expense)}`}
        />
        <StatCard
          label="Needs a category"
          value={uncat}
          caption={uncat ? "Tap to tag these bookings" : "Everything tagged this month"}
          onClick={() => navigate(withMonth("/transactions", month, { uncat: "1" }))}
        />
        <StatCard
          label="Cash on hand"
          value={<Money value={cashOnHand} />}
          caption={
            needCashSpend
              ? "ATM cash this month — say what you spent it on"
              : "ATM in, cash spend out"
          }
          onClick={() => navigate(withMonth("/cash", month))}
        />
        <StatCard
          label="Gold"
          value={formatGrams(gold.grams)}
          caption={
            gold.lots
              ? `${gold.lots} purchase${gold.lots === 1 ? "" : "s"} · paid ${formatEur(gold.paid)}`
              : "Track bars, coins, jewelry"
          }
          onClick={() => navigate(withMonth("/gold", month))}
        />
      </div>

      <div className="page-hero split-row">
        <SectionCard title="Leftover · last 6 months">
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            Income minus expenses{today === month ? " · this month is still open" : ""}.
          </Typography.Paragraph>
          <TrendChart data={trend} />
        </SectionCard>
        <SectionCard title="Where money went">
          {mix.length ? (
            <MixChart data={mix} />
          ) : (
            <EmptyState title="No expenses yet" body="Import a bank CSV, or wait for bookings this month." />
          )}
        </SectionCard>
      </div>

      <div className="page-hero split-row">
        <SectionCard
          title="Coming before payday"
          extra={
            <Button type="link" onClick={() => navigate(withMonth("/contracts", month))}>
              All contracts
            </Button>
          }
        >
          {forecast.upcoming.length === 0 ? (
            <EmptyState
              title="Nothing due before payday"
              body="Either contracts already booked this cycle, or none were found yet."
            />
          ) : (
            <>
              {forecast.upcoming.map((item) => (
                <div className="upcoming-row" key={item.name + item.date}>
                  <div>
                    <div>{item.name}</div>
                    <Typography.Text type="secondary">{formatDay(item.date)}</Typography.Text>
                  </div>
                  <Money value={item.amount} />
                </div>
              ))}
              <Typography.Text type="secondary">
                Still to go out <Money value={-forecast.remainingOutflows} />
              </Typography.Text>
            </>
          )}
        </SectionCard>
        <SectionCard title="Worth a look">
          {insights.notes.length === 0 ? (
            <EmptyState title="Nothing flagged" body="No tax or investment notes for this year." />
          ) : (
            <div className="insight-list">
              {insights.notes.slice(0, 6).map((note) => (
                <div className="insight-item" key={note.id}>
                  <span className={`insight-chip ${note.severity}`}>{note.severity}</span>
                  <div>
                    <div className="insight-title">{note.title}</div>
                    <div className="insight-body">{note.body}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}

function BankCard({
  value,
  asOf,
}: {
  value: number | null;
  asOf: string | null;
}) {
  return (
    <>
      <div className="stat-label">Girokonto</div>
      <div className="stat-value hero">
        <Money value={value ?? 0} />
      </div>
      <div className="stat-caption">
        {asOf ? `As of ${formatDay(asOf.slice(0, 10))}` : "No bank bookings yet"}
        {" · opening balance + imports"}
      </div>
    </>
  );
}
