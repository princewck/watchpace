import { createPublicKey, verify } from "node:crypto";
import { HTTPError, hash } from "./security.mjs";
import { validatePolicy, stateFor } from "./policy.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
export const signingText = (e) =>
  [
    "FamilyTV-LAN/1",
    e.device,
    e.key_id,
    e.request_id,
    String(e.issued_ms),
    String(e.base_revision),
    e.payload,
  ].join("\n");
export function publicKey(der) {
  if (typeof der !== "string" || der.length > 180 || !B64.test(der))
    throw new HTTPError(400, "Invalid parent key");
  let key;
  try {
    key = createPublicKey({
      key: Buffer.from(der, "base64"),
      type: "spki",
      format: "der",
    });
  } catch {
    throw new HTTPError(400, "Invalid parent key");
  }
  if (
    key.asymmetricKeyType !== "ec" ||
    key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  )
    throw new HTTPError(400, "P-256 required");
  return key;
}
export function decodeCommand(e, der, device, now, maxAge = 120000) {
  if (
    !e ||
    e.v !== 1 ||
    e.device !== device ||
    !UUID.test(e.key_id || "") ||
    !UUID.test(e.request_id || "") ||
    !Number.isSafeInteger(e.issued_ms) ||
    e.issued_ms > now + 30000 ||
    e.issued_ms < now - maxAge ||
    !Number.isSafeInteger(e.base_revision) ||
    e.base_revision < 1 ||
    typeof e.payload !== "string" ||
    e.payload.length > 20000 ||
    !B64.test(e.payload) ||
    typeof e.signature !== "string" ||
    e.signature.length > 120 ||
    !B64.test(e.signature)
  )
    throw new HTTPError(400, "Invalid or expired local command");
  if (
    !verify(
      "sha256",
      Buffer.from(signingText(e)),
      publicKey(der),
      Buffer.from(e.signature, "base64"),
    )
  )
    throw new HTTPError(403, "Invalid local signature");
  let body;
  try {
    body = JSON.parse(Buffer.from(e.payload, "base64").toString("utf8"));
  } catch {
    throw new HTTPError(400, "Invalid local payload");
  }
  if (body?.kind === "pause" && typeof body.paused === "boolean")
    return { kind: "pause", payload: { paused: Number(body.paused) } };
  if (
    body?.kind === "grant" &&
    Number.isInteger(body.seconds) &&
    body.seconds >= 60 &&
    body.seconds <= 7200
  )
    return { kind: "grant", payload: { seconds: body.seconds } };
  if (body?.kind === "policy" && body.policy && typeof body.policy === "object")
    return { kind: "policy", payload: { policy: validatePolicy(body.policy) } };
  throw new HTTPError(400, "Unsupported local command");
}
export async function registerLanIdentity(db, device, body, now) {
  if (body.lan_version !== 1) return;
  const pin = body.lan_certificate_sha256;
  if (typeof pin !== "string" || !/^[0-9a-f]{64}$/.test(pin))
    throw new HTTPError(400, "Invalid LAN certificate");
  const previous = await db
    .prepare("SELECT certificate_sha256 FROM lan_identities WHERE device_id=?")
    .bind(device.id)
    .first();
  if (previous?.certificate_sha256 === pin) return;
  await db.batch([
    db
      .prepare(
        "DELETE FROM lan_pairings WHERE device_id=? AND EXISTS(SELECT 1 FROM lan_identities WHERE device_id=? AND certificate_sha256<>?)",
      )
      .bind(device.id, device.id, pin),
    db
      .prepare(
        "INSERT INTO lan_identities VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET certificate_sha256=excluded.certificate_sha256,updated_ms=excluded.updated_ms",
      )
      .bind(device.id, pin, now),
  ]);
}
export async function pairLan(db, household, device, body, now) {
  publicKey(body.public_key_der);
  if (!UUID.test(body.key_id || ""))
    throw new HTTPError(400, "Key ID required");
  const identity = await db
    .prepare("SELECT * FROM lan_identities WHERE device_id=?")
    .bind(device.id)
    .first();
  if (
    !identity ||
    device.last_heartbeat_ms === null ||
    now - device.last_heartbeat_ms > 45000
  )
    throw new HTTPError(409, "TV must be online with LAN support");
  const existing = await db
    .prepare("SELECT * FROM lan_pairings WHERE id=?")
    .bind(body.key_id)
    .first();
  if (
    existing &&
    (existing.household_id !== household ||
      existing.device_id !== device.id ||
      existing.public_key_der !== body.public_key_der)
  )
    throw new HTTPError(409, "Pairing key already bound");
  const count = await db
    .prepare(
      "SELECT COUNT(*) n FROM lan_pairings WHERE device_id=? AND expires_ms>?",
    )
    .bind(device.id, now)
    .first();
  if (!existing && count.n >= 5)
    throw new HTTPError(409, "Maximum five local controllers");
  const expires = now + 30 * 86400000;
  await db
    .prepare(
      "INSERT INTO lan_pairings VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET expires_ms=excluded.expires_ms",
    )
    .bind(body.key_id, household, device.id, body.public_key_der, now, expires)
    .run();
  return {
    device: device.id,
    key_id: body.key_id,
    expires_ms: expires,
    certificate_sha256: identity.certificate_sha256,
    service_type: "_familytv._tcp",
    protocol_version: 1,
  };
}
export async function lanKeys(db, device, now) {
  return (
    await db
      .prepare(
        "SELECT id key_id,public_key_der,expires_ms FROM lan_pairings WHERE device_id=? AND expires_ms>? ORDER BY created_ms LIMIT 5",
      )
      .bind(device, now)
      .all()
  ).results;
}
export async function syncLan(db, household, device, envelopes, now) {
  if (!Array.isArray(envelopes) || envelopes.length > 16)
    throw new HTTPError(400, "Maximum sixteen local commands");
  const results = [];
  let expected = null,
    chainBase = null;
  for (const e of envelopes) {
    try {
      const pairing = await db
        .prepare(
          "SELECT * FROM lan_pairings WHERE id=? AND household_id=? AND device_id=? AND expires_ms>?",
        )
        .bind(e?.key_id || "", household, device.id, now)
        .first();
      if (!pairing)
        throw new HTTPError(403, "Local controller revoked or expired");
      const command = decodeCommand(
          e,
          pairing.public_key_der,
          device.id,
          now,
          2 * 86400000,
        ),
        payload = JSON.stringify(command.payload),
        digest = hash(payload);
      const old = await db
        .prepare(
          "SELECT o.*,l.result_revision FROM operations o LEFT JOIN lan_operation_results l USING(household_id,request_id) WHERE household_id=? AND request_id=?",
        )
        .bind(household, e.request_id)
        .first();
      if (old) {
        if (
          old.device_id !== device.id ||
          old.kind !== command.kind ||
          old.body_hash !== digest
        )
          throw new HTTPError(409, "Request ID reused");
        if (old.result_revision === null || old.result_revision === undefined)
          throw new HTTPError(409, "Command belongs to another transport");
        expected = old.result_revision;
        chainBase ??= e.base_revision;
        results.push({
          request_id: e.request_id,
          status: "accepted",
          revision: expected,
          duplicate: true,
        });
        continue;
      }
      chainBase ??= e.base_revision;
      expected ??= e.base_revision;
      if (e.base_revision !== chainBase && e.base_revision !== expected)
        throw new HTTPError(409, "Cloud configuration changed");
      // Conditional INSERT and both triggers are one D1 transaction. A stale command
      // never overwrites a newer parent change, including a concurrent cloud write.
      const inserted = await db.batch([
        db
          .prepare(
            `INSERT INTO operations SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM devices WHERE id=? AND household_id=? AND enabled=1 AND revision=?) AND EXISTS(SELECT 1 FROM lan_pairings WHERE id=? AND expires_ms>? AND public_key_der=?) ON CONFLICT(household_id,request_id) DO NOTHING`,
          )
          .bind(
            household,
            e.request_id,
            command.kind,
            device.id,
            digest,
            payload,
            e.issued_ms,
            device.id,
            household,
            expected,
            e.key_id,
            now,
            pairing.public_key_der,
          ),
        db
          .prepare(
            "INSERT INTO lan_operation_results SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM operations WHERE household_id=? AND request_id=? AND body_hash=? AND kind=? AND device_id=? AND created_ms=?) ON CONFLICT(household_id,request_id) DO NOTHING",
          )
          .bind(
            household,
            e.request_id,
            expected + 1,
            household,
            e.request_id,
            digest,
            command.kind,
            device.id,
            e.issued_ms,
          ),
      ]);
      if (inserted[0].meta.changes === 0)
        throw new HTTPError(409, "Cloud configuration changed");
      expected++;
      results.push({
        request_id: e.request_id,
        status: "accepted",
        revision: expected,
      });
    } catch (error) {
      results.push({
        request_id: typeof e?.request_id === "string" ? e.request_id : null,
        status: error.status === 409 ? "conflict" : "rejected",
      });
      break;
    }
  }
  return results;
}
export async function localState(db, device, now) {
  const fresh = await db
    .prepare(
      "SELECT d.*,h.policy_json FROM devices d JOIN households h ON h.id=d.household_id WHERE d.id=?",
    )
    .bind(device.id)
    .first();
  return stateFor(db, fresh, JSON.parse(fresh.policy_json), now);
}
