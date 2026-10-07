import { useState } from "react";
import { Button, Table, Typography } from "antd";
import { formatEur } from "../lib/money";
import { formatDay } from "../lib/dates";
import { PageHeader } from "../ui/PageHeader";
import { Money } from "../ui/Money";
import { StatCard } from "../ui/StatCard";
import { SectionCard } from "../ui/SectionCard";
import { CategoryTag } from "../ui/CategoryTag";
import { EmptyState } from "../ui/EmptyState";
import type { DetectedContract } from "../lib/contracts";

export function ContractsPage({
  contracts,
  provider,
  onRefresh,
  busy,
}: {
  contracts: DetectedContract[];
  provider: string;
  onRefresh: () => Promise<void>;
  busy: boolean;
}) {
  const [showAnalyze, setShowAnalyze] = useState(false);
  const active = contracts.filter((c) => c.status === "active");
  const paused = contracts.filter((c) => c.status === "paused");
  const ended = contracts.filter((c) => c.status === "ended");
  const fix = active
    .filter((c) => c.typicalAmount < 0)
    .reduce((sum, c) => {
      const m = c.cadence === "quarterly" ? c.typicalAmount / 3 : c.cadence === "yearly" ? c.typicalAmount / 12 : c.typicalAmount;
      return sum + m;
    }, 0);

  const soonest = active
    .filter((c) => c.nextExpected)
    .slice()
    .sort((a, b) => (a.nextExpected ?? "").localeCompare(b.nextExpected ?? ""))[0];

  return (
    <>
      <PageHeader
        title="Contracts"
        extra={
          <Button
            type="primary"
            loading={busy}
            onClick={() => {
              void onRefresh().then(() => setShowAnalyze(true));
            }}
          >
            Refresh
          </Button>
        }
      >
        Recurring SEPA payments. Fixkosten about {formatEur(Math.abs(fix))} per month
        {showAnalyze ? ` · last scan: ${provider}` : ""}.
      </PageHeader>
      <div className="page-hero cols-3">
        <div className="hero-panel">
          <div className="stat-label">Fixkosten / month</div>
          <div className="stat-value hero">
            <Money value={fix} />
          </div>
          <div className="stat-caption">Typical spend from active contracts</div>
        </div>
        <StatCard
          label="Active"
          value={active.length}
          caption={`${paused.length} paused · ${ended.length} ended`}
        />
        <StatCard
          label="Next debit"
          value={soonest?.nextExpected ? formatDay(soonest.nextExpected) : "—"}
          caption={soonest ? soonest.name : "Nothing scheduled yet"}
        />
      </div>
      {contracts.length === 0 && (
        <SectionCard>
          <EmptyState title="No contracts found" body="Import bookings first, then refresh to detect recurring SEPA." />
        </SectionCard>
      )}
      <Section title={`Active (${active.length})`} rows={active} />
      <Section title={`Paused (${paused.length})`} rows={paused} />
      <Section title={`Ended (${ended.length})`} rows={ended} />
    </>
  );
}

function Section({ title, rows }: { title: string; rows: DetectedContract[] }) {
  if (!rows.length) return null;
  return (
    <SectionCard title={title} padded={false}>
      <Table
        size="middle"
        rowKey="id"
        pagination={false}
        dataSource={rows}
        columns={[
          {
            title: "Contract",
            render: (_, c) => (
              <div>
                <div className="tx-payee">{c.name}</div>
                <Typography.Text type="secondary">
                  {c.vendor} · {c.count} bookings · {c.evidence}
                </Typography.Text>
              </div>
            ),
          },
          { title: "Cadence", width: 130, render: (_, c) => <CategoryTag name={c.cadence} /> },
          { title: "Typical", align: "right", width: 140, render: (_, c) => <Money value={c.typicalAmount} /> },
          { title: "Last", width: 130, render: (_, c) => formatDay(c.lastDate) },
          { title: "Next", width: 130, render: (_, c) => (c.nextExpected ? formatDay(c.nextExpected) : "—") },
        ]}
      />
    </SectionCard>
  );
}
