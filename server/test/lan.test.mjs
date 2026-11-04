import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { D1 } from "./d1.mjs";
import { createHandler } from "../src/handler.mjs";
import { signingText } from "../src/lan.mjs";
async function fixture(t) {
  const db = new D1(),
    env = { DB: db, PUBLIC_ORIGIN: "https://fixture.invalid" };
  let now = Date.parse("2030-01-02T12:00:00+08:00");
  const handle = createHandler({ clock: () => now });
  t.after(() => db.close());
  const call = async (path, body, auth, headers = {}) =>
    handle(
      new Request(env.PUBLIC_ORIGIN + path, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: env.PUBLIC_ORIGIN,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
  const register = async (username) => {
    const r = await call("/admin/register", {
      username,
      password: "private-test-only-password-123",
    });
    assert.equal(r.status, 201);
    const value = await r.json();
    return { ...value, cookie: r.headers.get("set-cookie").split(";")[0] };
  };
  const a = await register("lan_a"),
    b = await register("lan_b");
  const ticket = await (
    await call("/admin/installation_ticket", { label: "Local fixture" }, a)
  ).json();
  const device = await (
    await call("/installation/redeem", { code: ticket.code })
  ).json();
  const beat = async (body = {}) => {
    now += 10000;
    return call(
      "/heartbeat",
      {
        device: device.device,
        app: "android",
        is_playing: false,
        event_id: randomUUID(),
        lan_version: 1,
        lan_certificate_sha256: "ab".repeat(32),
        ...body,
      },
      null,
      { Authorization: "Bearer " + device.token },
    );
  };
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
    key_id = randomUUID(),
    public_key_der = pair.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
  const enroll = () =>
    call(
      "/admin/lan/pair?device=" + device.device,
      { key_id, public_key_der },
      a,
    );
  const envelope = (
    payload,
    { base = 1, issued = now, id = randomUUID() } = {},
  ) => {
    const e = {
      v: 1,
      device: device.device,
      key_id,
      request_id: id,
      issued_ms: issued,
      base_revision: base,
      payload: Buffer.from(JSON.stringify(payload)).toString("base64"),
    };
    e.signature = sign(
      "sha256",
      Buffer.from(signingText(e)),
      pair.privateKey,
    ).toString("base64");
    return e;
  };
  const send = (e) =>
    call("/admin/lan/command?device=" + device.device, { envelope: e }, a);
  return {
    db,
    call,
    a,
    b,
    device,
    beat,
    enroll,
    envelope,
    send,
    key_id,
    public_key_der,
    now: () => now,
    advance: (ms) => (now += ms),
  };
}
test("LAN pairing requires owned, recently connected TLS identity and parent authentication", async (t) => {
  const f = await fixture(t),
    path = "/admin/lan/pair?device=" + f.device.device;
  assert.equal((await f.enroll()).status, 409);
  assert.equal((await f.beat()).status, 200);
  assert.equal(
    (await f.call(path, { key_id: f.key_id, public_key_der: f.public_key_der }))
      .status,
    401,
  );
  assert.equal(
    (
      await f.call(
        path,
        { key_id: f.key_id, public_key_der: f.public_key_der },
        f.b,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await f.call(
        path,
        { key_id: f.key_id, public_key_der: f.public_key_der },
        f.a,
        { "X-CSRF-Token": "bad" },
      )
    ).status,
    403,
  );
  const response = await f.enroll();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).certificate_sha256, "ab".repeat(32));
  const beat = await (await f.beat()).json();
  assert.equal(beat.lan_keys[0].public_key_der, f.public_key_der);
  assert.equal(JSON.stringify(beat).includes("PRIVATE KEY"), false);
  f.advance(46000);
  assert.equal((await f.enroll()).status, 409);
});
test("signed LAN commands are device scoped, tamper resistant and idempotent", async (t) => {
  const f = await fixture(t);
  await f.beat();
  await f.enroll();
  const e = f.envelope({ kind: "pause", paused: true });
  const altered = {
    ...e,
    payload: Buffer.from('{"kind":"pause","paused":false}').toString("base64"),
  };
  assert.equal((await f.send(altered)).status, 403);
  let r = await f.send(e);
  assert.equal(r.status, 200);
  let state = await r.json();
  assert.equal(state.paused, true);
  assert.equal(state.control_revision, 2);
  assert.equal(state.applied_revision, 0);
  r = await f.send(e);
  state = await r.json();
  assert.equal(state.control_revision, 2);
  assert.equal(state.lan_sync_results[0].duplicate, true);
  assert.equal((await f.send({ ...e, device: "tv_wrong" })).status, 403);
  assert.equal(
    (
      await f.send(
        f.envelope({ kind: "shell", command: "reboot" }, { base: 2 }),
      )
    ).status,
    403,
  );
});
test("stale offline commands never overwrite newer cloud controls", async (t) => {
  const f = await fixture(t);
  await f.beat();
  await f.enroll();
  const old = f.envelope({ kind: "pause", paused: true });
  await f.call(
    "/admin/control?device=" + f.device.device,
    { paused: false, request_id: randomUUID() },
    f.a,
  );
  assert.equal((await f.send(old)).status, 409);
  const state = await (
    await f.call("/admin/control?device=" + f.device.device, null, f.a)
  ).json();
  assert.equal(state.paused, false);
  assert.equal(state.control_revision, 2);
});
test("an offline command chain and transport retry each apply exactly once", async (t) => {
  const f = await fixture(t);
  await f.beat();
  await f.enroll();
  const first = f.envelope({ kind: "pause", paused: true }),
    second = f.envelope({ kind: "pause", paused: false });
  await f.send(first);
  const r = await f.beat({ lan_commands: [first, second] });
  assert.equal(r.status, 200);
  const value = await r.json();
  assert.equal(value.control_revision, 3);
  assert.equal(value.paused, false);
  assert.deepEqual(
    value.lan_sync_results.map((x) => x.status),
    ["accepted", "accepted"],
  );
  const again = await (await f.beat({ lan_commands: [first, second] })).json();
  assert.equal(again.control_revision, 3);
  const third = f.envelope({ kind: "grant", seconds: 300 }, { base: 3 });
  const granted = await (await f.send(third)).json();
  assert.equal(granted.override_seconds, 300);
  const expires = granted.bonus_expires_ms;
  f.advance(60000);
  const duplicate = await (await f.send(third)).json();
  assert.equal(duplicate.bonus_expires_ms, expires);
});
test("LAN policy synchronization changes only the owning household", async (t) => {
  const f = await fixture(t);
  await f.beat();
  await f.enroll();
  const policy = (await (await f.call("/admin/config", null, f.a)).json())
    .policy;
  policy.daily_limit_seconds = 1800;
  const result = await f.send(f.envelope({ kind: "policy", policy }));
  assert.equal(result.status, 200);
  assert.equal(
    (await (await f.call("/admin/config", null, f.a)).json()).policy
      .daily_limit_seconds,
    1800,
  );
  assert.equal(
    (await (await f.call("/admin/config", null, f.b)).json()).policy
      .daily_limit_seconds,
    5400,
  );
});
test("revocation, expiry and TLS identity rotation invalidate local authority", async (t) => {
  const f = await fixture(t);
  await f.beat();
  await f.enroll();
  const e = f.envelope({ kind: "pause", paused: true });
  await f.call(
    "/admin/lan/revoke?device=" + f.device.device,
    { key_id: f.key_id },
    f.a,
  );
  assert.equal((await f.send(e)).status, 403);
  await f.enroll();
  await f.beat({ lan_certificate_sha256: "cd".repeat(32) });
  assert.equal((await f.send(e)).status, 403);
  await f.enroll();
  f.advance(31 * 86400000);
  const expired = await (
    await f.beat({
      lan_commands: [f.envelope({ kind: "pause", paused: true })],
    })
  ).json();
  assert.equal(expired.lan_sync_results[0].status, "rejected");
});

test("a real CryptoKit DER signature is accepted by Node verification", async () => {
  const { readFileSync } = await import("node:fs");
  const { decodeCommand } = await import("../src/lan.mjs");
  const vector = JSON.parse(
    readFileSync(new URL("./fixtures/lan-vector.json", import.meta.url)),
  );
  assert.equal(
    decodeCommand(
      vector.envelope,
      vector.public_key_der,
      vector.envelope.device,
      vector.envelope.issued_ms,
    ).kind,
    "pause",
  );
  assert.throws(
    () =>
      decodeCommand(
        {
          ...vector.envelope,
          payload: Buffer.from('{"kind":"pause","paused":false}').toString(
            "base64",
          ),
        },
        vector.public_key_der,
        vector.envelope.device,
        vector.envelope.issued_ms,
      ),
    /signature/,
  );
});
