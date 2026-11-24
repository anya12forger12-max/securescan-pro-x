import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Static validation for docker-compose.yml. Docker is not always available in
 * CI/build sandboxes, so this checks the invariants that most often break a
 * deployment: real paths, unique ports, a bounded database connection budget,
 * graceful shutdown hooks and a gateway-only public surface.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const compose = await readFile(join(root, "docker-compose.yml"), "utf8");
const dockerfile = await readFile(join(root, "Dockerfile"), "utf8");

const errors = [];
const exists = async (rel) => {
  try {
    await access(join(root, rel));
    return true;
  } catch {
    return false;
  }
};

for (const match of compose.matchAll(/^\s+-\s+\.\/([\w./-]+):/gm)) {
  const source = match[1];
  if (!(await exists(source))) errors.push(`missing bind-mount source: ${source}`);
}

// Accept both Compose shell form (`node path`) and exec form (`["node", "path"]`);
// skipping the latter made a missing entrypoint look like a valid deployment.
const commandEntry = (text) =>
  text.match(/command:\s*node\s+(\S+)/)?.[1]
  ?? text.match(/command:\s*\[\s*["']node["']\s*,\s*["']([^"']+)["']/)?.[1]
  ?? null;
for (const match of compose.matchAll(/command:.*/g)) {
  const entry = commandEntry(match[0]);
  if (entry && !(await exists(entry))) errors.push(`missing command entrypoint: ${entry}`);
}

// --- parse the services block into indented chunks ---
const lines = compose.split("\n");
const start = lines.indexOf("services:") + 1;
const blocks = new Map();
let current = null;
for (let i = start; i < lines.length; i += 1) {
  const line = lines[i];
  if (/^[A-Za-z]/.test(line)) break;
  const header = line.match(/^  ([a-z][\w-]*):\s*$/);
  if (header) {
    current = header[1];
    blocks.set(current, []);
  } else if (current) {
    blocks.get(current).push(line);
  }
}
const body = (name) => (blocks.get(name) ?? []).join("\n");

if (!blocks.has("postgres")) errors.push("missing postgres service");
if (!blocks.has("gateway")) errors.push("missing gateway service");

// --- published ports: unique, and only the gateway is public ---
const published = [];
for (const [name, serviceLines] of blocks) {
  let inPorts = false;
  for (const line of serviceLines) {
    if (/^\s{4}(ports|expose):\s*$/.test(line)) {
      inPorts = line.trim() === "ports:";
      continue;
    }
    if (!inPorts) continue;
    const mapping = line.match(/^\s+-\s+"([^"]+)"\s*$/);
    if (!mapping) continue;
    const spec = mapping[1];
    published.push({ name, spec, loopback: spec.includes(":") && /^\d+\.\d+\.\d+\.\d+:/.test(spec) });
  }
}
const hosts = new Map();
for (const { name, spec } of published) {
  const hostPort = spec.split(":").at(-2);
  if (hosts.has(hostPort)) errors.push(`duplicate host port ${hostPort} (${hosts.get(hostPort)} and ${name})`);
  hosts.set(hostPort, name);
}
for (const { name, spec, loopback } of published) {
  if (!loopback && name !== "gateway") {
    errors.push(`${name} publishes ${spec} on all interfaces; only gateway may be public`);
  }
}
// Postgres and Redis used to publish loopback ports for local administration;
// the data tier is now internal-only, leaving one deliberate public surface.
if (
  published.length !== 1 ||
  published[0].name !== "gateway" ||
  published[0].spec !== "127.0.0.1:3000:3000"
) {
  errors.push(
    `expected only gateway 127.0.0.1:3000:3000 to be published, got ` +
      (published.map(({ name, spec }) => `${name}:${spec}`).join(", ") || "none"),
  );
}
for (const name of ["postgres", "redis"]) {
  if (/\bports:/.test(body(name))) errors.push(`${name} must not publish a host port`);
}

// --- data isolation, Redis auth and container hardening ---
if (!/^\s{2}internal:\s*\n\s{4}internal:\s*true/m.test(compose)) {
  errors.push("internal data network must be non-routable (internal: true)");
}
if (!/--requirepass/.test(compose) || !/REDISCLI_AUTH:/.test(compose)) {
  errors.push("Redis must require a password and authenticate its healthcheck");
}
// Compose only checks that REDIS_URL is non-empty. An old .env with an
// anonymous URL passes that check but fails against password-protected Redis,
// which makes a fail-closed gateway reject every player request.
let deployEnv = "";
try {
  deployEnv = await readFile(join(root, ".env"), "utf8");
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}
if (deployEnv) {
  const values = {};
  for (const line of deployEnv.split("\n")) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && !(match[1] in values)) values[match[1]] = match[2];
  }
  if (values.REDIS_URL) {
    try {
      const url = new URL(values.REDIS_URL);
      if (url.protocol !== "redis:" || !url.password) {
        errors.push("REDIS_URL must embed the Redis password (redis://:<password>@redis:6379)");
      } else if (values.REDIS_PASSWORD && decodeURIComponent(url.password) !== values.REDIS_PASSWORD) {
        errors.push("REDIS_URL password does not match REDIS_PASSWORD");
      }
    } catch {
      errors.push("REDIS_URL is not a valid URL");
    }
  }
  // `env:init --force` used to keep an old DATABASE_URL while generating a new
  // POSTGRES_PASSWORD, so every service tried to authenticate with credentials
  // the Postgres container had never seen. Catch that mismatch statically.
  if (values.DATABASE_URL) {
    try {
      const url = new URL(values.DATABASE_URL);
      if (url.protocol !== "postgresql:") {
        errors.push("DATABASE_URL must use the postgresql: scheme");
      } else {
        const pairs = [
          ["POSTGRES_USER", decodeURIComponent(url.username)],
          ["POSTGRES_PASSWORD", decodeURIComponent(url.password)],
          ["POSTGRES_DB", decodeURIComponent(url.pathname.slice(1))],
        ];
        for (const [name, fromUrl] of pairs) {
          if (values[name] && values[name] !== fromUrl) {
            errors.push(`${name} does not match DATABASE_URL (${fromUrl})`);
          }
        }
      }
    } catch {
      errors.push("DATABASE_URL is not a valid URL");
    }
  }
}
const appAnchor = compose.match(/x-app: &app[\s\S]*?(?=\nservices:)/)?.[0] ?? "";
for (const [label, pattern] of [
  ["no-new-privileges", /no-new-privileges:true/],
  ["cap_drop ALL", /cap_drop:\s*\n\s+- ALL/],
  ["pids_limit", /pids_limit:/],
  ["read_only root filesystem", /read_only:\s*true/],
  ["tmpfs scratch space", /tmpfs:/],
]) {
  if (!pattern.test(appAnchor)) errors.push(`app services must set ${label}`);
}
if (!/^\s{4}user:\s*"999:1000"/m.test(body("redis"))) {
  errors.push("Redis must run as the non-root redis user");
}

// --- database connection budget ---
const poolMax = Number(compose.match(/DB_POOL_MAX:\s*\$\{DB_POOL_MAX:-(\d+)\}/)?.[1] ?? 0);
const pgMax = Number(compose.match(/max_connections=(\d+)/)?.[1] ?? 0);
const appServices = [...blocks.keys()]
  .map((name) => [name, body(name)])
  .filter(([, text]) => /command:\s*(?:node services\/|\[\s*["']node["']\s*,\s*["']services\/)/.test(text));
const dbServices = appServices.filter(([name]) => name !== "gateway" && name !== "migrate");
if (!poolMax) errors.push("DB_POOL_MAX default is missing");
if (!pgMax) errors.push("postgres max_connections is not configured");
if (poolMax && pgMax) {
  // One LISTEN connection in realtime plus headroom for the migrator.
  const required = dbServices.length * poolMax + 2;
  if (required > pgMax) {
    errors.push(`connection budget ${required} exceeds postgres max_connections=${pgMax}`);
  }
}

// --- lifecycle ---
if (!/stop_grace_period:/.test(compose)) errors.push("stop_grace_period is required for graceful shutdown");
if (!/\/ready/.test(compose.match(/healthcheck:\s*&app-health[\s\S]*?start_period:/)?.[0] ?? "")) {
  errors.push("app healthcheck must probe /ready, not /health");
}
// The gateway is the exception: /ready fans out to every peer, so using it as
// the container liveness probe would restart the edge when one game is slow.
if (!/127\.0\.0\.1:3000\/health/.test(body("gateway"))) {
  errors.push("gateway healthcheck must probe its own /health, not aggregate /ready");
}
for (const [name, text] of appServices) {
  const entry = commandEntry(text);
  if (!entry || !(await exists(entry))) continue;
  const source = await readFile(join(root, entry), "utf8");
  if (!/SIGTERM/.test(source)) errors.push(`${name} has no SIGTERM shutdown handler`);
}

// --- browser client: the gateway builds and serves it from one image ---
if (!/COPY frontend\/package\.json frontend\/package-lock\.json/.test(dockerfile)) {
  errors.push("Dockerfile must install the frontend from its own lockfile");
}
if (!/npm --prefix frontend ci/.test(dockerfile)) {
  errors.push("Dockerfile must run the frontend dependency install");
}
if (!/npm --prefix frontend run build/.test(dockerfile)) {
  errors.push("Dockerfile must build the frontend");
}
if (!/COPY --from=build \/app\/frontend\/build/.test(dockerfile)) {
  errors.push("runtime image must contain the compiled frontend");
}
if (!(await exists("frontend/src/index.tsx"))) {
  errors.push("frontend/src/index.tsx is missing");
}
if (!(await exists("frontend/src/app.tsx"))) {
  errors.push("frontend/src/app.tsx is missing");
}

if (errors.length) {
  for (const error of errors) console.error(`[compose] ${error}`);
  process.exit(1);
}
console.log(
  `[compose] ${blocks.size} services, ${hosts.size} published ports, ` +
    `${dbServices.length} DB clients x ${poolMax} <= ${pgMax} connections, all paths valid`,
);
