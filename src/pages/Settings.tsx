import { useEffect, useState } from "react";
import { Alert, Button, Input, Popconfirm, Select, Space, Typography } from "antd";
import { api } from "../api";
import { ProfileCard } from "../ui/ProfileCard";
import { PageHeader } from "../ui/PageHeader";
import { SectionCard } from "../ui/SectionCard";
import type { AiStatus } from "../types";

type Model = { id: string; name: string };

export function SettingsPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void run(async () => {
      const next = await api.ai();
      setStatus(next);
      if (next.hasKey) setModels(await api.aiModels());
    });
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function saveKey() {
    if (!apiKey.trim()) return;
    void run(async () => {
      const result = await api.saveAiKey(apiKey.trim());
      setStatus(result.status);
      setModels(result.models);
      setApiKey("");
      await onChanged();
    });
  }

  function removeKey() {
    void run(async () => {
      setStatus(await api.removeAiKey());
      setModels([]);
      await onChanged();
    });
  }

  function chooseModel(model: string) {
    void run(async () => {
      setStatus(await api.setAiModel(model));
      await onChanged();
    });
  }

  return (
    <>
      <PageHeader title="Settings">Your profile, paired devices and connections.</PageHeader>

      <ProfileCard />

      <SectionCard title="Gemini">
        <Typography.Paragraph type="secondary">
          Optional. With a Google Gemini API key, Contracts get clearer names and a status. Only the recurring payments
          are sent (payee, amount, dates, mandate reference). The key is stored encrypted and never shown again.
        </Typography.Paragraph>

        {error && <Alert className="import-result" type="error" message={error} />}
        {status?.unreadable && (
          <Alert
            className="import-result"
            type="warning"
            message="A key is saved but cannot be read on this install. Enter it again."
          />
        )}

        <label className="wizard-label">API key</label>
        <Typography.Paragraph>
          {status?.hasKey ? `Saved · ends in ${status.keyHint}` : "No key saved"}
        </Typography.Paragraph>
        <Space wrap>
          <Input.Password
            style={{ width: 340 }}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status?.hasKey ? "Paste a new key to replace it" : "Paste your Gemini API key"}
            autoComplete="off"
            onPressEnter={saveKey}
          />
          <Button type="primary" loading={busy} disabled={!apiKey.trim()} onClick={saveKey}>
            Save key
          </Button>
          {(status?.hasKey || status?.unreadable) && (
            <Popconfirm title="Remove the saved key?" onConfirm={removeKey}>
              <Button danger disabled={busy}>
                Remove
              </Button>
            </Popconfirm>
          )}
        </Space>

        {status?.hasKey && (
          <>
            <label className="wizard-label" style={{ marginTop: 20 }}>
              Model
            </label>
            <Select
              showSearch
              style={{ width: 340 }}
              value={status.model ?? undefined}
              placeholder="Choose a model"
              loading={busy}
              optionFilterProp="label"
              options={models.map((m) => ({ value: m.id, label: `${m.name} · ${m.id}` }))}
              onChange={chooseModel}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              {models.length} models available for this key.
            </Typography.Paragraph>
          </>
        )}
      </SectionCard>
    </>
  );
}
