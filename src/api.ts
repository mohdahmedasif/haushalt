import type {
  AccountState,
  AiStatus,
  CashMovement,
  Category,
  CategoryRule,
  GoldLot,
  ImportBatch,
  ImportPreviewRow,
  MonthSummary,
  Person,
  Profile,
  Transaction,
} from "./types";
import type { Forecast } from "./lib/forecast";
import type { AskAnswer } from "./lib/ask";
import type { DetectedContract } from "./lib/contracts";

/** A failed request, with the server's machine-readable code and any extra fields it sent. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
  }
}

type AccessLost = "unpaired" | "locked";
let accessLost: (reason: AccessLost) => void = () => {};

/** Called when the server says this device is no longer paired, or the profile is no longer unlocked. */
export function onAccessLost(handler: (reason: AccessLost) => void): () => void {
  accessLost = handler;
  return () => {
    accessLost = () => {};
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as Record<string, unknown>;
    if (body.code === "unpaired" || body.code === "locked") accessLost(body.code);
    throw new ApiError(String(body.error || `Request failed: ${res.status}`), res.status, String(body.code ?? ""), body);
  }
  return res.json() as Promise<T>;
}

export const api = {
  device: () => request<{ paired: boolean; name: string }>("/api/v1/device"),
  pair: (adminKey: string) =>
    request<{ paired: boolean }>("/api/v1/device/pair", { method: "POST", body: JSON.stringify({ adminKey }) }),
  unpairThisDevice: () => request<{ paired: boolean }>("/api/v1/device", { method: "DELETE" }),
  unpairOtherDevices: () => request<{ removed: number }>("/api/v1/devices/others", { method: "DELETE" }),
  profiles: () => request<Profile[]>("/api/v1/profiles"),
  createProfile: (name: string, pin: string) =>
    request<Profile>("/api/v1/profiles", { method: "POST", body: JSON.stringify({ name, pin }) }),
  unlock: (profileId: string, pin: string) =>
    request<{ profile: Profile }>(`/api/v1/profiles/${profileId}/unlock`, {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  resetPin: (profileId: string, adminKey: string, newPin: string) =>
    request<{ ok: boolean }>(`/api/v1/profiles/${profileId}/reset-pin`, {
      method: "POST",
      body: JSON.stringify({ adminKey, newPin }),
    }),
  session: () => request<{ profile: Profile | null }>("/api/v1/session"),
  lock: () => request<{ ok: boolean }>("/api/v1/session/lock", { method: "POST" }),
  changePin: (currentPin: string, newPin: string) =>
    request<{ ok: boolean }>("/api/v1/profile/pin", { method: "POST", body: JSON.stringify({ currentPin, newPin }) }),
  deleteProfile: (pin: string) =>
    request<{ ok: boolean }>("/api/v1/profile", { method: "DELETE", body: JSON.stringify({ pin }) }),
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
  ai: () => request<AiStatus>("/api/v1/ai"),
  aiModels: () => request<{ id: string; name: string }[]>("/api/v1/ai/models"),
  saveAiKey: (apiKey: string) =>
    request<{ status: AiStatus; models: { id: string; name: string }[] }>("/api/v1/ai/key", {
      method: "PUT",
      body: JSON.stringify({ apiKey }),
    }),
  removeAiKey: () => request<AiStatus>("/api/v1/ai/key", { method: "DELETE" }),
  setAiModel: (model: string) =>
    request<AiStatus>("/api/v1/ai", { method: "PATCH", body: JSON.stringify({ model }) }),
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
