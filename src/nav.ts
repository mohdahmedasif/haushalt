import type { ViewId } from "./types";

export const PATHS: Record<ViewId, string> = {
  overview: "/",
  transactions: "/transactions",
  cash: "/cash",
  gold: "/gold",
  budgets: "/budgets",
  report: "/year",
  contracts: "/contracts",
  import: "/import",
  rules: "/rules",
};

export function pathToView(pathname: string): ViewId {
  const match = (Object.entries(PATHS) as [ViewId, string][]).find(([, path]) => path === pathname);
  return match?.[0] ?? "overview";
}
