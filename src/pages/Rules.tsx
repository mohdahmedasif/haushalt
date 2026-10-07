import { useState } from "react";
import { Alert, Button, Input, Popconfirm, Select, Table, Typography } from "antd";
import { PageHeader } from "../ui/PageHeader";
import { SectionCard } from "../ui/SectionCard";
import { StatCard } from "../ui/StatCard";
import { CategoryTag } from "../ui/CategoryTag";
import { EmptyState } from "../ui/EmptyState";
import type { Category, CategoryRule } from "../types";

export function RulesPage({
  rules,
  categories,
  uncategorizedCount,
  onAdd,
  onDelete,
  onApply,
}: {
  rules: CategoryRule[];
  categories: Category[];
  uncategorizedCount: number;
  onAdd: (rule: { categoryId: string; field: CategoryRule["field"]; value: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onApply: () => Promise<{ scanned: number; applied: number }>;
}) {
  const [categoryId, setCategoryId] = useState("family");
  const [field, setField] = useState<CategoryRule["field"]>("counterparty");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  async function apply() {
    setBusy(true);
    setResult("");
    try {
      const next = await onApply();
      setResult(`Tagged ${next.applied} of ${next.scanned} untagged booking${next.scanned === 1 ? "" : "s"}.`);
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Could not apply rules");
    } finally {
      setBusy(false);
    }
  }

  function addRule() {
    if (!value.trim()) return;
    void onAdd({ categoryId, field, value: value.trim() });
    setValue("");
  }

  return (
    <>
      <PageHeader
        title="Rules"
        extra={
          <Button type="primary" disabled={uncategorizedCount === 0} loading={busy} onClick={() => void apply()}>
            Apply to untagged ({uncategorizedCount})
          </Button>
        }
      >
        Auto-tag bookings by payee or purpose. Tagging a booking also learns that payee for next time.
      </PageHeader>
      {result && <Alert type="success" message={result} style={{ marginBottom: 16 }} />}
      <div className="page-hero cols-3">
        <div className="hero-panel">
          <div className="stat-label">Needs a category</div>
          <div className="stat-value hero">{uncategorizedCount}</div>
          <div className="stat-caption">
            {uncategorizedCount ? "Apply rules to tag these" : "Everything has a category"}
          </div>
        </div>
        <StatCard
          label="All rules"
          value={rules.length}
          caption={`${rules.filter((r) => r.learned).length} learned while tagging`}
        />
        <StatCard
          label="Built-in"
          value={rules.filter((r) => !r.learned).length}
          caption="Starter matches shipped with Haushalt"
        />
      </div>
      <SectionCard title={`Rules (${rules.length})`} padded={false}>
        <Table
          size="middle"
          rowKey="id"
          dataSource={rules}
          pagination={false}
          locale={{ emptyText: <EmptyState title="No rules yet" body="Add a payee or purpose match below." /> }}
          columns={[
            {
              title: "When",
              render: (_, r) => `${fieldLabel(r.field)} contains “${r.value}”`,
            },
            {
              title: "Category",
              render: (_, r) => {
                const cat = categories.find((c) => c.id === r.categoryId);
                return cat ? <CategoryTag name={cat.name} color={cat.color} /> : r.categoryId;
              },
            },
            {
              title: "Source",
              render: (_, r) => (
                <Typography.Text type="secondary">{r.learned ? "learned" : r.note || "built-in"}</Typography.Text>
              ),
            },
            {
              title: "",
              width: 90,
              render: (_, r) => (
                <Popconfirm title="Delete this rule?" onConfirm={() => void onDelete(r.id)}>
                  <Button type="link" danger size="small">
                    Delete
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </SectionCard>
      <SectionCard title="Add a rule">
        <div className="compact-form-grid">
          <Select
            value={field}
            onChange={setField}
            options={[
              { value: "counterparty", label: "Payee contains" },
              { value: "purpose", label: "Purpose contains" },
              { value: "iban", label: "IBAN contains" },
              { value: "bookingText", label: "Booking text contains" },
            ]}
          />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Amazon"
            onPressEnter={addRule}
          />
          <Select
            value={categoryId}
            onChange={setCategoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Button type="primary" onClick={addRule}>
            Save rule
          </Button>
        </div>
      </SectionCard>
    </>
  );
}

function fieldLabel(field: CategoryRule["field"]): string {
  switch (field) {
    case "counterparty":
      return "Payee";
    case "purpose":
      return "Purpose";
    case "iban":
      return "IBAN";
    case "bookingText":
      return "Booking text";
  }
}
