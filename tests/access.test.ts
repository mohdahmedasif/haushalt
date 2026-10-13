import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

const ADMIN_KEY = randomBytes(12).toString("base64url");
const dataDir = mkdtempSync(join(tmpdir(), "haushalt-test-"));
let server: ChildProcess;
let base = "";

/** A browser: remembers cookies between requests. */
class Browser {
  cookies = new Map<string, string>();

  async call(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    return { status: res.status, data };
  }

  get = (path: string) => this.call("GET", path);
  post = (path: string, body: unknown = {}) => this.call("POST", path, body);
  del = (path: string, body: unknown = {}) => this.call("DELETE", path, body);

  async pair() {
    const res = await this.post("/device/pair", { adminKey: ADMIN_KEY });
    assert.equal(res.status, 200);
    return this;
  }
}

async function paired() {
  return new Browser().pair();
}

async function newProfile(browser: Browser, name: string, pin: string): Promise<string> {
  const res = await browser.post("/profiles", { name, pin });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.id;
}

/** Move a profile's lock into the past, as if the wait were over. */
function expireLock(profileId: string) {
  const auth = new DatabaseSync(join(dataDir, "auth.sqlite"));
  auth.prepare("UPDATE profiles SET locked_until = 1 WHERE id = ?").run(profileId);
  auth.close();
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}/api/v1`;
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, HAUSHALT_DATA_DIR: dataDir, PORT: String(port), ADMIN_KEY, HOST: "127.0.0.1" },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/device`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server did not start");
});

after(async () => {
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true });
});

test("every route except pair and status answers 403 unpaired without a device cookie", async () => {
  const source = readFileSync("server/index.ts", "utf8");
  const routes = [...source.matchAll(/^app\.(get|post|put|patch|delete)\("(\/api\/v1[^"]*)"/gm)]
    .map((m) => ({ method: m[1].toUpperCase(), path: m[2].replace("/api/v1", "").replace(/:\w+/g, "x") }))
    .filter((r) => !(r.path === "/device" && r.method === "GET") && r.path !== "/device/pair");
  assert.ok(routes.length > 40, "route list was read from the server source");

  const stranger = new Browser();
  for (const route of routes) {
    const res = await stranger.call(route.method, route.path, route.method === "GET" ? undefined : {});
    assert.equal(res.status, 403, `${route.method} ${route.path}`);
    assert.equal(res.data.code, "unpaired", `${route.method} ${route.path}`);
  }

  for (const path of ["/%74ransactions", "/%70rofiles", "/backup%2Frestore", "/%2e%2e/api/v1/transactions", "/TRANSACTIONS"]) {
    const res = await stranger.get(path);
    assert.equal(res.status, 403, path);
    assert.equal(res.data.code, "unpaired", path);
  }
  // An encoded spelling of the pair route is not the pair route.
  const encodedPair = await stranger.post("/device/%70air", { adminKey: ADMIN_KEY });
  assert.equal(encodedPair.status, 403);
  assert.equal(encodedPair.data.code, "unpaired");
  assert.equal(stranger.cookies.size, 0);

  assert.deepEqual((await stranger.get("/device")).data.paired, false);
});

test("a wrong admin key does not pair, and a made-up device cookie is rejected", async () => {
  const stranger = new Browser();
  const wrong = await stranger.post("/device/pair", { adminKey: "not-the-key" });
  assert.equal(wrong.status, 403);
  assert.equal(stranger.cookies.size, 0);
  assert.equal((await stranger.get("/device")).data.paired, false);

  stranger.cookies.set("haushalt_device", randomBytes(32).toString("base64url"));
  assert.equal((await stranger.get("/device")).data.paired, false);
  const res = await stranger.get("/profiles");
  assert.equal(res.status, 403);
  assert.equal(res.data.code, "unpaired");

  const owner = await paired();
  assert.equal((await owner.get("/device")).data.paired, true);
  assert.equal((await owner.get("/profiles")).status, 200);
});

test("the profile list shows only id and name", async () => {
  const owner = await paired();
  await newProfile(owner, "Listed", "1357");
  const list = (await owner.get("/profiles")).data as unknown as Record<string, unknown>[];
  for (const profile of Object.values(list)) assert.deepEqual(Object.keys(profile).sort(), ["id", "name"]);
});

test("an unpaired browser sending wrong PINs cannot lock a profile", async () => {
  const owner = await paired();
  const id = await newProfile(owner, "Unlockable", "2468");

  const stranger = new Browser();
  for (let i = 0; i < 7; i++) {
    const res = await stranger.post(`/profiles/${id}/unlock`, { pin: "0000" });
    assert.equal(res.status, 403);
    assert.equal(res.data.code, "unpaired");
  }
  assert.equal((await stranger.post(`/profiles/${id}/reset-pin`, { adminKey: ADMIN_KEY, newPin: "1111" })).status, 403);
  assert.equal((await stranger.post("/profiles", { name: "Intruder", pin: "1111" })).status, 403);

  // The counter was never touched: one wrong try still leaves four.
  const wrong = await owner.post(`/profiles/${id}/unlock`, { pin: "0000" });
  assert.equal(wrong.data.attemptsLeft, 4);
  assert.equal((await owner.post(`/profiles/${id}/unlock`, { pin: "2468" })).status, 200);
});

test("five wrong PINs lock the profile; the right PIN is refused until the lock expires", async () => {
  const owner = await paired();
  const id = await newProfile(owner, "Lockable", "4321");

  for (let i = 1; i <= 5; i++) {
    const res = await owner.post(`/profiles/${id}/unlock`, { pin: "9999" });
    assert.equal(res.status, 401);
    assert.equal(res.data.code, "wrong_pin");
    assert.equal(res.data.attemptsLeft, 5 - i);
    if (i < 5) assert.equal(res.data.lockedUntil, null);
    else assert.ok(Math.abs(res.data.lockedUntil - Date.now() - 60_000) < 5_000, "first lock is one minute");
  }

  const refused = await owner.post(`/profiles/${id}/unlock`, { pin: "4321" });
  assert.equal(refused.status, 423);
  assert.equal(refused.data.code, "locked_out");
  assert.ok(refused.data.lockedUntil > Date.now());
  assert.equal((await owner.get("/session")).data.profile, null);

  // A further wrong PIN after the wait locks for longer.
  expireLock(id);
  const sixth = await owner.post(`/profiles/${id}/unlock`, { pin: "9999" });
  assert.equal(sixth.data.code, "wrong_pin");
  assert.ok(Math.abs(sixth.data.lockedUntil - Date.now() - 5 * 60_000) < 5_000, "second lock is five minutes");

  expireLock(id);
  assert.equal((await owner.post(`/profiles/${id}/unlock`, { pin: "4321" })).status, 200);

  // Counter is back to zero.
  await owner.post("/session/lock");
  const wrong = await owner.post(`/profiles/${id}/unlock`, { pin: "9999" });
  assert.equal(wrong.data.attemptsLeft, 4);
  assert.equal(wrong.data.lockedUntil, null);
});

test("one profile's session cannot read or change another profile's data", async () => {
  const anna = await paired();
  const ben = await paired();
  const annaId = await newProfile(anna, "Anna", "1111");
  const benId = await newProfile(ben, "Ben", "2222");
  assert.equal((await anna.post(`/profiles/${annaId}/unlock`, { pin: "1111" })).status, 200);
  assert.equal((await ben.post(`/profiles/${benId}/unlock`, { pin: "2222" })).status, 200);

  const category = (await anna.post("/categories", { name: "Anna only", kind: "expense", budget: 10 })).data;
  await anna.post("/setup", { openingBalance: 777, openingBalanceDate: "2026-09-30", onboarded: true });
  const cash = (await anna.post("/cash/movements", { type: "out", amount: 12, date: "2026-10-01", note: "anna-secret" }))
    .data.movement;

  const benCategories = (await ben.get("/categories")).data as unknown as { id: string; name: string }[];
  assert.ok(!Object.values(benCategories).some((c) => c.name === "Anna only"));
  assert.equal((await ben.get("/account")).data.openingBalance, 0);
  assert.ok(!JSON.stringify((await ben.get("/cash")).data).includes("anna-secret"));
  assert.ok(!JSON.stringify((await ben.get("/backup")).data).includes("anna-secret"));

  assert.notEqual((await ben.call("PATCH", `/categories/${category.id}`, { name: "Hacked" })).status, 200);
  assert.notEqual((await ben.del(`/cash/movements/${cash.id}`)).status, 200);
  await ben.post("/reset");

  const annaCategories = (await anna.get("/categories")).data as unknown as { name: string }[];
  assert.ok(Object.values(annaCategories).some((c) => c.name === "Anna only"));
  assert.equal((await anna.get("/account")).data.openingBalance, 777);
  assert.ok(JSON.stringify((await anna.get("/cash")).data).includes("anna-secret"));

  // A session cookie only works on the device it was made on.
  const thief = await paired();
  thief.cookies.set("haushalt_session", anna.cookies.get("haushalt_session")!);
  assert.equal((await thief.get("/categories")).data.code, "locked");
});

test("changing a PIN needs the current PIN", async () => {
  const owner = await paired();
  const id = await newProfile(owner, "Changer", "5555");
  await owner.post(`/profiles/${id}/unlock`, { pin: "5555" });

  assert.equal((await owner.post("/profile/pin", { currentPin: "0000", newPin: "6666" })).status, 403);
  assert.equal((await owner.post("/profile/pin", { newPin: "6666" })).status, 403);
  assert.equal((await owner.post("/profile/pin", { currentPin: "5555", newPin: "12" })).status, 400);
  assert.equal((await owner.post("/profile/pin", { currentPin: "5555", newPin: "6666" })).status, 200);

  await owner.post("/session/lock");
  assert.equal((await owner.post(`/profiles/${id}/unlock`, { pin: "5555" })).status, 401);
  assert.equal((await owner.post(`/profiles/${id}/unlock`, { pin: "6666" })).status, 200);
});

test("resetting a PIN needs the admin key and signs the profile out everywhere", async () => {
  const phone = await paired();
  const laptop = await paired();
  const id = await newProfile(phone, "Forgetful", "7777");
  await phone.post(`/profiles/${id}/unlock`, { pin: "7777" });
  await laptop.post(`/profiles/${id}/unlock`, { pin: "7777" });
  assert.equal((await laptop.get("/categories")).status, 200);

  const denied = await phone.post(`/profiles/${id}/reset-pin`, { adminKey: "nope", newPin: "8888" });
  assert.equal(denied.status, 403);
  assert.equal((await laptop.get("/categories")).status, 200);

  assert.equal((await phone.post(`/profiles/${id}/reset-pin`, { adminKey: ADMIN_KEY, newPin: "8888" })).status, 200);
  assert.equal((await phone.get("/categories")).data.code, "locked");
  assert.equal((await laptop.get("/categories")).data.code, "locked");
  assert.equal((await laptop.post(`/profiles/${id}/unlock`, { pin: "7777" })).status, 401);
  assert.equal((await laptop.post(`/profiles/${id}/unlock`, { pin: "8888" })).status, 200);
});

test("deleting a profile needs its PIN", async () => {
  const owner = await paired();
  const id = await newProfile(owner, "Temporary", "3141");
  await owner.post(`/profiles/${id}/unlock`, { pin: "3141" });
  assert.equal((await owner.del("/profile", { pin: "0000" })).status, 403);
  assert.equal((await owner.del("/profile", { pin: "3141" })).status, 200);
  const list = (await owner.get("/profiles")).data as unknown as { id: string }[];
  assert.ok(!Object.values(list).some((p) => p.id === id));
});

test("unpair-others keeps this device and removes the rest; unpair-this removes this one", async () => {
  const keeper = await paired();
  const lost = await paired();
  const id = await newProfile(keeper, "Devices", "2718");
  await keeper.post(`/profiles/${id}/unlock`, { pin: "2718" });
  await lost.post(`/profiles/${id}/unlock`, { pin: "2718" });
  assert.equal((await lost.get("/categories")).status, 200);

  // Needs an unlocked profile.
  const locked = await paired();
  assert.equal((await locked.del("/devices/others")).data.code, "locked");

  const res = await keeper.del("/devices/others");
  assert.equal(res.status, 200);
  assert.ok(res.data.removed >= 2);
  assert.equal((await lost.get("/categories")).data.code, "unpaired");
  assert.equal((await lost.get("/device")).data.paired, false);
  assert.equal((await keeper.get("/categories")).status, 200);

  assert.equal((await keeper.del("/device")).status, 200);
  assert.equal((await keeper.get("/device")).data.paired, false);
  assert.equal((await keeper.get("/profiles")).data.code, "unpaired");
});
