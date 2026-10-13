import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { adoptLegacyLedger, dataDir, deleteLedger } from "./db.ts";

/** Devices, profiles and sessions live apart from the ledgers, so they never end up in a backup. */
const auth = new DatabaseSync(join(dataDir, "auth.sqlite"));
auth.exec("PRAGMA journal_mode = WAL");

/** Numbered steps. Add new ones at the end; never edit one that has shipped. */
const MIGRATIONS = [
  `CREATE TABLE devices (
     id TEXT PRIMARY KEY,
     token_hash TEXT NOT NULL UNIQUE,
     label TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE profiles (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     pin_hash TEXT NOT NULL,
     pin_salt TEXT NOT NULL,
     failed_attempts INTEGER NOT NULL DEFAULT 0,
     locked_until INTEGER,
     created_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     profile_id TEXT NOT NULL,
     device_id TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );`,
];

const applied = (auth.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
for (let step = applied; step < MIGRATIONS.length; step++) {
  auth.exec("BEGIN");
  auth.exec(MIGRATIONS[step]);
  auth.exec(`PRAGMA user_version = ${step + 1}`);
  auth.exec("COMMIT");
}

export const DEVICE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FREE_ATTEMPTS = 5;
/** Lock length after the 5th wrong PIN, then after each further one. */
const LOCK_MINUTES = [1, 5, 30, 120];
const MAX_PROFILES = 12;

export type PublicProfile = { id: string; name: string };
export type Device = { id: string; label: string };
export type UnlockResult =
  | { ok: true; profile: PublicProfile; sessionToken: string }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "locked_out"; lockedUntil: number }
  | { ok: false; code: "wrong_pin"; attemptsLeft: number; lockedUntil: number | null };

type ProfileRow = {
  id: string;
  name: string;
  pin_hash: string;
  pin_salt: string;
  failed_attempts: number;
  locked_until: number | null;
};

let adminKey = "";

/** Call once at startup, after .env has been loaded. */
export function initAdminKey(): void {
  adminKey = loadAdminKey();
}

function loadAdminKey(): string {
  const fromEnv = (process.env.KEY ?? "").trim();
  if (fromEnv) return fromEnv;
  const file = join(dataDir, "admin.key");
  if (existsSync(file)) {
    const saved = readFileSync(file, "utf8").trim();
    if (saved) {
      console.log(`Admin key: read from ${file}`);
      return saved;
    }
  }
  const generated = randomBytes(12).toString("base64url");
  writeFileSync(file, `${generated}\n`, { mode: 0o600 });
  console.log(`Admin key: generated and saved to ${file}`);
  return generated;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time: hashing first makes both sides the same length. */
export function adminKeyMatches(candidate: string): boolean {
  if (!adminKey) initAdminKey();
  return timingSafeEqual(sha256(candidate), sha256(adminKey));
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function tokenHash(token: string): string {
  return sha256(token).toString("hex");
}

export function validPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,8}$/.test(pin);
}

function hashPin(pin: string, salt: string): Buffer {
  return scryptSync(pin, Buffer.from(salt, "hex"), 32);
}

function pinMatches(row: ProfileRow, pin: string): boolean {
  return timingSafeEqual(hashPin(pin, row.pin_salt), Buffer.from(row.pin_hash, "hex"));
}

function newPinHash(pin: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  return { hash: hashPin(pin, salt).toString("hex"), salt };
}

// ---------- devices

export function pairDevice(userAgent: string): string {
  const token = newToken();
  auth
    .prepare("INSERT INTO devices (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), tokenHash(token), userAgent.slice(0, 160) || "Unknown device", new Date().toISOString());
  return token;
}

export function findDevice(token: string): Device | null {
  if (!token) return null;
  const row = auth.prepare("SELECT id, label FROM devices WHERE token_hash = ?").get(tokenHash(token)) as Device | undefined;
  return row ?? null;
}

export function unpairDevice(deviceId: string): void {
  auth.prepare("DELETE FROM sessions WHERE device_id = ?").run(deviceId);
  auth.prepare("DELETE FROM devices WHERE id = ?").run(deviceId);
}

export function unpairOtherDevices(deviceId: string): number {
  auth.prepare("DELETE FROM sessions WHERE device_id <> ?").run(deviceId);
  return Number(auth.prepare("DELETE FROM devices WHERE id <> ?").run(deviceId).changes);
}

// ---------- profiles

/** Only what the picker shows. Hash, salt and lockout state never leave this module. */
export function listProfiles(): PublicProfile[] {
  return auth.prepare("SELECT id, name FROM profiles ORDER BY created_at").all() as PublicProfile[];
}

function profileRow(id: string): ProfileRow | undefined {
  return auth.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as ProfileRow | undefined;
}

export function getProfile(id: string): PublicProfile | null {
  const row = profileRow(id);
  return row ? { id: row.id, name: row.name } : null;
}

export function createProfile(name: string, pin: string): PublicProfile {
  const existing = listProfiles();
  if (existing.length >= MAX_PROFILES) throw new Error(`There can be at most ${MAX_PROFILES} profiles.`);
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A profile with that name already exists.");
  }
  const id = randomUUID();
  // The ledger from before profiles existed goes to whoever sets up first.
  if (existing.length === 0) adoptLegacyLedger(id);
  const { hash, salt } = newPinHash(pin);
  auth
    .prepare("INSERT INTO profiles (id, name, pin_hash, pin_salt, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, name, hash, salt, new Date().toISOString());
  return { id, name };
}

export function unlockProfile(profileId: string, pin: string, deviceId: string): UnlockResult {
  const row = profileRow(profileId);
  if (!row) return { ok: false, code: "not_found" };
  const now = Date.now();
  // While locked, even the right PIN is refused and nothing is counted.
  if (row.locked_until && row.locked_until > now) {
    return { ok: false, code: "locked_out", lockedUntil: row.locked_until };
  }

  if (!validPin(pin) || !pinMatches(row, pin)) {
    const failed = row.failed_attempts + 1;
    const lockedUntil =
      failed >= FREE_ATTEMPTS
        ? now + LOCK_MINUTES[Math.min(failed - FREE_ATTEMPTS, LOCK_MINUTES.length - 1)] * 60_000
        : null;
    auth.prepare("UPDATE profiles SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(failed, lockedUntil, row.id);
    return { ok: false, code: "wrong_pin", attemptsLeft: Math.max(0, FREE_ATTEMPTS - failed), lockedUntil };
  }

  auth.prepare("UPDATE profiles SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(row.id);
  auth.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  const sessionToken = newToken();
  auth
    .prepare("INSERT INTO sessions (token_hash, profile_id, device_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(tokenHash(sessionToken), row.id, deviceId, now + SESSION_TTL_MS, new Date().toISOString());
  return { ok: true, profile: { id: row.id, name: row.name }, sessionToken };
}

export function findSession(token: string, deviceId: string): { profileId: string } | null {
  if (!token) return null;
  const row = auth
    .prepare("SELECT profile_id FROM sessions WHERE token_hash = ? AND device_id = ? AND expires_at > ?")
    .get(tokenHash(token), deviceId, Date.now()) as { profile_id: string } | undefined;
  return row ? { profileId: row.profile_id } : null;
}

export function endSession(token: string): void {
  if (token) auth.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function changePin(profileId: string, currentPin: string, newPin: string): boolean {
  const row = profileRow(profileId);
  if (!row || !validPin(currentPin) || !pinMatches(row, currentPin)) return false;
  const { hash, salt } = newPinHash(newPin);
  auth.prepare("UPDATE profiles SET pin_hash = ?, pin_salt = ? WHERE id = ?").run(hash, salt, profileId);
  return true;
}

/** For a forgotten PIN. The caller has already checked the admin key. Signs the profile out everywhere. */
export function resetPin(profileId: string, newPin: string): boolean {
  if (!profileRow(profileId)) return false;
  const { hash, salt } = newPinHash(newPin);
  auth
    .prepare("UPDATE profiles SET pin_hash = ?, pin_salt = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?")
    .run(hash, salt, profileId);
  auth.prepare("DELETE FROM sessions WHERE profile_id = ?").run(profileId);
  return true;
}

export function deleteProfile(profileId: string, pin: string): boolean {
  const row = profileRow(profileId);
  if (!row || !validPin(pin) || !pinMatches(row, pin)) return false;
  auth.prepare("DELETE FROM sessions WHERE profile_id = ?").run(profileId);
  auth.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
  deleteLedger(profileId);
  return true;
}
