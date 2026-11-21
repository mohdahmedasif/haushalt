import assert from "node:assert/strict";
import { test } from "node:test";
import { bankWalletMove } from "../src/lib/wallet.ts";

const bank = { source: "bank" as const, categoryId: null as string | null, splits: [] as { id: string; categoryId: string; amount: number }[] };

test("a whole ATM withdrawal fills the wallet by its full amount", () => {
  assert.deepEqual(bankWalletMove({ ...bank, amount: -200, categoryId: "to_cash" }), { type: "atm_in", amount: 200 });
});

test("a split withdrawal fills the wallet by its ATM line only", () => {
  const tx = {
    ...bank,
    amount: -2000,
    categoryId: "loan_out",
    splits: [
      { id: "a", categoryId: "loan_out", amount: 1500 },
      { id: "b", categoryId: "to_cash", amount: 500 },
    ],
  };
  assert.deepEqual(bankWalletMove(tx), { type: "atm_in", amount: 500 });
});

test("split line signs do not matter", () => {
  const tx = { ...bank, amount: -100, splits: [{ id: "a", categoryId: "to_cash", amount: -60 }, { id: "b", categoryId: "groceries", amount: -40 }] };
  assert.deepEqual(bankWalletMove(tx), { type: "atm_in", amount: 60 });
});

test("a split deposit empties the wallet by its deposit line", () => {
  const tx = { ...bank, amount: 300, splits: [{ id: "a", categoryId: "from_cash", amount: 250 }, { id: "b", categoryId: "other_income", amount: 50 }] };
  assert.deepEqual(bankWalletMove(tx), { type: "bank_out", amount: 250 });
});

test("no wallet move without a cash line, for cash bookings, or with the wrong direction", () => {
  assert.equal(bankWalletMove({ ...bank, amount: -50, splits: [{ id: "a", categoryId: "groceries", amount: 50 }] }), null);
  assert.equal(bankWalletMove({ ...bank, amount: 50, categoryId: "to_cash" }), null);
  assert.equal(bankWalletMove({ ...bank, source: "cash", amount: -50, categoryId: "to_cash" }), null);
});
