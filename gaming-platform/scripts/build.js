import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Build (or type-check) the TypeScript sources of the seven recovered
 * services. Each service owns a tsconfig.json that maps src/ to dist/, so
 * the runtime layout consumed by start-all.js and Docker stays unchanged.
 */
const services = [
  "chat",
  "codenames",
  "game-engine",
  "gin-rummy",
  "leaderboard",
  "pictionary",
  "promotions",
];

const root = fileURLToPath(new URL("..", import.meta.url));
const tsc = join(root, "node_modules", ".bin", "tsc");
const checkOnly = process.argv.includes("--check");

for (const name of services) {
  console.log(`[build] ${name}${checkOnly ? " (type-check only)" : ""}`);
  const args = ["-p", join("services", name, "tsconfig.json")];
  if (checkOnly) args.push("--noEmit");
  execFileSync(tsc, args, { cwd: root, stdio: "inherit" });
}

console.log(`[build] ${checkOnly ? "checked" : "built"} ${services.length} TypeScript services`);
