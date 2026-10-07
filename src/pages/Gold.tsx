import { useMemo, useState } from "react";
import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, DatePicker, Form, Input, InputNumber, Popconfirm, Select, Space, Table, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { formatEur } from "../lib/money";
import { formatDay } from "../lib/dates";
import {
  formatGrams,
  goldFormLabel,
  goldTotals,
  newGoldPieceId,
  piecesGrams,
  GOLD_FORMS,
  GOLD_PURITIES,
} from "../lib/gold";
import { PageHeader } from "../ui/PageHeader";
import { Money } from "../ui/Money";
import { StatCard } from "../ui/StatCard";
import { SectionCard } from "../ui/SectionCard";
import { EmptyState } from "../ui/EmptyState";
import type { GoldForm, GoldLot, GoldPiece } from "../types";

type DraftPiece = {
  key: string;
  grams: number | null;
  purity: string;
  form: GoldForm;
  note: string;
};

type Draft = {
  purchasedAt: Dayjs;
  pieces: DraftPiece[];
  dealer: string;
  invoiceRef: string;
  totalPaid: number | null;
  note: string;
};

const emptyPiece = (from?: DraftPiece): DraftPiece => ({
  key: newGoldPieceId(),
  grams: null,
  purity: from?.purity ?? "999.9",
  form: from?.form ?? "bar",
  note: "",
});

const emptyDraft = (): Draft => ({
  purchasedAt: dayjs(),
  pieces: [emptyPiece()],
  dealer: "",
  invoiceRef: "",
  note: "",
  totalPaid: null,
});

function lotToDraft(lot: GoldLot): Draft {
  const pieces = lot.pieces?.length
    ? lot.pieces
    : [{ id: lot.id, grams: lot.grams, purity: lot.purity, form: lot.form, note: "" }];
  return {
    purchasedAt: dayjs(lot.purchasedAt),
    pieces: pieces.map((piece) => ({
      key: piece.id || newGoldPieceId(),
      grams: piece.grams,
      purity: piece.purity,
      form: piece.form,
      note: piece.note,
    })),
    dealer: lot.dealer,
    invoiceRef: lot.invoiceRef,
    totalPaid: lot.totalPaid,
    note: lot.note,
  };
}

function draftPieces(draft: Draft): GoldPiece[] {
  return draft.pieces
    .filter((piece) => piece.grams != null && piece.grams > 0)
    .map((piece) => ({
      id: piece.key,
      grams: Math.round(piece.grams! * 1000) / 1000,
      purity: piece.purity.trim() || "999.9",
      form: piece.form,
      note: piece.note.trim(),
    }));
}

export function GoldPage({
  lots,
  onAdd,
  onPatch,
  onDelete,
}: {
  lots: GoldLot[];
  onAdd: (body: Omit<GoldLot, "id" | "createdAt" | "pricePerGram"> & { pricePerGram?: number }) => Promise<void>;
  onPatch: (id: string, body: Partial<GoldLot>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const totals = useMemo(() => goldTotals(lots), [lots]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const grams = piecesGrams(draftPieces(draft));
  const perGram = grams > 0 && draft.totalPaid != null ? Math.round((draft.totalPaid / grams) * 100) / 100 : null;

  function setField<K extends Exclude<keyof Draft, "pieces">>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setPiece<K extends keyof DraftPiece>(key: string, field: K, value: DraftPiece[K]) {
    setDraft((current) => ({
      ...current,
      pieces: current.pieces.map((piece) => (piece.key === key ? { ...piece, [field]: value } : piece)),
    }));
  }

  function addPiece() {
    setDraft((current) => ({
      ...current,
      pieces: [...current.pieces, emptyPiece(current.pieces.at(-1))],
    }));
  }

  function removePiece(key: string) {
    setDraft((current) => ({
      ...current,
      pieces: current.pieces.length <= 1 ? current.pieces : current.pieces.filter((piece) => piece.key !== key),
    }));
  }

  function startEdit(lot: GoldLot) {
    setEditingId(lot.id);
    setError("");
    setDraft(lotToDraft(lot));
    document.getElementById("gold-purchase-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft());
    setError("");
  }

  async function submit() {
    const pieces = draftPieces(draft);
    if (!pieces.length) {
      setError("Enter a weight for each piece");
      return;
    }
    setBusy(true);
    setError("");
    const sameForm = pieces.every((piece) => piece.form === pieces[0].form);
    const body = {
      purchasedAt: draft.purchasedAt.format("YYYY-MM-DD"),
      pieces,
      grams,
      purity: pieces.length === 1 ? pieces[0].purity : pieces.map((piece) => piece.purity).join(" / "),
      form: pieces.length === 1 || sameForm ? pieces[0].form : ("other" as GoldForm),
      dealer: draft.dealer.trim(),
      invoiceRef: draft.invoiceRef.trim(),
      totalPaid: Math.round((draft.totalPaid ?? 0) * 100) / 100,
      note: draft.note.trim(),
    };
    try {
      if (editingId) await onPatch(editingId, body);
      else await onAdd(body);
      setEditingId(null);
      setDraft(emptyDraft());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Gold">Bars, coins, and jewelry you hold. Separate from bank bookings — one purchase can include several pieces.</PageHeader>

      <div className="page-hero cols-3">
        <div className="hero-panel">
          <div className="stat-label">Holdings</div>
          <div className="stat-value hero">{formatGrams(totals.grams)}</div>
          <div className="stat-caption">
            {totals.lots ? `${totals.lots} purchase${totals.lots === 1 ? "" : "s"}` : "Nothing recorded yet"}
          </div>
        </div>
        <StatCard label="Paid" value={<Money value={totals.paid} absolute />} caption="What you spent in total" />
        <StatCard
          label="Average"
          value={totals.grams > 0 ? `${formatEur(totals.avgPerGram)}/g` : "—"}
          caption="Cost per gram overall"
        />
      </div>

      <SectionCard title="Purchases" padded={false}>
        {lots.length === 0 ? (
          <EmptyState
            title="No gold yet"
            body="Add a purchase below: date, each bar’s weight, and the total you paid for the invoice."
          />
        ) : (
          <Table
            size="middle"
            rowKey="id"
            dataSource={[...lots].sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))}
            pagination={false}
            scroll={{ x: 720 }}
            rowClassName={(lot) => (lot.id === editingId ? "gold-row-editing" : "")}
            columns={[
              {
                title: "Date",
                width: 120,
                render: (_, lot) => formatDay(lot.purchasedAt),
              },
              {
                title: "Purchase",
                render: (_, lot) => {
                  const pieces = lot.pieces?.length ? lot.pieces : [];
                  return (
                    <div>
                      <div className="tx-payee">{formatGrams(lot.grams)}</div>
                      {pieces.length > 1 && (
                        <div className="gold-chips">
                          {pieces.map((piece) => (
                            <span className="gold-chip" key={piece.id}>
                              {formatGrams(piece.grams)} {goldFormLabel(piece.form)}
                              {piece.note ? ` · ${piece.note}` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                      {pieces.length <= 1 && (
                        <div className="tx-purpose">
                          {goldFormLabel(lot.form)}
                          {lot.purity ? ` · ${lot.purity}` : ""}
                          {pieces[0]?.note ? ` · ${pieces[0].note}` : ""}
                        </div>
                      )}
                      {(lot.dealer || lot.invoiceRef || lot.note) && (
                        <div className="tx-purpose">
                          {[lot.dealer, lot.invoiceRef, lot.note].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                  );
                },
              },
              {
                title: "Paid",
                align: "right",
                width: 130,
                render: (_, lot) => formatEur(lot.totalPaid),
              },
              {
                title: "€/g",
                align: "right",
                width: 100,
                render: (_, lot) => (lot.grams > 0 ? formatEur(lot.pricePerGram) : "—"),
              },
              {
                title: "",
                width: 128,
                render: (_, lot) => (
                  <Space size={0}>
                    <Button type="link" size="small" onClick={() => startEdit(lot)}>
                      Edit
                    </Button>
                    <Popconfirm title="Delete this purchase?" onConfirm={() => void onDelete(lot.id)}>
                      <Button type="link" size="small" danger>
                        Delete
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </SectionCard>

      <div id="gold-purchase-form">
      <SectionCard
        title={editingId ? "Edit purchase" : "Add purchase"}
        extra={
          editingId ? (
            <Button type="link" onClick={cancelEdit}>
              Cancel
            </Button>
          ) : null
        }
      >
        <Form className="gold-form" layout="vertical" onFinish={() => void submit()}>
          <div className="gold-form-meta">
            <Form.Item label="Date">
              <DatePicker
                value={draft.purchasedAt}
                onChange={(value) => value && setField("purchasedAt", value)}
                allowClear={false}
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item label="Total paid">
              <InputNumber
                value={draft.totalPaid}
                onChange={(value) => setField("totalPaid", value == null ? null : Number(value))}
                min={0}
                step={1}
                addonAfter="€"
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item label="Dealer">
              <Input value={draft.dealer} onChange={(e) => setField("dealer", e.target.value)} placeholder="Shop or mint" />
            </Form.Item>
            <Form.Item label="Invoice">
              <Input value={draft.invoiceRef} onChange={(e) => setField("invoiceRef", e.target.value)} placeholder="Receipt number" />
            </Form.Item>
          </div>

          <div className="gold-pieces">
            <div className="gold-piece-row gold-piece-labels">
              <span>Weight</span>
              <span>Form</span>
              <span>Purity</span>
              <span>Note</span>
              <span />
            </div>
            {draft.pieces.map((piece) => (
              <div className="gold-piece-row" key={piece.key}>
                <InputNumber
                  value={piece.grams}
                  onChange={(value) => setPiece(piece.key, "grams", value == null ? null : Number(value))}
                  min={0}
                  step={0.1}
                  addonAfter="g"
                  placeholder="5"
                  style={{ width: "100%" }}
                  aria-label="Weight in grams"
                />
                <Select
                  value={piece.form}
                  onChange={(value) => setPiece(piece.key, "form", value)}
                  options={GOLD_FORMS}
                  aria-label="Form"
                />
                <Select
                  value={piece.purity}
                  onChange={(value) => setPiece(piece.key, "purity", value)}
                  options={GOLD_PURITIES.map((item) => ({ value: item, label: item }))}
                  showSearch
                  aria-label="Purity"
                />
                <Input
                  value={piece.note}
                  onChange={(e) => setPiece(piece.key, "note", e.target.value)}
                  placeholder="Serial, mint, vault…"
                  aria-label="Piece note"
                />
                <Button
                  type="text"
                  icon={<CloseOutlined />}
                  disabled={draft.pieces.length <= 1}
                  onClick={() => removePiece(piece.key)}
                  aria-label="Remove piece"
                />
              </div>
            ))}
            <div className="gold-pieces-actions">
              <Button type="link" icon={<PlusOutlined />} onClick={addPiece} style={{ paddingLeft: 0 }}>
                Add another piece
              </Button>
              {grams > 0 && (
                <Typography.Text type="secondary">
                  {formatGrams(grams)}
                  {perGram != null ? ` · ${formatEur(perGram)}/g` : ""}
                </Typography.Text>
              )}
            </div>
          </div>

          <div className="gold-form-foot">
            <Form.Item label="Notes" style={{ marginBottom: 0 }}>
              <Input value={draft.note} onChange={(e) => setField("note", e.target.value)} placeholder="Vault, gift, insurance…" />
            </Form.Item>
            <Space>
              {editingId && <Button onClick={cancelEdit}>Cancel</Button>}
              <Button type="primary" htmlType="submit" loading={busy}>
                {editingId ? "Save changes" : "Save purchase"}
              </Button>
            </Space>
          </div>
          {error && <Alert type="error" message={error} style={{ marginTop: 12 }} />}
        </Form>
      </SectionCard>
      </div>
    </>
  );
}
