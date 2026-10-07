import type { CategoryRule } from "../types";

function rule(
  id: string,
  priority: number,
  categoryId: string,
  field: CategoryRule["field"],
  value: string,
  note?: string,
  match: CategoryRule["match"] = "contains",
): CategoryRule {
  return {
    id,
    priority,
    categoryId,
    field,
    match,
    value,
    note,
    learned: false,
  };
}

/** Minimal German bank keyword pack for brand-new empty databases only.
 *  Existing DBs keep their own rules; INSERT OR IGNORE never overwrites them. */
export const SEED_RULES: CategoryRule[] = [
  rule("r-salary", 5, "salary", "bookingText", "LOHN"),
  rule("r-salary2", 5, "salary", "purpose", "Lohn / Gehalt"),
  rule("r-salary3", 5, "salary", "purpose", "Gehalt"),

  rule("r-fee-entgelt", 10, "bank_fee", "bookingText", "ENTGELTABSCHLUSS"),
  rule("r-ignore-abschluss", 5, "ignore", "bookingText", "ABSCHLUSS", "Statement close", "equals"),

  rule("r-radio", 10, "radio", "counterparty", "Rundfunk"),
  rule("r-radio2", 11, "radio", "counterparty", "ARD ZDF"),
  rule("r-radio3", 12, "radio", "purpose", "Rundfunkbeitrag"),

  rule("r-tax-finanzamt", 10, "tax_return", "counterparty", "Finanzamt"),
  rule("r-tax-finanzkasse", 10, "tax_return", "counterparty", "Finanzkasse"),
  rule("r-tax-est-veranl", 9, "tax_return", "purpose", "EST-VERANL"),
  rule("r-tax-taxfix", 10, "taxation", "counterparty", "Taxfix"),

  rule("r-atm", 5, "to_cash", "bookingText", "BARGELDAUSZAHLUNG"),
  rule("r-atm2", 5, "to_cash", "bookingText", "AUSZAHLUNG MIT KUNDENENTGELT"),
  rule("r-cash-deposit", 5, "from_cash", "bookingText", "BARGELDEINZAHLUNG"),
  rule("r-cash-deposit2", 5, "from_cash", "bookingText", "EINZAHLUNG BAR"),

  rule("r-shop-amazon", 30, "shopping", "counterparty", "AMAZON"),
  rule("r-shop-amzn", 31, "shopping", "counterparty", "AMZN"),
  rule("r-reimb-wiedergut", 8, "reimbursement", "bookingText", "WIEDERGUTSCHRIFT"),
];
