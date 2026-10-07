import { useState } from "react";
import { Alert, Button, DatePicker, Input, Steps, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { api } from "../api";
import { parseGermanAmount } from "../lib/money";
import { readCsvFile } from "../lib/parseSparkasse";
import type { ImportBatch } from "../types";
import { APP_NAME } from "../brand";

function parseMoneyInput(raw: string): number {
  const text = raw.trim().replace(/€/g, "").trim();
  if (!text) throw new Error("Enter the starting Kontostand");
  if (text.includes(",")) return parseGermanAmount(text);
  const n = Number(text.replace(/\s/g, ""));
  if (Number.isNaN(n)) throw new Error("That amount could not be read");
  return Math.round(n * 100) / 100;
}

export function SetupWizard({ onDone }: { onDone: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [amount, setAmount] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [date, setDate] = useState<Dayjs>(dayjs().subtract(1, "day"));
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState<ImportBatch | null>(null);

  async function saveOpening(onboarded = false) {
    const openingBalance = parseMoneyInput(amount);
    const openingCash = cashAmount.trim() ? parseMoneyInput(cashAmount) : 0;
    if (openingCash < 0) throw new Error("Cash on hand cannot be negative");
    await api.setup({
      openingBalance,
      openingBalanceDate: date.format("YYYY-MM-DD"),
      openingCash,
      onboarded,
    });
    return openingBalance;
  }

  async function nextFromBalance() {
    setError("");
    setBusy(true);
    try {
      await saveOpening(false);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the starting balance");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    setError("");
    setBusy(true);
    try {
      const text = await readCsvFile(file);
      setFileName(file.name);
      setCsvText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that CSV");
      setCsvText("");
    } finally {
      setBusy(false);
    }
  }

  async function finish(withImport: boolean) {
    setError("");
    setBusy(true);
    try {
      await saveOpening(true);
      if (withImport && csvText) {
        const batch = await api.commitImport(fileName || "sparkasse.csv", csvText, false);
        setImported(batch);
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wizard">
      <div className="wizard-card">
        <div className="wizard-brand">
          <img src="/logo.svg" width={44} height={44} alt="" />
          <div className="wizard-kicker">{APP_NAME}</div>
        </div>
        <Typography.Title level={2} className="wizard-title">
          Welcome to {APP_NAME}
        </Typography.Title>
        <Steps
          current={step}
          size="small"
          items={[{ title: "Welcome" }, { title: "Balances" }, { title: "Statement" }]}
          style={{ marginBottom: 28 }}
        />

        {error && <Alert type="error" message={error} style={{ marginBottom: 20 }} />}

        {step === 0 && (
          <div className="wizard-body">
            <Typography.Paragraph>
              Start with your Girokonto balance from the day before the statement, any cash already in your wallet, then
              import the CSV. Home shows opening bank balance plus every imported booking.
            </Typography.Paragraph>
            <Button type="primary" size="large" onClick={() => setStep(1)}>
              Get started
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="wizard-body">
            <Typography.Paragraph type="secondary">
              Use the Kontostand on this date — the day before the first booking in your CSV.
            </Typography.Paragraph>
            <label className="wizard-label">Date of Kontostand</label>
            <DatePicker
              value={date}
              onChange={(value) => value && setDate(value)}
              format="DD.MM.YYYY"
              style={{ width: "100%", marginBottom: 16 }}
              size="large"
            />
            <label className="wizard-label">Girokonto balance</label>
            <Input
              size="large"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="9.779,25"
              suffix="€"
              onPressEnter={() => void nextFromBalance()}
            />
            <label className="wizard-label" style={{ marginTop: 16 }}>
              Cash already on hand
            </label>
            <Input
              size="large"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              placeholder="0,00"
              suffix="€"
              onPressEnter={() => void nextFromBalance()}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              Optional. Notes in your wallet on this date. Leave empty for 0 € — you cannot change this later.
            </Typography.Paragraph>
            <div className="wizard-actions">
              <Button onClick={() => setStep(0)}>Back</Button>
              <Button type="primary" loading={busy} onClick={() => void nextFromBalance()}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-body">
            <Typography.Paragraph type="secondary">
              Drop your bank Umsatz CSV, or skip and import later from Import.
            </Typography.Paragraph>
            <Upload.Dragger
              accept=".csv,.CSV,text/csv"
              showUploadList={false}
              beforeUpload={(file) => {
                void handleFile(file);
                return false;
              }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Drop the Umsatz CSV here</p>
              <p className="ant-upload-hint">{fileName ? fileName : "or click to choose a file"}</p>
            </Upload.Dragger>
            {imported && (
              <Alert
                type="success"
                style={{ marginTop: 16 }}
                message={`Added ${imported.added} · duplicates ${imported.duplicates} · skipped ${imported.skipped}`}
              />
            )}
            <div className="wizard-actions">
              <Button onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => void finish(false)}>Skip for now</Button>
              <Button type="primary" loading={busy} disabled={!csvText} onClick={() => void finish(true)}>
                Import and open
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
