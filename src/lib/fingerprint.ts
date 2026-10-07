import { cents } from "./money";

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

export function buildFingerprint(input: {
  accountIban: string;
  bookingDate: string;
  valueDate: string;
  bookingText: string;
  purpose: string;
  counterparty: string;
  iban: string;
  amount: number;
  endToEndRef: string;
}): string {
  const parts = [
    normalize(input.accountIban),
    input.bookingDate,
    input.valueDate,
    normalize(input.bookingText),
    normalize(input.purpose),
    normalize(input.counterparty),
    normalize(input.iban),
    String(cents(input.amount)),
    normalize(input.endToEndRef),
  ];
  return hash(parts.join("\u001f"));
}

export function buildSoftKey(input: {
  bookingDate: string;
  valueDate?: string;
  counterparty: string;
  iban: string;
  amount: number;
}): string {
  return [
    input.valueDate || input.bookingDate,
    normalize(input.counterparty),
    normalize(input.iban),
    String(cents(input.amount)),
  ].join("\u001f");
}

function hash(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0xabcdef01;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${toHex(h1)}${toHex(h2)}${value.length.toString(16)}`;
}

function toHex(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}
