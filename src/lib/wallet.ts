import type { Transaction } from "../types";

export interface BankWalletMove {
  type: "atm_in" | "bank_out";
  amount: number;
}

/**
 * How much of a bank booking moves cash in or out of the wallet.
 * An outgoing booking fills the wallet by its "ATM to cash" part; an incoming one
 * empties it by its "Cash deposit" part. With splits, only the matching lines count.
 */
export function bankWalletMove(
  tx: Pick<Transaction, "source" | "amount" | "categoryId" | "splits">,
): BankWalletMove | null {
  if (tx.source !== "bank" || tx.amount === 0) return null;
  const outgoing = tx.amount < 0;
  const wanted = outgoing ? "to_cash" : "from_cash";
  const lines = tx.splits.length
    ? tx.splits
    : tx.categoryId
      ? [{ categoryId: tx.categoryId, amount: tx.amount }]
      : [];
  const total = lines
    .filter((line) => line.categoryId === wanted)
    .reduce((sum, line) => sum + Math.abs(line.amount), 0);
  const amount = Math.round(Math.min(total, Math.abs(tx.amount)) * 100) / 100;
  if (amount <= 0) return null;
  return { type: outgoing ? "atm_in" : "bank_out", amount };
}
