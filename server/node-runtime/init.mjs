// Run once or on upgrades. Never overwrite an existing database.
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SQLiteD1 } from "./database.mjs";
const path = resolve(process.env.SQLITE_PATH || "runtime/familytv.sqlite");
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const db = new SQLiteD1(path);
db.db.exec(
  "CREATE TABLE IF NOT EXISTS familytv_migrations(name TEXT PRIMARY KEY) STRICT",
);
for (const name of readdirSync(new URL("../migrations/", import.meta.url))
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  if (db.db.prepare("SELECT 1 FROM familytv_migrations WHERE name=?").get(name))
    continue;
  db.db.exec("BEGIN IMMEDIATE");
  try {
    db.db.exec(
      readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
    db.db.prepare("INSERT INTO familytv_migrations VALUES(?)").run(name);
    db.db.exec("COMMIT");
  } catch (error) {
    db.db.exec("ROLLBACK");
    throw error;
  }
}
console.log("SQLite initialized; existing data preserved");
db.close();
