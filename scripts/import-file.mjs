import { readFileSync } from "node:fs";

const csv = readFileSync(process.argv[2], "utf8");
const fileName = process.argv[3] || "test.csv";
const includeSoft = process.argv[4] === "soft";
const key = (process.env.KEY ?? "").trim();
const port = process.env.PORT || 8787;

const res = await fetch(`http://127.0.0.1:${port}/api/v1/imports`, {
  method: "POST",
  headers: {
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ fileName, csvText: csv, includeSoft }),
});
const body = await res.json();
console.log(res.status, JSON.stringify(body, null, 2));
