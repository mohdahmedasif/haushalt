import { useMemo, useState } from "react";
import { Alert, Button, DatePicker, Drawer, Form, Input, InputNumber, Segmented, Space, Typography } from "antd";
import dayjs from "dayjs";
import { formatEur } from "../lib/money";
import { formatDay, formatMonth } from "../lib/dates";
import { PageHeader } from "../ui/PageHeader";
import { Money } from "../ui/Money";
import { StatCard } from "../ui/StatCard";
import { SectionCard } from "../ui/SectionCard";
import { EmptyState } from "../ui/EmptyState";
import { CategoryTag } from "../ui/CategoryTag";
import { CategorySelect } from "../ui/CategorySelect";
import { CashBookingForm, cashMovementEditable } from "../ui/CashBookingForm";
import type { CashMovement, Category } from "../types";

const LUMP_PRESETS = [400, 500, 800];

export function CashPage({
  balance,
  movements,
  categories,
  onAdd,
  onPatch,
  onDelete,
}: {
  balance: number;
  movements: CashMovement[];
  categories: Category[];
  onAdd: (body: {
    type: "in" | "out" | "bank";
    amount: number;
    date: string;
    categoryId?: string;
    note?: string;
  }) => Promise<void>;
  onPatch?: (id: string, body: { amount: number; date: string; categoryId: string; note: string }) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  const expenses = categories.filter((c) => c.kind === "expense");
  const inCategories = categories.filter((c) => c.kind === "income" || c.id === "loan_in");
  const [type, setType] = useState<"out" | "in" | "bank">("out");
  const [amount, setAmount] = useState(Math.min(400, balance || 400));
  const [date, setDate] = useState(dayjs());
  const [categoryId, setCategoryId] = useState("groceries");
  const [note, setNote] = useState("Cash · Groceries");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const editing = movements.find((m) => m.id === editId) ?? null;

  const fills = movements.filter((m) => m.type === "atm_in" || m.type === "cash_in" || m.type === "opening");
  const outs = movements.filter((m) => m.type === "cash_out" || m.type === "bank_out");
  const fillMonths = new Set(fills.filter((m) => m.type === "atm_in").map((m) => m.month));
  const lumpMonths = new Set(outs.filter((m) => m.type === "cash_out").map((m) => m.month));
  const staleWallet = balance >= 1500 && lumpMonths.size + 1 < fillMonths.size;
  const timeline = useMemo(() => groupByMonth(movements), [movements]);
  const inTotal = fills.reduce((sum, m) => sum + m.amount, 0);
  const outTotal = outs.reduce((sum, m) => sum + m.amount, 0);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await onAdd({
        type,
        amount,
        date: date.format("YYYY-MM-DD"),
        categoryId: type === "bank" ? undefined : categoryId,
        note,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Cash">
        ATM fills the wallet. Spend and Received book against categories. To bank moves cash back onto the Girokonto.
      </PageHeader>

      {staleWallet && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Old ATM cash may still be in the wallet"
          description={`${formatEur(balance)} came from ${fillMonths.size} ATM month${fillMonths.size === 1 ? "" : "s"}, but spend is only booked for ${lumpMonths.size}. If that cash is already gone, record it below.`}
        />
      )}

      <div className="page-hero cols-3">
        <div className="hero-panel">
          <div className="stat-label">Cash on hand</div>
          <div className="stat-value hero">
            <Money value={balance} />
          </div>
          <div className="stat-caption">Opening + ATM + received − spend</div>
        </div>
        <StatCard label="Into wallet" value={<Money value={inTotal} absolute />} caption="ATM, received, and opening" />
        <StatCard label="Out of wallet" value={<Money value={-outTotal} />} caption="Spend and deposits to bank" />
      </div>

      <SectionCard title="History">
        {timeline.length === 0 ? (
          <EmptyState
            title="No cash movements yet"
            body="Import a CSV with ATM withdrawals, or book spend and cash received below."
          />
        ) : (
          timeline.map(([monthKey, items]) => {
            const total = items.reduce((sum, m) => sum + (m.type === "cash_out" ? -m.amount : m.amount), 0);
            return (
              <div className="cash-month" key={monthKey}>
                <div className="cash-month-head">
                  <Typography.Text strong>{formatMonth(monthKey)}</Typography.Text>
                  <Typography.Text type="secondary">
                    {items.length} · {formatEur(total)}
                  </Typography.Text>
                </div>
                {items.map((m) => {
                  const cat = categories.find((c) => c.id === m.categoryId);
                  const canEdit = cashMovementEditable(m) && onPatch;
                  return (
                    <div
                      className={`cash-line${canEdit ? " cash-line-editable" : ""}`}
                      key={m.id}
                      role={canEdit ? "button" : undefined}
                      tabIndex={canEdit ? 0 : undefined}
                      onClick={canEdit ? () => setEditId(m.id) : undefined}
                      onKeyDown={
                        canEdit
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setEditId(m.id);
                              }
                            }
                          : undefined
                      }
                    >
                      <Typography.Text type="secondary">{formatDay(m.date)}</Typography.Text>
                      <div>
                        <div>{m.note || labelType(m.type)}</div>
                        <Space size={6} style={{ marginTop: 2 }}>
                          <CategoryTag name={labelType(m.type)} />
                          {cat ? <CategoryTag name={cat.name} color={cat.color} /> : null}
                        </Space>
                      </div>
                      <Money value={m.type === "cash_out" || m.type === "bank_out" ? -m.amount : m.amount} />
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </SectionCard>

      <Drawer
        title={
          <span className="booking-drawer-title">
            {editing
              ? editing.type === "cash_out"
                ? "Edit spend"
                : editing.type === "bank_out"
                  ? "Edit deposit"
                  : "Edit received"
              : "Edit"}
          </span>
        }
        open={Boolean(editing)}
        onClose={() => setEditId(null)}
        width={440}
        classNames={{ body: "booking-drawer-body", header: "booking-drawer-header" }}
        destroyOnHidden
      >
        {editing && onPatch ? (
          <CashBookingForm
            key={editing.id}
            movement={editing}
            categories={categories}
            onSave={async (body) => {
              await onPatch(editing.id, body);
              setEditId(null);
            }}
            onDelete={
              onDelete
                ? async () => {
                    await onDelete(editing.id);
                    setEditId(null);
                  }
                : undefined
            }
            onCancel={() => setEditId(null)}
          />
        ) : null}
      </Drawer>

      <SectionCard title="Add cash">
        <Form className="compact-form" layout="vertical" onFinish={() => void submit()}>
          <Form.Item label="Type" style={{ marginBottom: 16 }}>
            <Segmented<"out" | "in" | "bank">
              value={type}
              block
              onChange={(next) => {
                setType(next);
                if (next === "out") {
                  setCategoryId("groceries");
                  setNote((current) => (!current || current.startsWith("Cash") ? "Cash · Groceries" : current));
                } else if (next === "in") {
                  setCategoryId("other_income");
                  setNote((current) => (!current || current.startsWith("Cash ·") ? "Cash received" : current));
                } else {
                  setNote((current) => (!current || current.startsWith("Cash") ? "Cash to bank" : current));
                  if (balance > 0) setAmount(Math.min(amount, balance) || balance);
                }
              }}
              options={[
                { value: "out", label: "Spend" },
                { value: "in", label: "Received" },
                { value: "bank", label: "To bank" },
              ]}
            />
          </Form.Item>
          <div className="compact-form-grid">
            <Form.Item label="Amount">
              <InputNumber value={amount} onChange={(v) => setAmount(Number(v || 0))} min={0} addonAfter="€" style={{ width: "100%" }} />
            </Form.Item>
            {type === "out" ? (
              <Form.Item label="Category">
                <CategorySelect
                  value={categoryId}
                  categories={expenses}
                  onChange={(id) => {
                    const next = id || "groceries";
                    setCategoryId(next);
                    const name = expenses.find((c) => c.id === next)?.name;
                    if (!note || note.startsWith("Cash · ")) setNote(name ? `Cash · ${name}` : "");
                  }}
                />
              </Form.Item>
            ) : type === "in" ? (
              <Form.Item label="Source">
                <CategorySelect
                  value={categoryId}
                  categories={inCategories}
                  amount={1}
                  placeholder="Other income"
                  onChange={(id) => {
                    const next = id || "other_income";
                    setCategoryId(next);
                    const name = inCategories.find((c) => c.id === next)?.name;
                    if (!note || note === "Cash received" || note.startsWith("Cash received ·")) {
                      setNote(name ? `Cash received · ${name}` : "Cash received");
                    }
                  }}
                />
              </Form.Item>
            ) : null}
            <Form.Item label="Date">
              <DatePicker value={date} onChange={(v) => v && setDate(v)} allowClear={false} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Note">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={type === "in" ? "Who paid you, or why" : type === "bank" ? "Which ATM or branch" : "What it was for"}
              />
            </Form.Item>
          </div>
          {(type === "out" || type === "bank") && (
            <Space style={{ marginTop: 12 }} wrap>
              {type === "out"
                ? LUMP_PRESETS.map((n) => (
                    <Button key={n} size="small" type={amount === n ? "primary" : "default"} onClick={() => setAmount(n)}>
                      {n}
                    </Button>
                  ))
                : null}
              {balance > 0 && (
                <Button size="small" type={amount === balance ? "primary" : "default"} onClick={() => setAmount(balance)}>
                  All {formatEur(balance)}
                </Button>
              )}
            </Space>
          )}
          {error && <Alert type="error" message={error} style={{ marginTop: 12 }} />}
          <div className="compact-form-foot">
            <Button type="primary" htmlType="submit" loading={busy}>
              {type === "in" ? "Save received cash" : type === "bank" ? "Save deposit" : "Save spend"}
            </Button>
          </div>
        </Form>
      </SectionCard>
    </>
  );
}

function groupByMonth(rows: CashMovement[]): [string, CashMovement[]][] {
  const map = new Map<string, CashMovement[]>();
  for (const row of rows) {
    const list = map.get(row.month) ?? [];
    list.push(row);
    map.set(row.month, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, items]) => [month, items.sort((a, b) => b.date.localeCompare(a.date))]);
}

function labelType(type: CashMovement["type"]): string {
  switch (type) {
    case "atm_in":
      return "ATM";
    case "cash_in":
      return "Received";
    case "cash_out":
      return "Spend";
    case "bank_out":
      return "To bank";
    case "opening":
      return "Opening";
  }
}
