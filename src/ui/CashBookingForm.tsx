import { useState } from "react";
import { Alert, Button, DatePicker, Input, InputNumber } from "antd";
import dayjs from "dayjs";
import { formatDay } from "../lib/dates";
import { Money } from "./Money";
import { CategorySelect } from "./CategorySelect";
import type { CashMovement, Category } from "../types";

export function cashMovementEditable(m: CashMovement): boolean {
  if (m.type === "cash_in" || m.type === "cash_out") return true;
  return m.type === "bank_out" && !m.transactionId;
}

function kindLabel(type: CashMovement["type"]): string {
  switch (type) {
    case "cash_out":
      return "Spend";
    case "cash_in":
      return "Received";
    case "bank_out":
      return "To bank";
    default:
      return "Cash";
  }
}

export function CashBookingForm({
  movement,
  categories,
  onSave,
  onDelete,
  onCancel,
  embedded = false,
}: {
  movement: CashMovement;
  categories: Category[];
  onSave: (body: { amount: number; date: string; categoryId: string; note: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel?: () => void;
  /** Inside the bookings drawer — skip the hero (parent already shows it). */
  embedded?: boolean;
}) {
  const isOut = movement.type === "cash_out";
  const isBank = movement.type === "bank_out";
  const expenseCats = categories.filter((c) => c.kind === "expense");
  const inCats = categories.filter((c) => c.kind === "income" || c.id === "loan_in");
  const pickCats = isOut ? expenseCats : inCats;

  const [amount, setAmount] = useState(movement.amount);
  const [date, setDate] = useState(dayjs(movement.date));
  const [categoryId, setCategoryId] = useState(
    movement.categoryId ?? (isOut ? "miscellaneous" : isBank ? "from_cash" : "other_income"),
  );
  const [note, setNote] = useState(movement.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const preview = isOut || isBank ? -Math.abs(amount || 0) : Math.abs(amount || 0);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await onSave({
        amount,
        date: date.format("YYYY-MM-DD"),
        categoryId: isBank ? "from_cash" : categoryId,
        note,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!onDelete) return;
    setBusy(true);
    setError("");
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
      setBusy(false);
    }
  }

  const fields = (
    <>
      <label className="booking-label">Amount</label>
      <InputNumber
        value={amount}
        onChange={(v) => setAmount(Number(v || 0))}
        min={0}
        addonAfter="€"
        style={{ width: "100%" }}
      />

      {!isBank ? (
        <>
          <label className="booking-label">{isOut ? "Category" : "Source"}</label>
          <CategorySelect
            value={categoryId}
            categories={pickCats}
            amount={isOut ? -1 : 1}
            onChange={(id) => {
              const next = id || categoryId;
              setCategoryId(next);
              const name = pickCats.find((c) => c.id === next)?.name;
              if (isOut && name && (!note || note.startsWith("Cash · "))) setNote(`Cash · ${name}`);
            }}
          />
        </>
      ) : null}

      <label className="booking-label">Date</label>
      <DatePicker value={date} onChange={(v) => v && setDate(v)} allowClear={false} style={{ width: "100%" }} />

      <label className="booking-label">Note</label>
      <Input.TextArea
        value={note}
        rows={2}
        onChange={(e) => setNote(e.target.value)}
        placeholder={isBank ? "Which ATM or branch" : isOut ? "What it was for" : "Who paid you, or why"}
      />
    </>
  );

  const actions = (
    <nav className="booking-nav cash-edit-actions">
      {onCancel ? (
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      ) : (
        <span />
      )}
      <div className="cash-edit-actions-right">
        {onDelete ? (
          <Button danger onClick={() => void remove()} loading={busy}>
            Delete
          </Button>
        ) : null}
        <Button type="primary" onClick={() => void submit()} loading={busy}>
          Save
        </Button>
      </div>
    </nav>
  );

  if (embedded) {
    return (
      <>
        {fields}
        {error ? <Alert type="error" message={error} showIcon /> : null}
        {actions}
      </>
    );
  }

  return (
    <div className="booking-drawer cash-edit">
      <header className="booking-hero">
        <div className="booking-hero-meta">
          <span>{formatDay(date.format("YYYY-MM-DD"))}</span>
          <span className="booking-dot">·</span>
          <span>Cash · {kindLabel(movement.type)}</span>
        </div>
        <div className="booking-amount">
          <Money value={preview} />
        </div>
      </header>

      <section className="booking-panel">{fields}</section>

      {error ? <Alert type="error" message={error} showIcon /> : null}
      {actions}
    </div>
  );
}
