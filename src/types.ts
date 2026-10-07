export type CategoryKind = "expense" | "income" | "transfer";

export type PersonRole = "self" | "spouse" | "family" | "borrower" | "merchant";

export type ViewId =
  | "overview"
  | "cash"
  | "gold"
  | "transactions"
  | "import"
  | "budgets"
  | "rules"
  | "contracts"
  | "report";

export type CashMovementType = "opening" | "atm_in" | "cash_in" | "cash_out" | "bank_out";

export type GoldForm = "bar" | "coin" | "jewelry" | "other";

export interface GoldPiece {
  id: string;
  grams: number;
  purity: string;
  form: GoldForm;
  note: string;
}

export interface GoldLot {
  id: string;
  purchasedAt: string;
  grams: number;
  purity: string;
  form: GoldForm;
  dealer: string;
  invoiceRef: string;
  totalPaid: number;
  pricePerGram: number;
  note: string;
  pieces: GoldPiece[];
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  budget: number;
  color: string;
  sort: number;
  /** Exclude from income/expense totals (internal transfers, ignored rows). */
  excludeFromBudget: boolean;
  /** Include this category as a row on the year report sheet. */
  showInReport: boolean;
}

export interface CategoryRule {
  id: string;
  priority: number;
  categoryId: string;
  field: "counterparty" | "iban" | "purpose" | "bookingText";
  match: "contains" | "equals";
  value: string;
  note?: string;
  learned: boolean;
}

export interface SplitLine {
  id: string;
  categoryId: string;
  amount: number;
  note?: string;
}

export interface Transaction {
  id: string;
  fingerprint: string;
  accountIban: string;
  bookingDate: string;
  valueDate: string;
  month: string;
  bookingText: string;
  purpose: string;
  counterparty: string;
  iban: string;
  bic: string;
  amount: number;
  currency: string;
  endToEndRef: string;
  mandateRef: string;
  creditorId: string;
  info: string;
  categoryId: string | null;
  splits: SplitLine[];
  /** Spread a yearly/quarterly bill across N months starting at spreadStart. */
  spreadMonths: number;
  spreadStart: string | null;
  excluded: boolean;
  notes: string;
  loanPersonId: string | null;
  loanDirection: "lent" | "repaid" | null;
  /** Outgoing only: how much of this booking someone pays back (refund, employer, person). 0 = all mine. */
  reimburseAmount: number;
  /** Incoming payback points at the outgoing booking it reimburses. */
  loanOriginId: string | null;
  importId: string | null;
  source: "bank" | "cash";
  createdAt: string;
}

export interface CashMovement {
  id: string;
  type: CashMovementType;
  amount: number;
  date: string;
  month: string;
  categoryId: string | null;
  note: string;
  transactionId: string | null;
  createdAt: string;
}

export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  aliases: string[];
  ibans: string[];
  notes: string;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  importedAt: string;
  added: number;
  duplicates: number;
  skipped: number;
}

export interface AppSettings {
  monthBasis: "valueDate" | "bookingDate";
  skipZeroAmount: boolean;
  openingBalance: number | null;
  openingBalanceDate: string | null;
  onboarded: boolean;
  bankBalance: number | null;
  bankBalanceAsOf: string | null;
}

export interface AccountState {
  bankBalance: number;
  bankBalanceAsOf: string | null;
  cashOnHand: number;
  openingBalance: number;
  openingBalanceDate: string | null;
  onboarded: boolean;
}

export interface ParsedRow {
  accountIban: string;
  bookingDate: string;
  valueDate: string;
  bookingText: string;
  purpose: string;
  counterparty: string;
  iban: string;
  bic: string;
  amount: number;
  currency: string;
  endToEndRef: string;
  mandateRef: string;
  creditorId: string;
  info: string;
  fingerprint: string;
  rawLine: string;
}

export interface ImportPreviewRow {
  row: ParsedRow;
  status: "new" | "duplicate" | "soft" | "skip";
  existingId?: string;
  reason?: string;
}

export interface MonthSummary {
  month: string;
  income: number;
  expense: number;
  leftover: number;
  uncategorized: number;
  cashOnHand: number;
  bankBalance: number | null;
  bankBalanceAsOf: string | null;
  byCategory: Record<string, number>;
}
