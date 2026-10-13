import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Alert, Spin, Typography } from "antd";
import { api, onAccessLost } from "./api";
import { CreateProfileScreen, ForgotPinScreen, PairScreen, PinScreen, ProfilePicker } from "./pages/Access";
import type { Profile } from "./types";

/** Away (in the background or closed) for this long means the PIN is asked again. */
const AUTO_LOCK_MS = 5 * 60 * 1000;
const STAMP = "haushalt.lastActive";

function touch(): void {
  try {
    localStorage.setItem(STAMP, String(Date.now()));
  } catch {
    // Storage blocked: auto-lock then only works while the tab stays open.
  }
}

function awayTooLong(): boolean {
  try {
    const last = Number(localStorage.getItem(STAMP) ?? 0);
    return last > 0 && Date.now() - last > AUTO_LOCK_MS;
  } catch {
    return false;
  }
}

type Stage =
  | { name: "loading" }
  | { name: "offline"; error: string }
  | { name: "pair" }
  | { name: "pick" }
  | { name: "create" }
  | { name: "pin"; profile: Profile }
  | { name: "forgot"; profile: Profile }
  | { name: "open"; profile: Profile };

type Access = {
  profile: Profile;
  lockNow: () => Promise<void>;
  switchProfile: () => Promise<void>;
  /** After this device was unpaired or the profile deleted: start over. */
  restart: () => Promise<void>;
};

const AccessContext = createContext<Access | null>(null);

export function useAccess(): Access {
  const access = useContext(AccessContext);
  if (!access) throw new Error("useAccess needs an unlocked profile");
  return access;
}

/** Pair screen (first time only) → profile picker → PIN pad → the app. */
export function AccessGate({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<Stage>({ name: "loading" });
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const toPicker = useCallback(async () => {
    const list = await api.profiles();
    setProfiles(list);
    setStage(list.length ? { name: "pick" } : { name: "create" });
  }, []);

  const start = useCallback(async () => {
    try {
      const device = await api.device();
      if (!device.paired) {
        setStage({ name: "pair" });
        return;
      }
      const { profile } = await api.session();
      if (profile && awayTooLong()) {
        await api.lock();
        setStage({ name: "pin", profile });
      } else if (profile) {
        setStage({ name: "open", profile });
      } else {
        await toPicker();
      }
    } catch (error) {
      setStage({ name: "offline", error: error instanceof Error ? error.message : "API is not running" });
    }
  }, [toPicker]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(
    () =>
      onAccessLost((reason) => {
        if (reason === "unpaired") setStage({ name: "pair" });
        else setStage((current) => (current.name === "open" ? { name: "pin", profile: current.profile } : current));
      }),
    [],
  );

  const openProfile = stage.name === "open" ? stage.profile : null;

  const lockNow = useCallback(async () => {
    if (!openProfile) return;
    await api.lock().catch(() => undefined);
    setStage({ name: "pin", profile: openProfile });
  }, [openProfile]);

  const switchProfile = useCallback(async () => {
    await api.lock().catch(() => undefined);
    await toPicker();
  }, [toPicker]);

  useEffect(() => {
    if (!openProfile) return;
    touch();
    const check = () => {
      if (awayTooLong()) void lockNow();
      else touch();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") touch();
      else check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [openProfile, lockNow]);

  switch (stage.name) {
    case "loading":
      return (
        <div className="splash">
          <Spin size="large" />
        </div>
      );
    case "offline":
      return (
        <div className="offline">
          <div className="offline-card">
            <Typography.Title level={3} style={{ fontFamily: "var(--font-serif)" }}>
              Haushalt is offline
            </Typography.Title>
            <Typography.Paragraph>
              Start the app with <Typography.Text code>npm run dev</Typography.Text>, or with Docker Compose.
            </Typography.Paragraph>
            <Alert type="error" message={stage.error} />
          </div>
        </div>
      );
    case "pair":
      return <PairScreen onPaired={start} />;
    case "create":
      return (
        <CreateProfileScreen
          first={profiles.length === 0}
          onCancel={() => setStage({ name: "pick" })}
          onCreated={(profile) => setStage({ name: "open", profile })}
        />
      );
    case "pick":
      return (
        <ProfilePicker
          profiles={profiles}
          onPick={(profile) => setStage({ name: "pin", profile })}
          onCreate={() => setStage({ name: "create" })}
        />
      );
    case "pin":
      return (
        <PinScreen
          profile={stage.profile}
          onUnlocked={() => setStage({ name: "open", profile: stage.profile })}
          onForgot={() => setStage({ name: "forgot", profile: stage.profile })}
          onSwitch={() => void toPicker()}
        />
      );
    case "forgot":
      return <ForgotPinScreen profile={stage.profile} onDone={() => setStage({ name: "pin", profile: stage.profile })} />;
    case "open":
      // Unmounting the app on lock or switch drops everything it had loaded for that profile.
      return (
        <AccessContext.Provider value={{ profile: stage.profile, lockNow, switchProfile, restart: start }}>
          {children}
        </AccessContext.Provider>
      );
  }
}
