import { useState } from "react";
import { Alert, Button, Input, Typography } from "antd";
import { tryAccessKey } from "../api";
import { APP_NAME } from "../brand";

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => Promise<void> }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!key.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (await tryAccessKey(key.trim())) {
        await onUnlocked();
      } else {
        setError("That key was not accepted. Check it and try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the app");
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
          Unlock {APP_NAME}
        </Typography.Title>
        {error && <Alert type="error" message={error} style={{ marginBottom: 20 }} />}
        <div className="wizard-body">
          <label className="wizard-label">Access key</label>
          <Input.Password
            size="large"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoFocus
            onPressEnter={() => void submit()}
          />
          <div className="wizard-actions">
            <Button type="primary" size="large" loading={busy} disabled={!key.trim()} onClick={() => void submit()}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
