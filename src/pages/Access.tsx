import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Input, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { ApiError, api } from "../api";
import { APP_NAME } from "../brand";
import { PinPad } from "../ui/PinPad";
import type { Profile } from "../types";

const PIN_RULE = /^\d{4,8}$/;

function Card({ title, error, children }: { title: string; error?: string; children: ReactNode }) {
  return (
    <div className="wizard">
      <div className="wizard-card">
        <div className="wizard-brand">
          <img src="/logo.svg" width={44} height={44} alt="" />
          <div className="wizard-kicker">{APP_NAME}</div>
        </div>
        <Typography.Title level={2} className="wizard-title">
          {title}
        </Typography.Title>
        {error && <Alert type="error" message={error} style={{ marginBottom: 20 }} />}
        <div className="wizard-body">{children}</div>
      </div>
    </div>
  );
}

function PinInput(props: { value: string; onChange: (value: string) => void; placeholder?: string; onEnter?: () => void }) {
  return (
    <Input.Password
      size="large"
      inputMode="numeric"
      maxLength={8}
      autoComplete="off"
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value.replace(/\D/g, ""))}
      onPressEnter={props.onEnter}
    />
  );
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function PairScreen({ onPaired }: { onPaired: () => Promise<void> }) {
  const [adminKey, setAdminKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!adminKey.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.pair(adminKey.trim());
      await onPaired();
    } catch (err) {
      setError(message(err, "Could not reach the app"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Pair this device" error={error}>
      <Typography.Paragraph type="secondary">
        Enter the admin key once to let this browser use {APP_NAME}. After that you only need your PIN.
      </Typography.Paragraph>
      <label className="wizard-label">Admin key</label>
      <Input.Password
        size="large"
        value={adminKey}
        autoFocus
        autoComplete="off"
        onChange={(e) => setAdminKey(e.target.value)}
        onPressEnter={() => void submit()}
      />
      <div className="wizard-actions">
        <Button type="primary" size="large" loading={busy} disabled={!adminKey.trim()} onClick={() => void submit()}>
          Pair
        </Button>
      </div>
    </Card>
  );
}

export function ProfilePicker({
  profiles,
  onPick,
  onCreate,
}: {
  profiles: Profile[];
  onPick: (profile: Profile) => void;
  onCreate: () => void;
}) {
  return (
    <Card title="Who is it?">
      <div className="profile-grid">
        {profiles.map((profile) => (
          <button key={profile.id} type="button" className="profile-tile" onClick={() => onPick(profile)}>
            <span className="profile-avatar">{profile.name.slice(0, 1).toUpperCase()}</span>
            <span className="profile-name">{profile.name}</span>
          </button>
        ))}
        <button type="button" className="profile-tile add" onClick={onCreate}>
          <span className="profile-avatar">
            <PlusOutlined />
          </span>
          <span className="profile-name">New profile</span>
        </button>
      </div>
    </Card>
  );
}

export function CreateProfileScreen({
  first,
  onCancel,
  onCreated,
}: {
  first: boolean;
  onCancel: () => void;
  onCreated: (profile: Profile) => void;
}) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!name.trim()) return setError("Give the profile a name.");
    if (!PIN_RULE.test(pin)) return setError("The PIN must be 4 to 8 digits.");
    if (pin !== again) return setError("The two PINs do not match.");
    setBusy(true);
    try {
      const profile = await api.createProfile(name.trim(), pin);
      await api.unlock(profile.id, pin);
      onCreated(profile);
    } catch (err) {
      setError(message(err, "Could not create the profile"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={first ? "Create your profile" : "New profile"} error={error}>
      <Typography.Paragraph type="secondary">
        Each profile has its own books and its own PIN.
      </Typography.Paragraph>
      <label className="wizard-label">Name</label>
      <Input size="large" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
      <label className="wizard-label" style={{ marginTop: 16 }}>
        PIN (4 to 8 digits)
      </label>
      <PinInput value={pin} onChange={setPin} />
      <label className="wizard-label" style={{ marginTop: 16 }}>
        PIN again
      </label>
      <PinInput value={again} onChange={setAgain} onEnter={() => void submit()} />
      <div className="wizard-actions">
        {!first && <Button onClick={onCancel}>Back</Button>}
        <Button type="primary" loading={busy} onClick={() => void submit()}>
          Create
        </Button>
      </div>
    </Card>
  );
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

export function PinScreen({
  profile,
  onUnlocked,
  onForgot,
  onSwitch,
}: {
  profile: Profile;
  onUnlocked: () => void;
  onForgot: () => void;
  onSwitch: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const locked = lockedUntil > now;

  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [locked]);

  async function submit(pin: string) {
    setBusy(true);
    setNote("");
    try {
      await api.unlock(profile.id, pin);
      onUnlocked();
    } catch (err) {
      if (err instanceof ApiError && (err.code === "wrong_pin" || err.code === "locked_out")) {
        const until = Number(err.data.lockedUntil ?? 0);
        setNow(Date.now());
        setLockedUntil(until);
        if (err.code === "wrong_pin" && !until) {
          const left = Number(err.data.attemptsLeft ?? 0);
          setNote(`Wrong PIN, ${left} attempt${left === 1 ? "" : "s"} left`);
        } else if (err.code === "wrong_pin") {
          setNote("Wrong PIN");
        }
      } else {
        setNote(message(err, "Could not reach the app"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={profile.name}>
      <div className="pin-status" role="status">
        {locked ? `Locked. Try again in ${countdown(lockedUntil - now)}` : note || "Enter your PIN"}
      </div>
      <PinPad disabled={busy || locked} onSubmit={(pin) => void submit(pin)} />
      <div className="pin-links">
        <Button type="link" onClick={onForgot}>
          Forgot PIN?
        </Button>
        <Button type="link" onClick={onSwitch}>
          Switch profile
        </Button>
      </div>
    </Card>
  );
}

export function ForgotPinScreen({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [adminKey, setAdminKey] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!adminKey.trim()) return setError("Enter the admin key.");
    if (!PIN_RULE.test(pin)) return setError("The PIN must be 4 to 8 digits.");
    if (pin !== again) return setError("The two PINs do not match.");
    setBusy(true);
    try {
      await api.resetPin(profile.id, adminKey.trim(), pin);
      onDone();
    } catch (err) {
      setError(message(err, "Could not reset the PIN"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`New PIN for ${profile.name}`} error={error}>
      <Typography.Paragraph type="secondary">
        Setting a new PIN needs the admin key. It signs this profile out on every device.
      </Typography.Paragraph>
      <label className="wizard-label">Admin key</label>
      <Input.Password
        size="large"
        value={adminKey}
        autoFocus
        autoComplete="off"
        onChange={(e) => setAdminKey(e.target.value)}
      />
      <label className="wizard-label" style={{ marginTop: 16 }}>
        New PIN (4 to 8 digits)
      </label>
      <PinInput value={pin} onChange={setPin} />
      <label className="wizard-label" style={{ marginTop: 16 }}>
        New PIN again
      </label>
      <PinInput value={again} onChange={setAgain} onEnter={() => void submit()} />
      <div className="wizard-actions">
        <Button onClick={onDone}>Back</Button>
        <Button type="primary" loading={busy} onClick={() => void submit()}>
          Set PIN
        </Button>
      </div>
    </Card>
  );
}
