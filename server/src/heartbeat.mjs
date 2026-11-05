import { devicePolicy } from "./device-access.mjs";
import { registerLanIdentity, lanKeys, syncLan } from "./lan.mjs";
import { HTTPError, hash } from "./security.mjs";
import { dayOf, stateFor } from "./policy.mjs";
import { APPS, UUID } from "./context.mjs";
export async function heartbeat(db, request, body, now, env) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ") || bearer.length > 140)
    throw new HTTPError(401, "Device authentication required");
  const d = await db
    .prepare(
      "SELECT d.*,h.policy_json AS household_policy_json FROM devices d JOIN households h ON h.id=d.household_id WHERE token_hash=? AND enabled=1",
    )
    .bind(hash(bearer.slice(7)))
    .first();
  if (!d) throw new HTTPError(401, "Invalid device token");
  if (body.device !== d.id) throw new HTTPError(403, "Device mismatch");
  if (
    typeof body.is_playing !== "boolean" ||
    !UUID.test(body.event_id || "") ||
    !/^[A-Za-z0-9_.-]{1,180}$/.test(body.app || "")
  )
    throw new HTTPError(400, "Invalid heartbeat");
  const duplicate = await db
    .prepare(
      "SELECT 1 FROM heartbeat_receipts WHERE device_id=? AND event_id=?",
    )
    .bind(d.id, body.event_id)
    .first();
  if (duplicate)
    return {
      ...(await stateFor(db, d, devicePolicy(d), now)),
      duplicate: true,
    };
  if (d.last_heartbeat_ms !== null && now - d.last_heartbeat_ms < 8000)
    throw new HTTPError(429, "Heartbeat too frequent");
  const samples = body.usage_samples;
  if (samples !== undefined && (!Array.isArray(samples) || samples.length > 64))
    throw new HTTPError(400, "Invalid usage samples");
  for (const sample of samples ?? [])
    if (
      !UUID.test(sample.id || "") ||
      !APPS.has(sample.app) ||
      !Number.isInteger(sample.seconds) ||
      sample.seconds < 1 ||
      sample.seconds > 10 ||
      !Number.isSafeInteger(sample.at_ms) ||
      sample.at_ms > now + 30000 ||
      sample.at_ms < now - 2 * 86400000 ||
      sample.day !== dayOf(sample.at_ms) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(sample.day) ||
      sample.day > dayOf(now) ||
      sample.day < dayOf(now - 2 * 86400000)
    )
      throw new HTTPError(400, "Invalid usage sample");
  const seconds =
    samples !== undefined
      ? 0
      : d.last_heartbeat_ms === null
        ? 10
        : Math.max(
            0,
            Math.min(10, Math.floor((now - d.last_heartbeat_ms) / 1000)),
          );
  const today = dayOf(now),
    previous = dayOf(now - 86400000),
    start = Date.parse(today + "T00:00:00+08:00");
  const current = Math.min(
    seconds,
    Math.max(0, Math.floor((now - start) / 1000)),
  );
  const receipt = db
    .prepare(
      `INSERT INTO heartbeat_receipts SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM devices WHERE id=? AND token_hash=? AND (last_heartbeat_ms IS NULL OR last_heartbeat_ms<=?)) ON CONFLICT(device_id,event_id) DO NOTHING`,
    )
    .bind(
      d.id,
      body.event_id,
      now,
      today,
      previous,
      APPS.has(body.app) ? body.app : "android",
      seconds,
      current,
      body.is_playing && APPS.has(body.app) ? 1 : 0,
      d.id,
      d.token_hash,
      now - 8000,
    );
  await registerLanIdentity(db, d, body, now);
  const localResults =
    body.lan_commands === undefined
      ? []
      : await syncLan(db, d.household_id, d, body.lan_commands, now);
  const currentDevice = await db
    .prepare("SELECT * FROM devices WHERE id=?")
    .bind(d.id)
    .first();
  const revision = body.applied_revision;
  if (
    revision !== undefined &&
    (!Number.isSafeInteger(revision) ||
      revision < 0 ||
      revision > currentDevice.revision ||
      !["allowed", "stopped", "observing", "failed"].includes(
        body.enforcement_result,
      ))
  )
    throw new HTTPError(400, "Invalid execution receipt");
  const applied = revision !== undefined && revision >= d.applied_revision;
  const currentRevision = revision === currentDevice.revision;
  const boot =
    Number.isInteger(body.boot_count) && body.boot_count >= 0
      ? body.boot_count
      : null;
  const adb = [0, 1].includes(body.adb_enabled) ? body.adb_enabled : null;
  const permissions =
    typeof body.permissions_ok === "boolean"
      ? Number(body.permissions_ok)
      : null;
  if (
    body.session_rules_version !== undefined &&
    body.session_rules_version !== 1
  )
    throw new HTTPError(400, "Unsupported session rules capability");
  const statements = [
    receipt,
    db
      .prepare(
        `UPDATE devices SET session_rules_version=?,update_protocol_version=?,client_version_code=?,boot_count=?,initial_boot=COALESCE(initial_boot,?),closed_at_boot=CASE WHEN ?=1 THEN NULL WHEN ?=0 THEN COALESCE(closed_at_boot,?) ELSE closed_at_boot END,adb_enabled=?,permissions_ok=?,applied_revision=CASE WHEN ? THEN ? ELSE applied_revision END,enforcement_result=CASE WHEN ? THEN ? ELSE enforcement_result END,applied_ms=CASE WHEN ? THEN ? ELSE applied_ms END,stopped_ms=CASE WHEN ? THEN ? ELSE stopped_ms END,resumed_ms=CASE WHEN ? THEN ? ELSE resumed_ms END WHERE id=? AND last_heartbeat_ms=?`,
      )
      .bind(
        body.session_rules_version === 1 ? 1 : 0,
        body.update_protocol_version === 1 ? 1 : 0,
        Number.isSafeInteger(body.client_version_code) &&
          body.client_version_code > 0
          ? body.client_version_code
          : null,
        boot,
        boot,
        adb,
        adb,
        boot,
        adb,
        permissions,
        Number(applied),
        revision ?? 0,
        Number(applied),
        body.enforcement_result ?? null,
        Number(applied),
        now,
        Number(
          currentRevision &&
            body.enforcement_result === "stopped" &&
            body.playback_stop_verified === true,
        ),
        now,
        Number(
          currentRevision &&
            body.enforcement_result === "allowed" &&
            body.is_playing &&
            APPS.has(body.app),
        ),
        now,
        d.id,
        now,
      ),
  ];
  for (const sample of samples ?? [])
    statements.push(
      db
        .prepare(
          "INSERT INTO usage_samples VALUES(?,?,?,?,?,?) ON CONFLICT(device_id,event_id) DO NOTHING",
        )
        .bind(
          d.id,
          sample.id,
          sample.day,
          sample.app,
          sample.seconds,
          sample.at_ms,
        ),
    );
  const results = await db.batch(statements);
  if (results[0].meta.changes === 0)
    throw new HTTPError(429, "Heartbeat raced; retry later");
  const fresh = await db
    .prepare(
      "SELECT d.*,h.policy_json AS household_policy_json FROM devices d JOIN households h ON h.id=d.household_id WHERE d.id=?",
    )
    .bind(d.id)
    .first();
  const state = await stateFor(db, fresh, devicePolicy(fresh), now);
  // New clients enforce cached policy and report actual playback; the URL also
  // supports existing WebView agents until the native offline screen is installed.
  if (state.status === "lock")
    state.launch_url = env.PUBLIC_ORIGIN + "/tv-rest";
  if (samples !== undefined)
    state.accepted_usage_ids = samples.map((x) => x.id);
  state.lan_keys = await lanKeys(db, d.id, now);
  state.lan_sync_results = localResults;
  return state;
}
