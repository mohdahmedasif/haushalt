import type {
  AccountState,
  CashMovement,
  Category,
  CategoryRule,
  GoldLot,
  ImportBatch,
  ImportPreviewRow,
  MonthSummary,
  Person,
  Transaction,
} from "./types";
import type { Forecast } from "./lib/forecast";
import type { AskAnswer } from "./lib/ask";
import type { DetectedContract } from "./lib/contracts";

const API_KEY = import.meta.env.VITE_HAUSHALT_API_KEY || "haushalt-local";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  summary: (month: string) => request<MonthSummary>(`/api/v1/summary?month=${month}`),
  categories: () => request<Category[]>("/api/v1/categories"),
  patchCategory: (id: string, patch: { budget?: number; name?: string; showInReport?: boolean }) =>
    request<Category>(`/api/v1/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCategory: (id: string, moveTo?: string) =>
    request<{ ok: boolean; categories: Category[] }>(`/api/v1/categories/${id}`, {
      method: "DELETE",
      body: JSON.stringify(moveTo ? { moveTo } : {}),
    }),
  addCategory: (body: { name: string; kind: "expense" | "income"; budget?: number }) =>
    request<Category>("/api/v1/categories", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  people: () => request<Person[]>("/api/v1/people"),
  addPerson: (body: { name: string; iban?: string }) =>
    request<Person>("/api/v1/people", { method: "POST", body: JSON.stringify(body) }),
  rules: () => request<CategoryRule[]>("/api/v1/rules"),
  addRule: (rule: Partial<CategoryRule>) =>
    request<CategoryRule>("/api/v1/rules", { method: "POST", body: JSON.stringify(rule) }),
  deleteRule: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/rules/${id}`, { method: "DELETE" }),
  applyRules: () =>
    request<{ scanned: number; applied: number }>("/api/v1/rules/apply", { method: "POST" }),
  transactions: (query = "") => request<Transaction[]>(`/api/v1/transactions${query}`),
  patchTransaction: (id: string, patch: Partial<Transaction> & { learn?: boolean }) =>
    request<Transaction>(`/api/v1/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  previewImport: (fileName: string, csvText: string) =>
    request<ImportPreviewRow[]>("/api/v1/imports/preview", {
      method: "POST",
      body: JSON.stringify({ fileName, csvText }),
    }),
  commitImport: (fileName: string, csvText: string, includeSoft: boolean) =>
    request<ImportBatch & { previewCounts: Record<string, number> }>("/api/v1/imports", {
      method: "POST",
      body: JSON.stringify({ fileName, csvText, includeSoft }),
    }),
  imports: () => request<ImportBatch[]>("/api/v1/imports"),
  cash: () => request<{ balance: number; movements: CashMovement[] }>("/api/v1/cash"),
  addCash: (body: {
    type: "in" | "out" | "bank" | "opening";
    amount: number;
    date: string;
    categoryId?: string;
    note?: string;
    loanPersonId?: string;
    loanDirection?: "lent" | "repaid";
  }) =>
    request<{ movement: CashMovement; balance: number }>("/api/v1/cash/movements", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchCash: (
    id: string,
    body: { amount?: number; date?: string; categoryId?: string | null; note?: string },
  ) =>
    request<{ movement: CashMovement; balance: number }>(`/api/v1/cash/movements/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteCash: (id: string) =>
    request<{ ok: boolean; balance: number }>(`/api/v1/cash/movements/${id}`, { method: "DELETE" }),
  gold: () => request<{ lots: GoldLot[]; totals: { grams: number; paid: number; avgPerGram: number; lots: number } }>("/api/v1/gold"),
  addGold: (body: Omit<GoldLot, "id" | "createdAt" | "pricePerGram">) =>
    request<GoldLot>("/api/v1/gold", { method: "POST", body: JSON.stringify(body) }),
  patchGold: (id: string, body: Partial<GoldLot>) =>
    request<GoldLot>(`/api/v1/gold/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteGold: (id: string) => request<{ ok: boolean }>(`/api/v1/gold/${id}`, { method: "DELETE" }),
  exportAll: () => request<unknown>("/api/v1/export"),
  backup: () => request<{ exportedAt: string }>("/api/v1/backup"),
  restoreBackup: (backupText: string) =>
    request<{ ok: boolean; restored: Record<string, number> }>("/api/v1/backup/restore", {
      method: "POST",
      body: backupText,
    }),
  account: () => request<AccountState>("/api/v1/account"),
  setup: (body: {
    openingBalance: number;
    openingBalanceDate: string;
    openingCash?: number;
    onboarded?: boolean;
  }) =>
    request<AccountState>("/api/v1/setup", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reset: () => request<AccountState>("/api/v1/reset", { method: "POST" }),
  report: (year: number) => request<import("./lib/report").YearSheet>(`/api/v1/report?year=${year}`),
  contracts: () =>
    request<{ provider: string; contracts: DetectedContract[] }>("/api/v1/contracts"),
  analyzeContracts: () =>
    request<{ provider: string; contracts: DetectedContract[] }>("/api/v1/contracts/analyze", {
      method: "POST",
    }),
  forecast: () => request<Forecast>("/api/v1/forecast"),
  ask: (question: string, month?: string) =>
    request<AskAnswer>("/api/v1/ask", {
      method: "POST",
      body: JSON.stringify({ question, month }),
    }),
};
