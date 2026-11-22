import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const services = [
  "gateway",
  "auth",
  "admin-risk",
  "realtime",
  "wallet",
  "responsible-gaming",
  "tournaments",
  "chat",
  "codenames",
  "game-engine",
  "gin-rummy",
  "leaderboard",
  "pictionary",
  "promotions",
  "crash",
];

const ports = {
  gateway: 3000,
  auth: 3015,
  "admin-risk": 3013,
  realtime: 3010,
  wallet: 3011,
  "responsible-gaming": 3012,
  tournaments: 3014,
  chat: 3016,
  codenames: 3017,
  "game-engine": 3018,
  "gin-rummy": 3019,
  leaderboard: 3020,
  pictionary: 3021,
  promotions: 3022,
  crash: 3023,
};

// Recovered services still run from dist/; services added during the rebuild
// keep their JS source at the package root.
const rootEntryServices = new Set([
  "gateway",
  "auth",
  "admin-risk",
  "realtime",
  "wallet",
  "responsible-gaming",
  "tournaments",
  "crash",
]);

const root = fileURLToPath(new URL("..", import.meta.url));
const children = [];

for (const name of services) {
  const entry = rootEntryServices.has(name) ? "index.js" : "dist/index.js";
  // Pin PORT per service so an ambient PORT from .env cannot make every
  // process fight over the same socket.
  const child = spawn(process.execPath, [join("services", name, entry)], {
    cwd: root,
    stdio: "inherit",
    // Local development binds every peer to loopback. The Compose network
    // leaves HOST unset, so containers still listen on all interfaces.
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(ports[name]) },
  });
  children.push({ name, child });
}

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) child.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

for (const { name, child } of children) {
  child.on("exit", (code) => {
    if (!stopping && code !== 0) {
      console.error(`[start-all] ${name} exited with ${code}; shutting down`);
      stop();
    }
  });
}
