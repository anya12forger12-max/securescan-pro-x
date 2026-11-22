import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Static validation for docker-compose.yml. Docker is not always available in
 * CI/build sandboxes, so this checks the invariants that most often break the
 * deployment: every mounted migration and every container command must point
 * at a real file, and published host ports must be unique.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const compose = await readFile(join(root, "docker-compose.yml"), "utf8");

const errors = [];
const exists = async (rel) => {
  try {
    await access(join(root, rel));
    return true;
  } catch {
    return false;
  }
};

// ./migrations/0001_init.sql:/docker-entrypoint-initdb.d/...
for (const match of compose.matchAll(/^\s+-\s+\.\/([\w./-]+):/gm)) {
  const source = match[1];
  if (!(await exists(source))) errors.push(`missing bind-mount source: ${source}`);
}

// command: node services/<name>/...
for (const match of compose.matchAll(/command:\s*node\s+(\S+)/g)) {
  const entry = match[1];
  if (!(await exists(entry))) errors.push(`missing command entrypoint: ${entry}`);
}

// "3000:3000" style published ports must not collide.
const ports = new Map();
for (const match of compose.matchAll(/-\s+"(\d+):(\d+)"/g)) {
  const host = match[1];
  if (ports.has(host)) errors.push(`duplicate host port ${host}`);
  ports.set(host, true);
}

const serviceBlock = compose.slice(
  compose.indexOf("\nservices:\n"),
  compose.search(/\n(volumes|networks|configs):\n/),
);
const services = [...serviceBlock.matchAll(/^  ([a-z][\w-]*):$/gm)].map((m) => m[1]);
if (!services.includes("postgres")) errors.push("missing postgres service");
if (!services.includes("gateway")) errors.push("missing gateway service");

if (errors.length) {
  for (const error of errors) console.error(`[compose] ${error}`);
  process.exit(1);
}
console.log(`[compose] ${services.length} services, ${ports.size} unique host ports, all paths valid`);
