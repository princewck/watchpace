// Consistent WAL-aware backup. Copying only the live .sqlite file is unsafe.
import { backup } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SQLiteD1 } from "./database.mjs";
const target = process.argv[2];
if (!target)
  throw Error(
    "Usage: node node-runtime/backup.mjs /private/path/backup.sqlite",
  );
const source = resolve(process.env.SQLITE_PATH || "runtime/familytv.sqlite");
if (resolve(target) === source) throw Error("Backup must be a different file");
mkdirSync(dirname(resolve(target)), { recursive: true, mode: 0o700 });
const db = new SQLiteD1(source);
await backup(db.db, target);
chmodSync(target, 0o600);
db.close();
console.log("SQLite backup complete");
