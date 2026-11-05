import { randomUUID } from "node:crypto";
import { HTTPError, hash, secret, json, rateLimit } from "./security.mjs";
import { ownDevice, requireOwner } from "./device-access.mjs";
function status(row, now, member) {
  return member
    ? "approved"
    : row.status === "approved"
      ? "revoked"
      : row.expires_ms <= now
        ? "expired"
        : row.status;
}
export async function sharingRoutes({
  db,
  s,
  url,
  path,
  post,
  body,
  now,
  env,
}) {
  if (!path.startsWith("/admin/share/")) return null;
  if (path === "/admin/share/request" && post) {
    if (typeof body.code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.code))
      throw new HTTPError(400, "Invalid sharing code");
    const invite = await db
      .prepare(
        "SELECT i.*,d.label,d.household_id owner FROM tv_invitations i JOIN devices d ON d.id=i.device_id WHERE i.code_hash=?",
      )
      .bind(hash(body.code))
      .first();
    if (!invite || invite.expires_ms <= now)
      throw new HTTPError(410, "Sharing code expired");
    const existingMember = await db
      .prepare("SELECT 1 FROM tv_access WHERE device_id=? AND household_id=?")
      .bind(invite.device_id, s.household_id)
      .first();
    if (invite.owner === s.household_id || existingMember)
      return json({
        request_id: invite.id,
        status: "approved",
        device: invite.device_id,
        label: invite.label,
      });
    const changed = await db
      .prepare(
        "UPDATE tv_invitations SET requester_id=?,status='pending' WHERE id=? AND expires_ms>? AND (status='open' OR (status='pending' AND requester_id=?)) RETURNING id",
      )
      .bind(s.household_id, invite.id, now, s.household_id)
      .first();
    if (!changed) throw new HTTPError(410, "Sharing code already used");
    return json({
      request_id: invite.id,
      status: "pending",
      device: invite.device_id,
      label: invite.label,
    });
  }
  if (path === "/admin/share/status" && !post) {
    const row = await db
      .prepare(
        "SELECT i.*,d.label FROM tv_invitations i JOIN devices d ON d.id=i.device_id WHERE i.id=? AND i.requester_id=?",
      )
      .bind(url.searchParams.get("request"), s.household_id)
      .first();
    if (!row) throw new HTTPError(404, "Request not found");
    const member = await db
      .prepare("SELECT 1 FROM tv_access WHERE device_id=? AND household_id=?")
      .bind(row.device_id, s.household_id)
      .first();
    return json({
      request_id: row.id,
      status: status(row, now, member),
      device: row.device_id,
      label: row.label,
    });
  }
  const device = await ownDevice(db, s, url);
  requireOwner(device, s);
  if (path === "/admin/share/create" && post) {
    await rateLimit(db, "share:" + s.household_id, 10, 600000, now);
    const code = secret(),
      id = randomUUID(),
      expires = now + 600000;
    await db.batch([
      db
        .prepare(
          "UPDATE tv_invitations SET expires_ms=MIN(expires_ms,?) WHERE device_id=? AND status='open'",
        )
        .bind(now, device.id),
      db
        .prepare("INSERT INTO tv_invitations VALUES(?,?,?,?,NULL,'open',?)")
        .bind(id, device.id, hash(code), expires, now),
    ]);
    return json({
      code,
      request_id: id,
      expires_ms: expires,
      endpoint: env.PUBLIC_ORIGIN,
      device: device.id,
      label: device.label,
    });
  }
  if (path === "/admin/share/requests" && !post) {
    const pending = await db
      .prepare(
        "SELECT i.id request_id,h.username FROM tv_invitations i JOIN households h ON h.id=i.requester_id WHERE i.device_id=? AND i.status='pending' AND i.expires_ms>? ORDER BY i.created_ms",
      )
      .bind(device.id, now)
      .all();
    const members = await db
      .prepare(
        "SELECT a.household_id,h.username FROM tv_access a JOIN households h ON h.id=a.household_id WHERE a.device_id=?",
      )
      .bind(device.id)
      .all();
    return json({ requests: pending.results, members: members.results });
  }
  if (["/admin/share/approve", "/admin/share/reject"].includes(path) && post) {
    if (typeof body.request_id !== "string")
      throw new HTTPError(400, "Request ID required");
    const row = await db
      .prepare(
        "SELECT * FROM tv_invitations WHERE id=? AND device_id=? AND status='pending' AND expires_ms>?",
      )
      .bind(body.request_id, device.id, now)
      .first();
    if (!row) throw new HTTPError(409, "Request expired or already handled");
    const approve = path.endsWith("/approve"),
      statements = [];
    if (approve)
      statements.push(
        db
          .prepare(
            "INSERT INTO tv_access SELECT device_id,requester_id,? FROM tv_invitations WHERE id=? AND device_id=? AND status='pending' AND expires_ms>? AND ((SELECT COUNT(*) FROM tv_access WHERE device_id=tv_invitations.device_id)<2 OR EXISTS(SELECT 1 FROM tv_access WHERE device_id=tv_invitations.device_id AND household_id=tv_invitations.requester_id)) ON CONFLICT(device_id,household_id) DO NOTHING",
          )
          .bind(now, row.id, device.id, now),
      );
    const membershipGuard = approve
      ? " AND EXISTS(SELECT 1 FROM tv_access WHERE device_id=tv_invitations.device_id AND household_id=tv_invitations.requester_id)"
      : "";
    statements.push(
      db
        .prepare(
          "UPDATE tv_invitations SET status=? WHERE id=? AND device_id=? AND status='pending' AND expires_ms>?" +
            membershipGuard,
        )
        .bind(approve ? "approved" : "rejected", row.id, device.id, now),
    );
    const result = await db.batch(statements);
    if (!result.at(-1).meta.changes)
      throw new HTTPError(
        409,
        "Request expired, already handled, or TV already has 3 parent accounts",
      );
    return json({ success: true });
  }
  if (path === "/admin/share/revoke" && post) {
    if (typeof body.household_id !== "string")
      throw new HTTPError(400, "Household required");
    await db.batch([
      db
        .prepare("DELETE FROM tv_access WHERE device_id=? AND household_id=?")
        .bind(device.id, body.household_id),
      db
        .prepare(
          "DELETE FROM lan_pairings WHERE device_id=? AND household_id=?",
        )
        .bind(device.id, body.household_id),
    ]);
    return json({ success: true });
  }
  throw new HTTPError(404, "Not found");
}
