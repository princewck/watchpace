// Local operator only; no public endpoint can create this grant.
import { parseArgs } from "node:util";
import { SQLiteD1 } from "./database.mjs";
const { values } = parseArgs({
  options: {
    username: { type: "string" },
    revoke: { type: "boolean", default: false },
    days: { type: "string" },
    reason: { type: "string", default: "Operator history access" },
  },
});
if (!values.username || !/^[a-z0-9_]{3,32}$/.test(values.username))
  throw Error("Pass --username for an existing household");
if (
  values.days &&
  (!/^\d+$/.test(values.days) ||
    Number(values.days) < 1 ||
    Number(values.days) > 3650)
)
  throw Error("--days must be 1..3650; omit for access until revoked");
if (values.reason.length > 200) throw Error("Reason is too long");
if (!process.env.SQLITE_PATH)
  throw Error("Set SQLITE_PATH to the service database");
const db = new SQLiteD1(process.env.SQLITE_PATH),
  now = Date.now();
try {
  const family = db.db
    .prepare("SELECT id FROM households WHERE username=?")
    .get(values.username);
  if (!family) throw Error("Household not found; no account was created");
  if (values.revoke)
    db.db
      .prepare("UPDATE operator_access SET revoked_ms=? WHERE household_id=?")
      .run(now, family.id);
  else
    db.db
      .prepare(
        "INSERT INTO operator_access VALUES(?,?,?,NULL,?) ON CONFLICT(household_id) DO UPDATE SET granted_ms=excluded.granted_ms,expires_ms=excluded.expires_ms,revoked_ms=NULL,reason=excluded.reason",
      )
      .run(
        family.id,
        now,
        values.days ? now + Number(values.days) * 86400000 : null,
        values.reason,
      );
  console.log(
    JSON.stringify({
      username: values.username,
      history_access: !values.revoke,
      apple_subscription_modified: false,
    }),
  );
} finally {
  db.close();
}
