import { useMemo, useState } from "react";
import { Alert, Button, Drawer, Input, InputNumber, Progress, Select, Space, Switch, Typography } from "antd";
import { formatEur } from "../lib/money";
import { formatMonth } from "../lib/dates";
import { summarizeMonth } from "../lib/summary";
import { PageHeader } from "../ui/PageHeader";
import { Money } from "../ui/Money";
import { StatCard } from "../ui/StatCard";
import { SectionCard } from "../ui/SectionCard";
import { CategoryTag } from "../ui/CategoryTag";
import type { Category, CategoryRule, Transaction } from "../types";

export function BudgetsPage({
  month,
  categories,
  transactions,
  rules = [],
  onSave,
  onAdd,
  onDelete,
}: {
  month: string;
  categories: Category[];
  transactions: Transaction[];
  rules?: CategoryRule[];
  onSave: (id: string, patch: { budget?: number; name?: string; showInReport?: boolean }) => Promise<void>;
  onAdd: (body: { name: string; kind: "expense" | "income"; budget: number }) => Promise<void>;
  onDelete: (id: string, moveTo?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const summary = summarizeMonth(month, transactions, categories);
  const expenses = categories.filter((c) => c.kind === "expense");
  const incomes = categories.filter((c) => c.kind === "income");
  const dirty = categories.filter((c) => {
    const next = parseAmount(draft[c.id] ?? String(c.budget));
    return next !== c.budget;
  });
  const expenseCap = expenses.reduce((sum, c) => sum + planned(c, draft), 0);
  const incomeCap = incomes.reduce((sum, c) => sum + planned(c, draft), 0);
  const leftover = round2(incomeCap - expenseCap);
  const editing = categories.find((c) => c.id === editId) ?? null;

  async function saveAll() {
    setBusy(true);
    try {
      await Promise.all(dirty.map((c) => onSave(c.id, { budget: parseAmount(draft[c.id] ?? String(c.budget)) })));
      setDraft({});
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Budgets">
        Monthly caps for {formatMonth(month)}. Open a category to rename, delete, or toggle the year report.
      </PageHeader>

      <div className="page-hero cols-3">
        <div className="hero-panel">
          <div className="stat-label">Planned leftover</div>
          <div className="stat-value hero">
            <Money value={leftover} />
          </div>
          <div className="stat-caption">Income targets minus expense caps</div>
        </div>
        <StatCard label="Expense caps" value={<Money value={expenseCap} absolute />} caption="What you plan to spend" />
        <StatCard label="Income targets" value={<Money value={incomeCap} />} caption="What you expect in" />
      </div>

      <Section
        title="Expenses"
        rows={expenses}
        draft={draft}
        summary={summary}
        onDraft={(id, value) => setDraft((d) => ({ ...d, [id]: value }))}
        onSave={async (id) => {
          await onSave(id, { budget: parseAmount(draft[id] ?? "0") });
          setDraft((d) => {
            const next = { ...d };
            delete next[id];
            return next;
          });
        }}
        onEdit={setEditId}
      />
      <Section
        title="Income"
        rows={incomes}
        draft={draft}
        summary={summary}
        onDraft={(id, value) => setDraft((d) => ({ ...d, [id]: value }))}
        onSave={async (id) => {
          await onSave(id, { budget: parseAmount(draft[id] ?? "0") });
          setDraft((d) => {
            const next = { ...d };
            delete next[id];
            return next;
          });
        }}
        onEdit={setEditId}
      />
      <AddCategory onAdd={onAdd} />

      <Drawer
        title={<span className="booking-drawer-title">{editing?.name ?? "Category"}</span>}
        open={Boolean(editing)}
        onClose={() => setEditId(null)}
        width={420}
        classNames={{ body: "booking-drawer-body", header: "booking-drawer-header" }}
        destroyOnHidden
      >
        {editing ? (
          <CategoryEditor
            key={editing.id}
            category={editing}
            categories={categories}
            transactions={transactions}
            rules={rules}
            onSave={async (patch) => {
              await onSave(editing.id, patch);
              if (patch.name) setEditId(editing.id);
            }}
            onDelete={async (moveTo) => {
              await onDelete(editing.id, moveTo);
              setEditId(null);
            }}
            onClose={() => setEditId(null)}
          />
        ) : null}
      </Drawer>

      {dirty.length > 0 && (
        <div className="save-bar">
          <span>
            {dirty.length} unsaved change{dirty.length === 1 ? "" : "s"}
          </span>
          <Button type="primary" loading={busy} onClick={() => void saveAll()}>
            Save changes
          </Button>
        </div>
      )}
    </>
  );
}

function Section({
  title,
  rows,
  draft,
  summary,
  onDraft,
  onSave,
  onEdit,
}: {
  title: string;
  rows: Category[];
  draft: Record<string, string>;
  summary: { byCategory: Record<string, number> };
  onDraft: (id: string, value: string) => void;
  onSave: (id: string) => Promise<void>;
  onEdit: (id: string) => void;
}) {
  const withCap = rows.filter((c) => planned(c, draft) > 0 || Math.abs(summary.byCategory[c.id] ?? 0) > 0);
  const unused = rows.filter((c) => !withCap.includes(c));

  return (
    <SectionCard
      title={title}
      extra={
        <Typography.Text type="secondary">
          {withCap.length} with a budget or spend
        </Typography.Text>
      }
    >
      <div className="budget-grid">
        {withCap.map((category) => (
          <BudgetCard
            key={category.id}
            category={category}
            draft={draft}
            spent={spentAmount(category, summary.byCategory[category.id] ?? 0)}
            onDraft={onDraft}
            onSave={onSave}
            onEdit={onEdit}
          />
        ))}
      </div>
      {unused.length > 0 && (
        <>
          <Typography.Title level={5} style={{ marginTop: 20 }}>
            No budget set
          </Typography.Title>
          <div className="budget-grid">
            {unused.map((category) => (
              <BudgetCard
                key={category.id}
                category={category}
                draft={draft}
                spent={0}
                onDraft={onDraft}
                onSave={onSave}
                onEdit={onEdit}
              />
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}

function BudgetCard({
  category,
  draft,
  spent,
  onDraft,
  onSave,
  onEdit,
}: {
  category: Category;
  draft: Record<string, string>;
  spent: number;
  onDraft: (id: string, value: string) => void;
  onSave: (id: string) => Promise<void>;
  onEdit: (id: string) => void;
}) {
  const value = draft[category.id] ?? String(category.budget);
  const next = parseAmount(value);
  const dirty = next !== category.budget;
  const ratio = next > 0 ? spent / next : spent > 0 ? 1 : 0;
  const isIncome = category.kind === "income";
  const overBudget = !isIncome && ratio > 1;
  const aboveTarget = isIncome && ratio > 1;

  return (
    <div className={`budget-tile${dirty ? " dirty" : ""}${overBudget ? " over" : ""}`}>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
        <button type="button" className="budget-name-btn" onClick={() => onEdit(category.id)}>
          <CategoryTag name={category.name} color={category.color} />
        </button>
        {dirty && <Typography.Text type="secondary">was {formatEur(category.budget)}</Typography.Text>}
      </Space>
      <InputNumber
        prefix="€"
        value={value}
        style={{ width: "100%" }}
        onChange={(v) => onDraft(category.id, String(v ?? 0))}
        onBlur={() => {
          if (dirty) void onSave(category.id);
        }}
      />
      <div className="budget-report-row">
        <span>{category.showInReport ? "On year report" : "Off year report"}</span>
        <Button type="link" size="small" onClick={() => onEdit(category.id)}>
          Edit
        </Button>
      </div>
      {spent > 0 && (
        <div style={{ marginTop: 8 }}>
          <Progress
            percent={Math.min(100, Math.round(ratio * 100))}
            status={overBudget ? "exception" : aboveTarget ? "success" : "normal"}
          />
          <Typography.Text type={overBudget ? "danger" : "secondary"}>
            {formatEur(spent)} {isIncome ? "received this month" : "spent this month"}
          </Typography.Text>
        </div>
      )}
    </div>
  );
}

function CategoryEditor({
  category,
  categories,
  transactions,
  rules,
  onSave,
  onDelete,
  onClose,
}: {
  category: Category;
  categories: Category[];
  transactions: Transaction[];
  rules: CategoryRule[];
  onSave: (patch: { budget?: number; name?: string; showInReport?: boolean }) => Promise<void>;
  onDelete: (moveTo?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [budget, setBudget] = useState(category.budget);
  const [showInReport, setShowInReport] = useState(category.showInReport);
  const [moveTo, setMoveTo] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const bookings = useMemo(() => countCategoryUsage(category.id, transactions), [category.id, transactions]);
  const ruleCount = useMemo(
    () => rules.filter((r) => r.categoryId === category.id).length,
    [rules, category.id],
  );
  const targets = categories.filter((c) => c.kind === category.kind && c.id !== category.id);
  const needsMove = bookings > 0;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name cannot be empty");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const patch: { budget?: number; name?: string; showInReport?: boolean } = {};
      if (trimmed !== category.name) patch.name = trimmed;
      if (budget !== category.budget) patch.budget = budget;
      if (showInReport !== category.showInReport) patch.showInReport = showInReport;
      if (Object.keys(patch).length) await onSave(patch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (needsMove && !moveTo) {
      setError("Pick where to move existing bookings");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onDelete(moveTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
      setBusy(false);
    }
  }

  return (
    <div className="booking-drawer">
      <section className="booking-panel">
        <label className="booking-label">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />

        <label className="booking-label">Monthly budget</label>
        <InputNumber
          prefix="€"
          value={budget}
          min={0}
          style={{ width: "100%" }}
          onChange={(v) => setBudget(Number(v || 0))}
        />

        <div className="budget-report-row" style={{ marginTop: 0 }}>
          <span>Year report</span>
          <Switch checked={showInReport} onChange={setShowInReport} />
        </div>
      </section>

      <section className="booking-panel">
        <label className="booking-label">Delete</label>
        {needsMove ? (
          <>
            <Typography.Text type="secondary">
              {bookings} booking{bookings === 1 ? "" : "s"} use this category. Move them first.
            </Typography.Text>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Move to…"
              value={moveTo}
              onChange={setMoveTo}
              options={targets.map((c) => ({ value: c.id, label: c.name }))}
              style={{ width: "100%" }}
            />
          </>
        ) : (
          <Typography.Text type="secondary">
            No bookings use this category.
            {ruleCount > 0
              ? ` ${ruleCount} rule${ruleCount === 1 ? "" : "s"} will be removed (or pick Move to keep them).`
              : ""}
          </Typography.Text>
        )}
        {!needsMove && ruleCount > 0 ? (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Optional — move rules to…"
            value={moveTo}
            onChange={setMoveTo}
            options={targets.map((c) => ({ value: c.id, label: c.name }))}
            style={{ width: "100%" }}
          />
        ) : null}
      </section>

      {error ? <Alert type="error" message={error} showIcon /> : null}

      <nav className="booking-nav cash-edit-actions">
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <div className="cash-edit-actions-right">
          <Button danger onClick={() => void remove()} loading={busy} disabled={needsMove && !moveTo}>
            Delete
          </Button>
          <Button type="primary" onClick={() => void save()} loading={busy}>
            Save
          </Button>
        </div>
      </nav>
    </div>
  );
}

function AddCategory({
  onAdd,
}: {
  onAdd: (body: { name: string; kind: "expense" | "income"; budget: number }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [budget, setBudget] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <SectionCard title="Add category">
      <div className="compact-form-grid">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — e.g. Pets" />
        <Select
          value={kind}
          onChange={setKind}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
          ]}
        />
        <InputNumber prefix="€" value={budget} onChange={(v) => setBudget(Number(v || 0))} style={{ width: "100%" }} />
        <Button
          type="primary"
          disabled={!name.trim()}
          loading={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void onAdd({ name: name.trim(), kind, budget })
              .then(() => {
                setName("");
                setBudget(0);
              })
              .catch((err) => setError(err instanceof Error ? err.message : "Could not add"))
              .finally(() => setBusy(false));
          }}
        >
          Save category
        </Button>
      </div>
      {error && <Typography.Text type="danger">{error}</Typography.Text>}
    </SectionCard>
  );
}

function countCategoryUsage(id: string, transactions: Transaction[]): number {
  let n = 0;
  for (const tx of transactions) {
    if (tx.categoryId === id) n += 1;
    else if (tx.splits.some((line) => line.categoryId === id)) n += 1;
  }
  return n;
}

function spentAmount(category: Category, raw: number): number {
  if (category.kind === "income") return Math.max(0, raw);
  return Math.abs(Math.min(0, raw));
}

function planned(category: Category, draft: Record<string, string>): number {
  return parseAmount(draft[category.id] ?? String(category.budget));
}

function parseAmount(raw: string): number {
  const n = Number(String(raw).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? round2(n) : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
