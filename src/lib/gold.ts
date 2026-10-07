import type { GoldForm, GoldLot, GoldPiece } from "../types";

export const GOLD_FORMS: { value: GoldForm; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "coin", label: "Coin" },
  { value: "jewelry", label: "Jewelry" },
  { value: "other", label: "Other" },
];

export const GOLD_PURITIES = ["999.9", "999", "22K (916)", "18K (750)", "14K (585)"];

const GOLD_FORM_VALUES = new Set<GoldForm>(GOLD_FORMS.map((item) => item.value));

export function newGoldPieceId(): string {
  return crypto.randomUUID();
}

export function normalizeGoldPieces(raw: unknown): GoldPiece[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const piece = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const form = String(piece.form || "bar") as GoldForm;
    return {
      id: String(piece.id || newGoldPieceId()),
      grams: Math.round(Number(piece.grams) * 1000) / 1000,
      purity: String(piece.purity ?? "999.9").trim() || "999.9",
      form: GOLD_FORM_VALUES.has(form) ? form : "bar",
      note: String(piece.note ?? "").trim(),
    };
  });
}

export function goldPiecesError(pieces: GoldPiece[]): string | null {
  if (!pieces.length) return "Add at least one piece";
  if (pieces.some((piece) => !Number.isFinite(piece.grams) || piece.grams <= 0)) {
    return "Each piece needs a weight in grams";
  }
  return null;
}

export function piecesFromLegacy(id: string, grams: number, purity: string, form: GoldForm): GoldPiece[] {
  return [
    {
      id: `${id}-p0`,
      grams,
      purity: purity.trim() || "999.9",
      form,
      note: "",
    },
  ];
}

const gramsFmt = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

export function formatGrams(value: number): string {
  return `${gramsFmt.format(value)} g`;
}

export function goldFormLabel(form: GoldForm): string {
  return GOLD_FORMS.find((item) => item.value === form)?.label ?? form;
}

export function piecesGrams(pieces: GoldPiece[]): number {
  return Math.round(pieces.reduce((sum, piece) => sum + piece.grams, 0) * 1000) / 1000;
}

export function piecesSummary(pieces: GoldPiece[]): { grams: number; purity: string; form: GoldForm } {
  const grams = piecesGrams(pieces);
  const purities = [...new Set(pieces.map((piece) => piece.purity).filter(Boolean))];
  const forms = [...new Set(pieces.map((piece) => piece.form))];
  const form = forms.length === 1 ? forms[0] : "other";
  return {
    grams,
    purity: purities.length === 1 ? purities[0] : purities.join(" / ") || "999.9",
    form,
  };
}

export function goldPiecesLabel(lot: GoldLot): string {
  const pieces = lot.pieces?.length ? lot.pieces : [{ grams: lot.grams, form: lot.form, purity: lot.purity, note: "", id: "" }];
  if (pieces.length <= 1) return `${formatGrams(lot.grams)} · ${goldFormLabel(lot.form)}`;
  const weights = pieces.map((piece) => formatGrams(piece.grams)).join(" + ");
  return `${formatGrams(lot.grams)} · ${pieces.length} pieces (${weights})`;
}

export function goldTotals(lots: GoldLot[]): { grams: number; paid: number; avgPerGram: number; lots: number } {
  const grams = lots.reduce((sum, lot) => sum + lot.grams, 0);
  const paid = lots.reduce((sum, lot) => sum + lot.totalPaid, 0);
  return {
    grams: Math.round(grams * 1000) / 1000,
    paid: Math.round(paid * 100) / 100,
    avgPerGram: grams > 0 ? Math.round((paid / grams) * 100) / 100 : 0,
    lots: lots.length,
  };
}
