import { readFile, readdir } from "node:fs/promises";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is required");
  process.exit(1);
}

const migrationsDir = new URL("../migrations/", import.meta.url);
let files;
if (process.argv[2]) {
  files = [process.argv[2]];
} else {
  const all = await readdir(migrationsDir);
  files = all.filter((name) => name.endsWith(".sql")).sort();
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  // Serialise concurrent `docker compose up` / rolling deploys. Without the
  // advisory lock two migrators can both see a file as unapplied and race to
  // execute the same DDL.
  await client.query("SELECT pg_advisory_lock(hashtext('gaming-platform:migrations'))");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  for (const file of files) {
    const already = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
    if (already.rowCount) {
      console.log(`[migrate] skipping ${file} (already applied)`);
      continue;
    }

    const sql = await readFile(new URL(file, migrationsDir), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`${file}: ${err.message}`);
    }
  }
} catch (err) {
  console.error("[migrate] failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('gaming-platform:migrations'))").catch(() => undefined);
  client.release();
  await pool.end();
}
