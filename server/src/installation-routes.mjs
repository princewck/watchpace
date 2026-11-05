import { requireOwner, accessWhere } from "./device-access.mjs";
import { randomUUID, randomBytes } from "node:crypto";
import { HTTPError, secret, hash, json } from "./security.mjs";
import { healthFor, ownDevice } from "./context.mjs";
export async function installationRoutes({
  db,
  s,
  url,
  path,
  now,
  post,
  body,
  env,
}) {
  if (path === "/admin/devices" && !post) {
    const value = await db
      .prepare(
        "SELECT d.*,h.username household_name FROM devices d JOIN households h ON h.id=d.household_id WHERE " +
          accessWhere +
          " ORDER BY d.created_ms,d.id",
      )
      .bind(s.household_id, s.household_id)
      .all();
    return json({
      devices: value.results.map((d) => ({
        device_name: d.id,
        household_id: d.household_id,
        household_name: d.household_name,
        is_owner: d.household_id === s.household_id,
        label: d.label,
        enabled: d.enabled,
        last_heartbeat_ms: d.last_heartbeat_ms,
        installation_complete: healthFor(d, d.last_heartbeat_ms ?? now)
          .complete,
      })),
      server_now_ms: now,
    });
  }
  if (path === "/admin/installation_restart" && post) {
    const d = await ownDevice(db, s, url),
      code = randomBytes(8).toString("hex").toUpperCase(),
      expires = now + 15 * 60000;
    requireOwner(d, s);
    await db.batch([
      db
        .prepare("DELETE FROM installation_tickets WHERE device_id=?")
        .bind(d.id),
      db.prepare("DELETE FROM lan_pairings WHERE device_id=?").bind(d.id),
      db.prepare("DELETE FROM lan_identities WHERE device_id=?").bind(d.id),
      db
        .prepare("DELETE FROM operations WHERE household_id=? AND device_id=?")
        .bind(s.household_id, d.id),
      db
        .prepare(
          `UPDATE devices SET token_hash=?,enabled=1,last_heartbeat_ms=NULL,revision=revision+1,applied_revision=0,enforcement_result=NULL,applied_ms=NULL,boot_count=NULL,initial_boot=NULL,closed_at_boot=NULL,adb_enabled=NULL,permissions_ok=NULL,stopped_ms=NULL,resumed_ms=NULL WHERE id=? AND household_id=?`,
        )
        .bind(hash(secret()), d.id, s.household_id),
      db
        .prepare("INSERT INTO installation_tickets VALUES(?,?,?,NULL,NULL)")
        .bind(hash(code), d.id, expires),
    ]);
    return json(
      {
        code,
        device: d.id,
        label: d.label,
        origin: env.PUBLIC_ORIGIN,
        expires_ms: expires,
      },
      201,
    );
  }
  if (path === "/admin/device_remove" && post) {
    const d = await ownDevice(db, s, url);
    if (d.household_id !== s.household_id) {
      await db.batch([
        db
          .prepare("DELETE FROM tv_access WHERE device_id=? AND household_id=?")
          .bind(d.id, s.household_id),
        db
          .prepare(
            "DELETE FROM lan_pairings WHERE device_id=? AND household_id=?",
          )
          .bind(d.id, s.household_id),
      ]);
      return json({ success: true });
    }
    await db.batch([
      db
        .prepare("DELETE FROM operations WHERE household_id=? AND device_id=?")
        .bind(s.household_id, d.id),
      db
        .prepare("DELETE FROM devices WHERE id=? AND household_id=?")
        .bind(d.id, s.household_id),
    ]);
    return json({ success: true });
  }
  if (path === "/admin/installation_ticket" && post) {
    const label = body.label;
    if (typeof label !== "string" || !label.trim() || label.length > 64)
      throw new HTTPError(400, "Device name required");
    const requested = body.device;
    if (
      requested !== undefined &&
      (typeof requested !== "string" ||
        !(await db
          .prepare("SELECT 1 FROM devices WHERE id=? AND household_id=?")
          .bind(requested, s.household_id)
          .first()))
    )
      throw new HTTPError(404, "Device not found");
    const id = requested || "tv_" + randomUUID().replaceAll("-", ""),
      code = randomBytes(8).toString("hex").toUpperCase(),
      expires = now + 15 * 60000;
    if (
      requested &&
      (await db
        .prepare(
          "SELECT 1 FROM installation_tickets WHERE device_id=? AND redeemed_ms IS NOT NULL",
        )
        .bind(id)
        .first())
    )
      throw new HTTPError(
        409,
        "Installation code already redeemed; continue health checks",
      );
    const result = await db.batch([
      ...(requested
        ? []
        : [
            db
              .prepare(
                `INSERT INTO devices(id,household_id,label,token_hash,created_ms) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM devices WHERE household_id=?)<10`,
              )
              .bind(
                id,
                s.household_id,
                label.trim(),
                hash(secret()),
                now,
                s.household_id,
              ),
          ]),
      db
        .prepare(
          "DELETE FROM installation_tickets WHERE device_id=? AND redeemed_ms IS NULL",
        )
        .bind(id),
      db
        .prepare(
          `INSERT INTO installation_tickets SELECT ?,?,?,NULL,NULL WHERE EXISTS(SELECT 1 FROM devices WHERE id=?) AND NOT EXISTS(SELECT 1 FROM installation_tickets WHERE device_id=? AND redeemed_ms IS NOT NULL)`,
        )
        .bind(hash(code), id, expires, id, id),
    ]);
    if (!result.at(-1).meta.changes)
      throw new HTTPError(
        409,
        requested ? "Installation already redeemed" : "Maximum 10 devices",
      );
    return json(
      {
        code,
        device: id,
        label: label.trim(),
        origin: env.PUBLIC_ORIGIN,
        expires_ms: expires,
      },
      201,
    );
  }

  return null;
}
