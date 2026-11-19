import { parseGermanAmount } from "./money";
import { parseGermanDate } from "./dates";
import { buildFingerprint } from "./fingerprint";
import type { ParsedRow } from "../types";

type Field =
  | "accountIban"
  | "bookingDate"
  | "valueDate"
  | "bookingText"
  | "purpose"
  | "counterparty"
  | "iban"
  | "bic"
  | "amount"
  | "currency"
  | "endToEndRef"
  | "mandateRef"
  | "creditorId"
  | "info";

/** One CSV layout: the columns that identify it, and which column holds each field. */
type BankFormat = {
  name: string;
  markers: string[];
  columns: Partial<Record<Field, string>>;
  /** Pick the counterparty when the bank splits payer and payee into two columns. */
  counterparty?: (get: (column: string) => string, amount: number) => string;
};

export const BANK_FORMATS: BankFormat[] = [
  {
    name: "Sparkasse",
    markers: ["Auftragskonto", "Buchungstag", "Betrag"],
    columns: {
      accountIban: "Auftragskonto",
      bookingDate: "Buchungstag",
      valueDate: "Valutadatum",
      bookingText: "Buchungstext",
      purpose: "Verwendungszweck",
      counterparty: "Beguenstigter/Zahlungspflichtiger",
      iban: "Kontonummer/IBAN",
      bic: "BIC (SWIFT-Code)",
      amount: "Betrag",
      currency: "Waehrung",
      endToEndRef: "Kundenreferenz (End-to-End)",
      mandateRef: "Mandatsreferenz",
      creditorId: "Glaeubiger ID",
      info: "Info",
    },
  },
  {
    name: "Volksbank / Raiffeisenbank",
    markers: ["IBAN Auftragskonto", "Buchungstag", "Name Zahlungsbeteiligter", "Betrag"],
    columns: {
      accountIban: "IBAN Auftragskonto",
      bookingDate: "Buchungstag",
      valueDate: "Valutadatum",
      bookingText: "Buchungstext",
      purpose: "Verwendungszweck",
      counterparty: "Name Zahlungsbeteiligter",
      iban: "IBAN Zahlungsbeteiligter",
      bic: "BIC (SWIFT-Code) Zahlungsbeteiligter",
      amount: "Betrag",
      currency: "Waehrung",
      mandateRef: "Mandatsreferenz",
      creditorId: "Glaeubiger ID",
      info: "Bemerkung",
    },
  },
  {
    name: "DKB",
    markers: ["Buchungsdatum", "Wertstellung", "Umsatztyp", "Betrag (€)"],
    columns: {
      bookingDate: "Buchungsdatum",
      valueDate: "Wertstellung",
      bookingText: "Umsatztyp",
      purpose: "Verwendungszweck",
      iban: "IBAN",
      amount: "Betrag (€)",
      endToEndRef: "Kundenreferenz",
      mandateRef: "Mandatsreferenz",
      creditorId: "Gläubiger-ID",
    },
    counterparty: (get, amount) =>
      amount < 0 ? get("Zahlungsempfänger*in") : get("Zahlungspflichtige*r"),
  },
  {
    name: "ING",
    markers: ["Buchung", "Auftraggeber/Empfänger", "Verwendungszweck", "Betrag"],
    columns: {
      bookingDate: "Buchung",
      valueDate: "Wertstellungsdatum",
      bookingText: "Buchungstext",
      purpose: "Verwendungszweck",
      counterparty: "Auftraggeber/Empfänger",
      amount: "Betrag",
      currency: "Währung",
    },
  },
];

/** Every name a header can match, used to tell a bank CSV from any other file. */
const KNOWN_HEADERS = ["Auftragskonto", "Buchungstag", "Buchungsdatum", "Auftraggeber/Empfänger"];

/** Banks put account details above the header, so look for it in the first lines. */
const HEADER_SEARCH_LINES = 30;

/** Parse a German bank CSV export (Sparkasse, Volksbank, DKB or ING). */
export function parseBankCsv(text: string): ParsedRow[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);

  let format: BankFormat | undefined;
  let headerAt = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(lines.length, HEADER_SEARCH_LINES) && !format; i++) {
    const cols = parseCsvLine(lines[i]).map(clean);
    format = BANK_FORMATS.find((f) => f.markers.every((m) => cols.includes(m)));
    if (format) {
      headerAt = i;
      headers = cols;
    }
  }
  if (!format) {
    throw new Error(
      "This does not look like a German bank CSV. Supported: Sparkasse, Volksbank / Raiffeisenbank, DKB and ING exports.",
    );
  }

  const index = Object.fromEntries(headers.map((h, i) => [h, i]));
  const accountIbanFromMeta = metaIban(lines.slice(0, headerAt));
  const rows: ParsedRow[] = [];
  for (const line of lines.slice(headerAt + 1)) {
    const cols = parseCsvLine(line);
    if (cols.length < 4) continue;
    const get = (column: string) => cell(cols, index, column);
    const field = (name: Field) => {
      const column = format.columns[name];
      return column ? get(column) : "";
    };

    const amountRaw = field("amount").replace(/€/g, "");
    if (!amountRaw.trim()) continue;
    const amount = parseGermanAmount(amountRaw);

    const accountIban = field("accountIban") || accountIbanFromMeta;
    const bookingDate = parseGermanDate(field("bookingDate"));
    const valueDate = parseGermanDate(field("valueDate"));
    const bookingText = field("bookingText");
    const purpose = field("purpose");
    const counterparty = format.counterparty ? format.counterparty(get, amount) : field("counterparty");
    const iban = field("iban");
    const endToEndRef = field("endToEndRef");

    const fingerprint = buildFingerprint({
      accountIban,
      bookingDate,
      valueDate,
      bookingText,
      purpose,
      counterparty,
      iban,
      amount,
      endToEndRef,
    });

    rows.push({
      accountIban,
      bookingDate,
      valueDate,
      bookingText,
      purpose,
      counterparty,
      iban,
      bic: field("bic"),
      amount,
      currency: field("currency") || "EUR",
      endToEndRef,
      mandateRef: field("mandateRef"),
      creditorId: field("creditorId"),
      info: field("info"),
      fingerprint,
      rawLine: line,
    });
  }

  return rows;
}

/** @deprecated Use parseBankCsv; kept so older imports keep working. */
export const parseSparkasseCsv = parseBankCsv;

function clean(header: string): string {
  return header.trim().replace(/^"|"$/g, "");
}

/** DKB and ING list the account IBAN in the lines above the header. */
function metaIban(lines: string[]): string {
  for (const line of lines) {
    const match = line.replace(/"/g, "").match(/\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?)\b/);
    if (match) return match[1].replace(/\s/g, "");
  }
  return "";
}

function cell(cols: string[], index: Record<string, number>, key: string): string {
  const i = index[key];
  if (i == null) return "";
  return (cols[i] ?? "").trim();
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ";") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

export async function readCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const looksLikeBank = (text: string) => KNOWN_HEADERS.some((h) => text.includes(h));
  if (looksLikeBank(utf8) && !utf8.includes("\uFFFD")) {
    return utf8;
  }
  const latin = new TextDecoder("windows-1252").decode(buffer);
  if (looksLikeBank(latin)) return latin;
  return utf8;
}
