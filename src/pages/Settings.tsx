import { useEffect, useState } from "react";
import { Alert, Button, Input, Popconfirm, Select, Space, Typography } from "antd";
import { api, tryAccessKey } from "../api";
import { PageHeader } from "../ui/PageHeader";
import { SectionCard } from "../ui/SectionCard";
import type { AiStatus } from "../types";

type Model = { id: string; name: string };

export function SettingsPage({
  authRequired,
  onChanged,
}: {
  authRequired: boolean;
  onChanged: () => Promise<void>;
}) {
  const [accessKey, setAccessKey] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessResult, setAccessResult] = useState<{ ok: boolean; text: string } | null>(null);
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

  async function replaceAccessKey() {
    if (!accessKey.trim()) return;
    setAccessBusy(true);
    setAccessResult(null);
    try {
      if (await tryAccessKey(accessKey.trim())) {
        setAccessKey("");
        setAccessResult({ ok: true, text: "This browser now uses the new key." });
      } else {
        setAccessResult({ ok: false, text: "That key was not accepted. Check it and try again." });
      }
    } catch (err) {
      setAccessResult({ ok: false, text: err instanceof Error ? err.message : "Could not reach the app" });
    } finally {
      setAccessBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings">Connections and keys for this install.</PageHeader>

      <SectionCard title="App access key">
        <Typography.Paragraph type="secondary">
          The password for this app itself, set on the server as KEY. This browser remembers it until you
          close it.{" "}
          {authRequired
            ? "If the key was changed on the server, enter the new one here."
            : "No key is set on the server, so the app is open to anyone who can reach it."}
        </Typography.Paragraph>
        {accessResult && (
          <Alert className="import-result" type={accessResult.ok ? "success" : "error"} message={accessResult.text} />
        )}
        {authRequired && (
          <Space wrap>
            <Input.Password
              style={{ width: 340 }}
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              placeholder="New access key"
              autoComplete="off"
              onPressEnter={() => void replaceAccessKey()}
            />
            <Button loading={accessBusy} disabled={!accessKey.trim()} onClick={() => void replaceAccessKey()}>
              Use this key
            </Button>
          </Space>
        )}
      </SectionCard>

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
