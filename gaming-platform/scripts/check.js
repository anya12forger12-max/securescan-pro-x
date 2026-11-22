import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const roots = ["packages", "services", "scripts"];
const files = [];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith(".js")) files.push(path);
  }
}

for (const root of roots) await walk(root);

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    failed++;
    console.error(`[check] syntax error in ${file}: ${err.stderr?.toString().trim() ?? err.message}`);
  }
}

console.log(`[check] ${files.length - failed}/${files.length} JavaScript files parse cleanly`);
if (failed > 0) process.exitCode = 1;
