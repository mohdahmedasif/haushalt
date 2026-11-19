import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBankCsv } from "../src/lib/parseSparkasse.ts";

// All data below is made up. Never put a real bank export in a test.
const FAKE_IBAN = "DE00000000000000000000";
const FAKE_PAYEE_IBAN = "DE11111111111111111111";

const SPARKASSE = [
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
  `"${FAKE_IBAN}";"03.01.26";"03.01.26";"FOLGELASTSCHRIFT";"Miete Januar";"DE98ZZZ09999999999";"M-1";"E2E-1";"";"";"";"Muster Vermietung";"${FAKE_PAYEE_IBAN}";"TESTDEFFXXX";"-1.234,56";"EUR";"Umsatz gebucht"`,
  `"${FAKE_IBAN}";"28.01.26";"28.01.26";"LOHN  GEHALT";"Gehalt Januar";"";"";"";"";"";"";"Beispiel GmbH";"${FAKE_PAYEE_IBAN}";"TESTDEFFXXX";"2.500,00";"EUR";"Umsatz gebucht"`,
  `"${FAKE_IBAN}";"29.01.26";"29.01.26";"KARTENZAHLUNG";"Supermarkt; Filiale 1";"";"";"";"";"";"";"Muster Markt";"";"";"-12,5";"EUR";"Umsatz gebucht"`,
].join("\r\n");

test("Sparkasse: dates become ISO and German amounts become numbers", () => {
  const rows = parseBankCsv(SPARKASSE);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].bookingDate, "2026-01-03");
  assert.equal(rows[0].valueDate, "2026-01-03");
  assert.equal(rows[0].amount, -1234.56);
  assert.equal(rows[1].amount, 2500);
  assert.equal(rows[2].amount, -12.5);
});

test("Sparkasse: every column lands in the right field", () => {
  const [rent] = parseBankCsv(SPARKASSE);
  assert.equal(rent.accountIban, FAKE_IBAN);
  assert.equal(rent.counterparty, "Muster Vermietung");
  assert.equal(rent.iban, FAKE_PAYEE_IBAN);
  assert.equal(rent.bic, "TESTDEFFXXX");
  assert.equal(rent.purpose, "Miete Januar");
  assert.equal(rent.bookingText, "FOLGELASTSCHRIFT");
  assert.equal(rent.creditorId, "DE98ZZZ09999999999");
  assert.equal(rent.mandateRef, "M-1");
  assert.equal(rent.endToEndRef, "E2E-1");
  assert.equal(rent.currency, "EUR");
});

test("a semicolon inside quotes stays part of the value", () => {
  assert.equal(parseBankCsv(SPARKASSE)[2].purpose, "Supermarkt; Filiale 1");
});

test("fingerprints are unique per booking and stable across imports", () => {
  const first = parseBankCsv(SPARKASSE).map((r) => r.fingerprint);
  assert.equal(new Set(first).size, first.length);
  assert.deepEqual(parseBankCsv(SPARKASSE).map((r) => r.fingerprint), first);
});

test("a file that is not a bank export is refused", () => {
  assert.throws(() => parseBankCsv("name;email\nAlice;a@example.org"), /German bank CSV/);
});

test("DKB: header below account details, payee chosen by direction", () => {
  const csv = [
    `"Konto";"Girokonto ${FAKE_IBAN}"`,
    '""',
    '"Kontostand vom 31.01.2026:";"1.000,00 €"',
    '""',
    '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
    `"30.01.26";"30.01.26";"Gebucht";"Max Mustermann";"Muster Strom AG";"Abschlag Januar";"Ausgang";"${FAKE_PAYEE_IBAN}";"-45,00 €";"DE98ZZZ09999999999";"M-2";"E2E-2"`,
    `"31.01.26";"31.01.26";"Gebucht";"Beispiel GmbH";"Max Mustermann";"Gehalt";"Eingang";"${FAKE_PAYEE_IBAN}";"1.800,00 €";"";"";""`,
  ].join("\n");
  const [bill, salary] = parseBankCsv(csv);
  assert.equal(bill.accountIban, FAKE_IBAN);
  assert.equal(bill.bookingDate, "2026-01-30");
  assert.equal(bill.amount, -45);
  assert.equal(bill.counterparty, "Muster Strom AG");
  assert.equal(bill.creditorId, "DE98ZZZ09999999999");
  assert.equal(salary.amount, 1800);
  assert.equal(salary.counterparty, "Beispiel GmbH");
});

test("ING: header below account details", () => {
  const csv = [
    "Umsatzanzeige;Datei erstellt am: 01.02.2026 10:00",
    `IBAN;${FAKE_IBAN.replace(/(.{4})/g, "$1 ").trim()}`,
    "Kontoname;Girokonto",
    "",
    "Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung",
    "15.01.2026;15.01.2026;Muster Versicherung;Lastschrift;Beitrag 2026;955,00;EUR;-45,00;EUR",
  ].join("\n");
  const [row] = parseBankCsv(csv);
  assert.equal(row.accountIban, FAKE_IBAN);
  assert.equal(row.bookingDate, "2026-01-15");
  assert.equal(row.counterparty, "Muster Versicherung");
  assert.equal(row.bookingText, "Lastschrift");
  assert.equal(row.amount, -45);
  assert.equal(row.currency, "EUR");
});

test("Volksbank / Raiffeisenbank", () => {
  const csv = [
    "Bezeichnung Auftragskonto;IBAN Auftragskonto;BIC Auftragskonto;Bankname Auftragskonto;Buchungstag;Valutadatum;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;BIC (SWIFT-Code) Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag;Waehrung;Saldo nach Buchung;Bemerkung;Kategorie;Steuerrelevant;Glaeubiger ID;Mandatsreferenz",
    `Girokonto;${FAKE_IBAN};TESTDEFFXXX;Testbank;02.01.2026;02.01.2026;Muster Telefon;${FAKE_PAYEE_IBAN};TESTDEFFXXX;Basislastschrift;Rechnung 12/2025;-19,99;EUR;980,01;;;;DE98ZZZ09999999999;M-3`,
  ].join("\n");
  const [row] = parseBankCsv(csv);
  assert.equal(row.accountIban, FAKE_IBAN);
  assert.equal(row.counterparty, "Muster Telefon");
  assert.equal(row.iban, FAKE_PAYEE_IBAN);
  assert.equal(row.amount, -19.99);
  assert.equal(row.mandateRef, "M-3");
});
