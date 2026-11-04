import { randomUUID } from "node:crypto";
import { secret, hash, HTTPError } from "./security.mjs";
export const APPS = new Set([
  "com.ktcp.video",
  "com.xiaodianshi.tv.yst",
  "com.newtv.cboxtv",
  "com.google.android.youtube.tv",
  "com.fongmi.android.tv",
  "com.gitvdemo.video",
  "com.hunantv.license",
]);
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const sessionTTL = 30 * 86400000;
export const identity = (s) => ({
  username: s.username,
  role: "user",
  tenant_id: s.household_id,
});
export function healthFor(d, now) {
  const fresh =
    d.last_heartbeat_ms !== null &&
    now - d.last_heartbeat_ms >= -5000 &&
    now - d.last_heartbeat_ms < 45000;
  const checks = {
    connected: fresh && d.enabled === 1,
    playback_test: d.stopped_ms !== null && d.resumed_ms > d.stopped_ms,
    permissions: fresh && d.permissions_ok === 1,
    adb_closed: fresh && d.adb_enabled === 0,
    rebooted:
      fresh && d.closed_at_boot !== null && d.boot_count > d.closed_at_boot,
  };
  return {
    device: d.id,
    checks,
    complete: Object.values(checks).every(Boolean),
    updated_ms: d.last_heartbeat_ms,
  };
}
export { ownDevice } from "./device-access.mjs";
export async function newSession(db, household, username, now) {
  const token = secret(),
    csrf = secret(),
    expires = now + sessionTTL;
  await db
    .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
    .bind(hash(token), household, csrf, expires)
    .run();
  return {
    token,
    value: {
      csrf,
      identity: { username, role: "user", tenant_id: household },
      expires_ms: expires,
    },
  };
}
export async function operation(db, s, device, kind, payload, requestID, now) {
  if (!UUID.test(requestID || ""))
    throw new HTTPError(400, "Request ID required");
  const body = JSON.stringify(payload),
    digest = hash(body);
  const result = await db
    .prepare(
      "INSERT INTO operations VALUES(?,?,?,?,?,?,?) ON CONFLICT(household_id,request_id) DO NOTHING",
    )
    .bind(device.household_id, requestID, kind, device.id, digest, body, now)
    .run();
  const existing = await db
    .prepare(
      "SELECT kind,device_id,body_hash FROM operations WHERE household_id=? AND request_id=?",
    )
    .bind(device.household_id, requestID)
    .first();
  if (
    existing.kind !== kind ||
    existing.device_id !== device.id ||
    existing.body_hash !== digest
  )
    throw new HTTPError(409, "Request ID reused");
  return {
    duplicate: result.meta.changes === 0,
    device: await db
      .prepare("SELECT * FROM devices WHERE id=?")
      .bind(device.id)
      .first(),
  };
}
