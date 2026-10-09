import { useState } from "react";
import { Alert, Button, Space, Typography, Upload } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { downloadBackup, restoreBackupFile } from "../lib/backup";
import { SectionCard } from "./SectionCard";

export function BackupCard({ onRestored }: { onRestored: () => Promise<void> }) {
  const [pending, setPending] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(action: () => Promise<void>, done: string, failed: string) {
    setBusy(true);
    setResult(null);
    try {
      await action();
      setResult({ ok: true, text: done });
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : failed });
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!pending) return;
    const file = pending;
    setPending(null);
    await run(
      async () => {
        await restoreBackupFile(file);
        await onRestored();
      },
      `Restored from ${file.name}.`,
      "Restore failed",
    );
  }

  return (
    <SectionCard title="Backup and restore">
      <Typography.Paragraph type="secondary">
        A backup is one file with everything in Haushalt: bookings, categories, budgets, rules, people, cash, gold and
        settings. It contains your full bank history, so keep it somewhere private.
      </Typography.Paragraph>
      {result && (
        <Alert className="import-result" type={result.ok ? "success" : "error"} message={result.text} />
      )}
      {pending && (
        <Alert
          className="import-result"
          type="warning"
          message={`Replace everything in Haushalt with ${pending.name}?`}
          description="All current data is deleted and replaced by the backup. This cannot be undone."
          action={
            <Space>
              <Button onClick={() => setPending(null)}>Cancel</Button>
              <Button danger type="primary" onClick={() => void restore()}>
                Replace everything
              </Button>
            </Space>
          }
        />
      )}
      <Space wrap>
        <Button
          icon={<DownloadOutlined />}
          loading={busy}
          onClick={() => void run(downloadBackup, "Backup downloaded.", "Backup failed")}
        >
          Download backup
        </Button>
        <Upload
          accept=".json,application/json"
          showUploadList={false}
          beforeUpload={(file) => {
            setResult(null);
            setPending(file);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} disabled={busy}>
            Restore from a backup
          </Button>
        </Upload>
      </Space>
    </SectionCard>
  );
}
