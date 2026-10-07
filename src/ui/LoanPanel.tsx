import { useMemo, useState } from "react";
import { Button, Select, Switch } from "antd";
import { formatDayShort } from "../lib/dates";
import {
  acceptsLateReimbursement,
  attachReturnPatch,
  candidateReturnBookings,
  detachReturnPatch,
  loanOriginStatus,
  openOriginsForAttach,
  originKind,
  originMatchesIncoming,
  reimbursePatch,
  type LoanOriginStatus,
} from "../lib/lending";
import { formatEur } from "../lib/money";
import type { Person, Transaction } from "../types";

type Patch = (id: string, patch: Partial<Transaction>) => Promise<void>;

export function LoanPanel({
  tx,
  ledger,
  people,
  onPatch,
}: {
  tx: Transaction;
  ledger: Transaction[];
  people: Person[];
  onPatch: Patch;
}) {
  if (tx.amount < 0) return <Reimbursable tx={tx} ledger={ledger} onPatch={onPatch} />;
  const origin = tx.loanOriginId ? ledger.find((row) => row.id === tx.loanOriginId) : null;
  if (origin) return <LinkedPayback tx={tx} origin={origin} ledger={ledger} onPatch={onPatch} />;
  if (tx.amount > 0) {
    const openHits = openOriginsForAttach(tx, people, ledger, undefined, true);
    if (!openHits.length) return null;
    return <LinkToOrigin tx={tx} openHits={openHits} onPatch={onPatch} />;
  }
  return null;
}

function Reimbursable({ tx, ledger, onPatch }: { tx: Transaction; ledger: Transaction[]; onPatch: Patch }) {
  const total = Math.abs(tx.amount);
  const status = loanOriginStatus(tx, ledger);
  const isLoan = originKind(tx) === "lent";
  const on = status.lent > 0;
  const base = isLoan ? status.lent : total;
  const percent = base > 0 ? Math.min(100, (status.repaid / base) * 100) : 0;
  const full = status.repaid >= base - 0.004 && status.repaid > 0;

  const state = full ? "done" : status.settled ? "closed" : "open";
  const pill = isLoan
    ? full
      ? "Fully paid back"
      : `${formatEur(status.outstanding)} to go`
    : full
      ? "Fully reimbursed"
      : status.settled
        ? "Closed"
        : "Open";

  return (
    <section className="booking-panel mb-panel">
      <div className="mb-head">
        <span className="booking-label">{isLoan ? "Lent" : "To be reimbursed"}</span>
        {!isLoan && (
          <Switch
            size="small"
            checked={on}
            onChange={(checked) => void onPatch(tx.id, reimbursePatch(checked ? total : 0))}
          />
        )}
      </div>

      {on && (
        <>
          <div className="mb-summary">
            <div className="mb-figures">
              <span className="mb-back money">{formatEur(status.repaid)}</span>
              <span className="mb-of">
                of {formatEur(base)} {isLoan ? "paid back" : "back"}
              </span>
            </div>
            <div className="mb-bar">
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="mb-status">
              <span className={`mb-pill ${state}`}>{pill}</span>
              {!isLoan && status.settled && !full && (
                <span className="mb-note">
                  You paid <span className="money">{formatEur(total - status.repaid)}</span>
                </span>
              )}
              <span className="mb-spacer" />
              {!isLoan && !status.settled && status.repaid > 0 && (
                <Button size="small" onClick={() => void onPatch(tx.id, reimbursePatch(status.repaid))}>
                  Close
                </Button>
              )}
              {!isLoan && status.settled && !full && (
                <Button size="small" type="link" onClick={() => void onPatch(tx.id, reimbursePatch(total))}>
                  Reopen
                </Button>
              )}
            </div>
          </div>

          {status.installments.length > 0 && (
            <ul className="mb-list">
              {status.installments.map((row) => (
                <li key={row.id}>
                  <span className="mb-date">{formatDayShort(row.valueDate || row.bookingDate)}</span>
                  <span className="mb-who">{row.counterparty || "Incoming"}</span>
                  <span className="mb-amount money">+{formatEur(row.amount)}</span>
                  <button
                    type="button"
                    className="mb-unlink"
                    title="Unlink"
                    onClick={() => void onPatch(row.id, detachReturnPatch(row))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(!status.settled || acceptsLateReimbursement(status)) && (
            <LinkIncoming origin={tx} ledger={ledger} outstanding={status.outstanding} onPatch={onPatch} />
          )}
        </>
      )}
    </section>
  );
}

function LinkIncoming({
  origin,
  ledger,
  outstanding,
  onPatch,
}: {
  origin: Transaction;
  ledger: Transaction[];
  outstanding: number;
  onPatch: Patch;
}) {
  const candidates = useMemo(() => {
    const all = candidateReturnBookings(origin, ledger);
    const target = outstanding > 0 ? outstanding : Math.abs(origin.amount);
    return [...all].sort((a, b) => {
      const am = originMatchesIncoming(origin, a, []) ? 0 : 1;
      const bm = originMatchesIncoming(origin, b, []) ? 0 : 1;
      if (am !== bm) return am - bm;
      return Math.abs(a.amount - target) - Math.abs(b.amount - target);
    });
  }, [origin, ledger, outstanding]);
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const selectedId = candidates.some((row) => row.id === pickedId) ? pickedId : undefined;

  if (!candidates.length) return <p className="mb-empty">No incoming money to link yet.</p>;

  return (
    <div className="mb-link">
      <Select
        showSearch
        allowClear
        optionFilterProp="label"
        value={selectedId}
        onChange={setPickedId}
        placeholder="Link incoming money · search payee or amount"
        popupMatchSelectWidth={false}
        options={candidates.map((row) => ({
          value: row.id,
          label: `${formatDayShort(row.valueDate || row.bookingDate)} · ${row.counterparty || "Incoming"} · ${formatEur(row.amount)}`,
        }))}
      />
      <Button type="primary" disabled={!selectedId} onClick={() => selectedId && void onPatch(selectedId, attachReturnPatch(origin))}>
        Link
      </Button>
    </div>
  );
}

function LinkedPayback({
  tx,
  origin,
  ledger,
  onPatch,
}: {
  tx: Transaction;
  origin: Transaction;
  ledger: Transaction[];
  onPatch: Patch;
}) {
  const status = loanOriginStatus(origin, ledger);
  const isLoan = originKind(origin) === "lent";
  return (
    <section className="booking-panel mb-panel">
      <div className="mb-head">
        <span className="booking-label">{isLoan ? "Paid back" : "Reimbursed"}</span>
        <Button size="small" type="link" onClick={() => void onPatch(tx.id, detachReturnPatch(tx))}>
          Unlink
        </Button>
      </div>
      <div className="mb-origin">
        <span className="mb-date">{formatDayShort(origin.valueDate || origin.bookingDate)}</span>
        <span className="mb-who">{origin.counterparty || "Booking"}</span>
        <span className="money">{formatEur(Math.abs(origin.amount))}</span>
      </div>
      <OriginProgress status={status} isLoan={isLoan} />
    </section>
  );
}

function OriginProgress({ status, isLoan }: { status: LoanOriginStatus; isLoan: boolean }) {
  const base = isLoan ? status.lent : Math.abs(status.origin.amount);
  const percent = base > 0 ? Math.min(100, (status.repaid / base) * 100) : 0;
  return (
    <div className="mb-summary compact">
      <div className="mb-bar">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="mb-status">
        <span className="mb-of">
          {formatEur(status.repaid)} of {formatEur(base)} {isLoan ? "paid back" : "back"}
        </span>
      </div>
    </div>
  );
}

function LinkToOrigin({
  tx,
  openHits,
  onPatch,
}: {
  tx: Transaction;
  openHits: ReturnType<typeof openOriginsForAttach>;
  onPatch: Patch;
}) {
  const [originId, setOriginId] = useState<string | undefined>(undefined);
  const selectedId = openHits.some((hit) => hit.origin.id === originId) ? originId : undefined;
  const groups = (
    [
      { label: "Lent to people", kind: "lent" as const },
      { label: "To be reimbursed", kind: "back" as const },
    ] as const
  )
    .map((group) => ({
      label: group.label,
      options: openHits
        .filter((hit) => originKind(hit.origin) === group.kind)
        .map((hit) => ({
          value: hit.origin.id,
          label: `${formatDayShort(hit.origin.valueDate || hit.origin.bookingDate)} · ${hit.origin.counterparty || "—"} · ${
            group.kind === "lent" ? `${formatEur(hit.outstanding)} open` : formatEur(Math.abs(hit.origin.amount))
          }`,
        })),
    }))
    .filter((group) => group.options.length);

  return (
    <section className="booking-panel mb-panel">
      <div className="mb-head">
        <span className="booking-label">Paid back or reimbursed?</span>
      </div>
      <div className="mb-link">
        <Select
          showSearch
          allowClear
          optionFilterProp="label"
          value={selectedId}
          onChange={setOriginId}
          placeholder="Pick the booking it pays back"
          popupMatchSelectWidth={false}
          options={groups}
        />
        <Button
          type="primary"
          disabled={!selectedId}
          onClick={() => {
            const origin = openHits.find((hit) => hit.origin.id === selectedId)?.origin;
            if (origin) void onPatch(tx.id, attachReturnPatch(origin));
          }}
        >
          Link
        </Button>
      </div>
    </section>
  );
}
