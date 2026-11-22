import { randomBytes } from "node:crypto";

const baseUrl = (process.env.GATEWAY_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const results = [];

async function request(label, path, options = {}) {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers ?? {}) },
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    results.push({ label, ok: res.ok, status: res.status, body });
    return body;
  } catch (err) {
    results.push({ label, ok: false, status: 0, body: { message: err.message } });
    return null;
  }
}

await request("gateway liveness", "/health");
await request("all downstream services ready", "/ready");

const suffix = randomBytes(6).toString("hex");
const username = `smoke_${suffix}`;
const email = `${username}@example.invalid`;
const password = `Smoke-${suffix}-${randomBytes(8).toString("hex")}`;

await request("auth register", "/v1/auth/register", {
  method: "POST",
  body: JSON.stringify({ username, email, password }),
});
const loggedIn = await request("auth login", "/v1/auth/login", {
  method: "POST",
  body: JSON.stringify({ identifier: username, password }),
});
const token = loggedIn?.data?.token;

if (token) {
  await request("auth me", "/v1/auth/me", {
    headers: { authorization: `Bearer ${token}` },
  });
} else {
  results.push({ label: "auth me", ok: false, status: 0, body: { message: "no token from login" } });
}

for (const result of results) {
  const line = result.ok ? "PASS" : "FAIL";
  console.log(`[smoke] ${line} ${result.label} (${result.status})`);
  if (!result.ok) console.error(`        ${JSON.stringify(result.body)}`);
}

const failed = results.filter((result) => !result.ok).length;
console.log(`[smoke] ${results.length - failed}/${results.length} checks passed`);
if (failed) process.exitCode = 1;
