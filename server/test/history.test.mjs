import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cleanup } from "../src/handler.mjs";
import { fixture } from "./fixture.mjs";
test("household deletion revokes sessions/devices and removes cloud history while preserving another household", async (t) => {
  const f = fixture(t),
    a = await f.register("family_a"),
    b = await f.register("family_b"),
    d = await f.install(a);
  await f.beat(d);
  await f.premium(a);
  assert.equal(
    (
      await f.call(
        "/admin/delete_household",
        { confirmation: "DELETE", password: "wrong" },
        a,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        "/admin/delete_household",
        { confirmation: "DELETE", password: "test-private-password-123" },
        a,
      )
    ).status,
    200,
  );
  assert.equal((await f.call("/admin/session", null, a)).status, 401);
  assert.equal((await f.beat(d)).status, 401);
  assert.equal((await f.call("/admin/session", null, b)).status, 200);
  assert.equal(
    f.db.db.prepare("SELECT COUNT(*) n FROM subscriptions").get().n,
    0,
  );
  assert.equal(
    f.db.db.prepare("SELECT COUNT(*) n FROM daily_usage").get().n,
    0,
  );
});
test("free historical storage is purged and account recovery rotates its credential", async (t) => {
  const f = fixture(t),
    a = await f.register("family_a"),
    d = await f.install(a);
  f.db.db
    .prepare("INSERT INTO daily_usage VALUES(?,?,?,?)")
    .run(d.device, "2030-01-01", "app", 100);
  await cleanup(f.env, f.now());
  assert.equal(
    f.db.db.prepare("SELECT COUNT(*) n FROM daily_usage").get().n,
    0,
  );
  const result = await f.call("/admin/recover", {
    username: "family_a",
    recovery_code: a.recovery_code,
    password: "new-private-password-123",
  });
  assert.equal(result.status, 200);
  assert.equal((await f.call("/admin/session", null, a)).status, 401);
  assert.equal(
    (
      await f.call("/admin/login", {
        username: "family_a",
        password: "test-private-password-123",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.call("/admin/login", {
        username: "family_a",
        password: "new-private-password-123",
      })
    ).status,
    200,
  );
});
test("offline usage is replayed once, charged to its own day, and consumes the matching bonus", async (t) => {
  const f = fixture(t),
    a = await f.register("family_a"),
    d = await f.install(a);
  await f.call(
    "/admin/grant?device=" + d.device,
    { seconds: 60, request_id: randomUUID() },
    a,
  );
  const sample = {
    id: randomUUID(),
    app: "com.ktcp.video",
    seconds: 10,
    day: "2030-01-02",
    at_ms: f.now() + 1000,
  };
  let state = await (await f.beat(d, { usage_samples: [sample] })).json();
  assert.equal(state.watched_seconds, 10);
  assert.equal(state.override_seconds, 50);
  assert.deepEqual(state.accepted_usage_ids, [sample.id]);
  state = await (await f.beat(d, { usage_samples: [sample] })).json();
  assert.equal(state.watched_seconds, 10);
  assert.equal(state.override_seconds, 50);
  const previous = {
    ...sample,
    id: randomUUID(),
    day: "2030-01-01",
    at_ms: f.now() - 86400000,
  };
  state = await (await f.beat(d, { usage_samples: [previous] })).json();
  assert.equal(state.watched_seconds, 10);
  assert.equal(state.override_seconds, 50);
  assert.equal(
    f.db.db
      .prepare("SELECT seconds FROM daily_usage WHERE device_id=? AND day=?")
      .get(d.device, "2030-01-01").seconds,
    10,
  );
  assert.equal(
    (
      await f.beat(d, {
        usage_samples: [{ ...sample, id: randomUUID(), seconds: 999 }],
      })
    ).status,
    400,
  );
});
test("expired unredeemed install tickets can rotate on the same device, but redeemed ones cannot", async (t) => {
  const f = fixture(t),
    a = await f.register("family_a");
  let response = await f.call(
    "/admin/installation_ticket",
    { label: "Living room" },
    a,
  );
  const old = await response.json();
  f.advance(16 * 60000);
  response = await f.call(
    "/admin/installation_ticket",
    { label: "Living room", device: old.device },
    a,
  );
  assert.equal(response.status, 201);
  const fresh = await response.json();
  assert.equal(fresh.device, old.device);
  assert.notEqual(fresh.code, old.code);
  assert.equal(
    (await f.call("/installation/redeem", { code: old.code })).status,
    410,
  );
  assert.equal(
    (await f.call("/installation/redeem", { code: fresh.code })).status,
    200,
  );
  assert.equal(
    (
      await f.call(
        "/admin/installation_ticket",
        { label: "Living room", device: old.device },
        a,
      )
    ).status,
    409,
  );
  const devices = await (await f.call("/admin/devices", null, a)).json();
  assert.equal(devices.devices.length, 1);
});
