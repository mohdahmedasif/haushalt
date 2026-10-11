import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GeminiConfig } from "../src/lib/ai.ts";
import type { AiStatus } from "../src/types.ts";
import { dataDir, db } from "./db.ts";

type StoredAi = { key?: string; model?: string };

/** Per-install secret. Without it (e.g. a backup restored on a new machine) the stored key cannot be read. */
function secretKey(): Buffer {
  const file = join(dataDir, "secret.key");
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, "utf8").trim(), "hex");
    if (key.length === 32) return key;
  }
  const key = randomBytes(32);
  writeFileSync(file, key.toString("hex"), { mode: 0o600 });
  return key;
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

function decrypt(blob: string): string | null {
  try {
    const [version, iv, tag, data] = blob.split(".");
    if (version !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function readAi(): StoredAi {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai'").get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as StoredAi) : {};
}

function writeAi(next: StoredAi): void {
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify(next),
  );
}

export function geminiApiKey(): string | null {
  const stored = readAi().key;
  return stored ? decrypt(stored) : null;
}

export function geminiConfig(): GeminiConfig | null {
  const apiKey = geminiApiKey();
  const model = readAi().model;
  return apiKey && model ? { apiKey, model } : null;
}

/** What the UI may know: never the key itself, only its last four characters. */
export function aiStatus(): AiStatus {
  const stored = readAi();
  const apiKey = stored.key ? decrypt(stored.key) : null;
  return {
    hasKey: Boolean(apiKey),
    keyHint: apiKey ? apiKey.slice(-4) : null,
    unreadable: Boolean(stored.key) && !apiKey,
    model: stored.model ?? null,
  };
}

export function setGeminiKey(apiKey: string | null): void {
  const { key: _old, ...rest } = readAi();
  writeAi(apiKey ? { ...rest, key: encrypt(apiKey) } : rest);
}

export function setGeminiModel(model: string): void {
  writeAi({ ...readAi(), model });
}
