import { useState } from "react";
import { Alert, Button, Input, Modal, Typography } from "antd";
import { api } from "../api";
import { useAccess } from "../access";
import { SectionCard } from "./SectionCard";

const PIN_RULE = /^\d{4,8}$/;
type Dialog = "pin" | "unpair" | "others" | "delete" | null;

function PinField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <>
      <label className="wizard-label">{props.label}</label>
      <Input.Password
        inputMode="numeric"
        maxLength={8}
        autoComplete="off"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value.replace(/\D/g, ""))}
        style={{ marginBottom: 12 }}
      />
    </>
  );
}

/** Change PIN, unpair devices, delete the profile. Every confirmation is an in-app dialog. */
export function ProfileCard() {
  const { profile, restart } = useAccess();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  function open(next: Dialog) {
    setCurrentPin("");
    setNewPin("");
    setAgain("");
    setError("");
    setDialog(next);
  }

  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    try {
      const text = await action();
      setDialog(null);
      if (text) setDone(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function changePin() {
    if (!PIN_RULE.test(newPin)) return setError("The new PIN must be 4 to 8 digits.");
    if (newPin !== again) return setError("The two new PINs do not match.");
    void run(async () => {
      await api.changePin(currentPin, newPin);
      return "PIN changed.";
    });
  }

  return (
    <SectionCard title={`Profile · ${profile.name}`}>
      {done && <Alert className="import-result" type="success" message={done} closable onClose={() => setDone("")} />}
      <div className="settings-rows">
        <div className="settings-row">
          <Typography.Paragraph type="secondary">The PIN you type to open this profile.</Typography.Paragraph>
          <Button onClick={() => open("pin")}>Change PIN</Button>
        </div>
        <div className="settings-row">
          <Typography.Paragraph type="secondary">
            Lost a phone or laptop? This signs out and unpairs every device except this one.
          </Typography.Paragraph>
          <Button onClick={() => open("others")}>Unpair other devices</Button>
        </div>
        <div className="settings-row">
          <Typography.Paragraph type="secondary">
            This browser will need the admin key again before it can open the app.
          </Typography.Paragraph>
          <Button onClick={() => open("unpair")}>Unpair this device</Button>
        </div>
        <div className="settings-row">
          <Typography.Paragraph type="secondary">
            Deletes this profile and all of its books. Download a backup first if you may want them back.
          </Typography.Paragraph>
          <Button danger onClick={() => open("delete")}>
            Delete profile
          </Button>
        </div>
      </div>

      <Modal
        title="Change PIN"
        open={dialog === "pin"}
        okText="Change PIN"
        confirmLoading={busy}
        onOk={changePin}
        onCancel={() => setDialog(null)}
        destroyOnHidden
      >
        {error && <Alert className="import-result" type="error" message={error} />}
        <PinField label="Current PIN" value={currentPin} onChange={setCurrentPin} />
        <PinField label="New PIN (4 to 8 digits)" value={newPin} onChange={setNewPin} />
        <PinField label="New PIN again" value={again} onChange={setAgain} />
      </Modal>

      <Modal
        title="Unpair other devices?"
        open={dialog === "others"}
        okText="Unpair them"
        confirmLoading={busy}
        onOk={() =>
          void run(async () => {
            const { removed } = await api.unpairOtherDevices();
            return removed === 1 ? "1 other device unpaired." : `${removed} other devices unpaired.`;
          })
        }
        onCancel={() => setDialog(null)}
      >
        {error && <Alert className="import-result" type="error" message={error} />}
        Every other paired browser is signed out and must enter the admin key again.
      </Modal>

      <Modal
        title="Unpair this device?"
        open={dialog === "unpair"}
        okText="Unpair"
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        onOk={() =>
          void run(async () => {
            await api.unpairThisDevice();
            await restart();
          })
        }
        onCancel={() => setDialog(null)}
      >
        {error && <Alert className="import-result" type="error" message={error} />}
        You will need the admin key to use Haushalt in this browser again.
      </Modal>

      <Modal
        title={`Delete ${profile.name}?`}
        open={dialog === "delete"}
        okText="Delete profile"
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        onOk={() =>
          void run(async () => {
            await api.deleteProfile(currentPin);
            await restart();
          })
        }
        onCancel={() => setDialog(null)}
        destroyOnHidden
      >
        {error && <Alert className="import-result" type="error" message={error} />}
        <Typography.Paragraph>
          All bookings, budgets, rules, cash and gold in this profile are deleted. This cannot be undone.
        </Typography.Paragraph>
        <PinField label="PIN to confirm" value={currentPin} onChange={setCurrentPin} />
      </Modal>
    </SectionCard>
  );
}
