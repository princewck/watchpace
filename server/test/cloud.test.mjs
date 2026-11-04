import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cleanup } from "../src/handler.mjs";
import { fixture } from "./fixture.mjs";
test("eight-character registration and recovery accept the boundary and reject shorter passwords", async (t) => {
  const f = fixture(t);
  assert.equal(
    (
      await f.call("/admin/register", {
        username: "short_parent",
        password: "1234567",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call("/admin/register", {
        username: "long_parent",
        password: "x".repeat(129),
      })
    ).status,
    400,
  );
  const created = await f.call("/admin/register", {
    username: "eight_parent",
    password: "test1234",
  });
  assert.equal(created.status, 201);
  const account = await created.json();
  assert.equal(
    (
      await f.call("/admin/login", {
        username: "eight_parent",
        password: "test1234",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call("/admin/recover", {
        username: "eight_parent",
        recovery_code: account.recovery_code,
        password: "1234567",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call("/admin/recover", {
        username: "eight_parent",
        recovery_code: account.recovery_code,
        password: "next1234",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call("/admin/login", {
        username: "eight_parent",
        password: "next1234",
      })
    ).status,
    200,
  );
});
test("cloud registration/login, one-use installation and tenant boundaries", async (t) => {
  const f = fixture(t),
    a = await f.register("family_a"),
    b = await f.register("family_b"),
    device = await f.install(a);
  assert.equal((await f.call("/admin/session", null, a)).status, 200);
  assert.equal(
    (await f.call("/admin/control?device=" + device.device, null, b)).status,
    404,
  );
  assert.equal(
    (await f.call("/installation/redeem", { code: device.code })).status,
    410,
  );
  assert.equal(
    (
      await f.call(
        "/heartbeat",
        {
          device: device.device,
          event_id: randomUUID(),
          app: "app",
          is_playing: false,
        },
        null,
        { Authorization: "Bearer wrong-token" },
      )
    ).status,
    401,
  );
  const response = await f.beat(device);
  assert.equal(response.status, 200, await response.clone().text());
  const devices = await (await f.call("/admin/devices", null, a)).json();
  assert.equal(devices.devices[0].device_name, device.device);
  assert.ok(!JSON.stringify(devices).includes(device.token));
});
test("daily playback, idempotent parent pause/grant, and duplicate heartbeat", async (t) => {
  const f = fixture(t),
    a = await f.register("family_a"),
    d = await f.install(a);
  const config = await (await f.call("/admin/config", null, a)).json();
  config.policy.daily_limit_seconds = 60;
  assert.equal(
    (await f.call("/admin/config", { policy: config.policy }, a)).status,
    200,
  );
  for (let i = 0; i < 6; i++) assert.equal((await f.beat(d)).status, 200);
  let state = await (
    await f.call("/admin/control?device=" + d.device, null, a)
  ).json();
  assert.equal(state.lock_reason, "daily_limit");
  assert.equal(state.watched_seconds, 60);
  const grant = { seconds: 300, request_id: randomUUID() };
  await f.call("/admin/grant?device=" + d.device, grant, a);
  const id = randomUUID();
  await f.call(
    "/admin/control?device=" + d.device,
    { paused: true, request_id: id },
    a,
  );
  state = await (
    await f.call(
      "/admin/control?device=" + d.device,
      { paused: true, request_id: id },
      a,
    )
  ).json();
  assert.equal(state.duplicate, true);
  assert.equal(state.lock_reason, "parent_paused");
  assert.equal(
    (
      await f.call(
        "/admin/control?device=" + d.device,
        { paused: false, request_id: id },
        a,
      )
    ).status,
    409,
  );
  state = await (
    await f.call(
      "/admin/control?device=" + d.device,
      { paused: false, request_id: randomUUID() },
      a,
    )
  ).json();
  assert.equal(state.status, "allow");
  const event = randomUUID();
  const first = await (await f.beat(d, { event_id: event })).json();
  const again = await (await f.beat(d, { event_id: event })).json();
  assert.equal(again.watched_seconds, first.watched_seconds);
  assert.equal(again.duplicate, true);
});
test("history is enforced by the server and expired/revoked subscriptions cannot unlock it", async (t) => {
  const f = fixture(t),
    a = await f.register("family_a"),
    d = await f.install(a),
    yesterday = "2030-01-01";
  f.db.db
    .prepare("INSERT INTO daily_usage VALUES(?,?,?,?)")
    .run(d.device, yesterday, "com.ktcp.video", 900);
  let stats = await (
    await f.call("/admin/stats?device=" + d.device, null, a)
  ).json();
  assert.equal(stats.daily.length, 0);
  assert.equal(stats.premium, false);
  const purchase = await f.premium(a);
  stats = await (
    await f.call("/admin/stats?device=" + d.device, null, a)
  ).json();
  assert.equal(stats.daily[0].seconds, 900);
  assert.equal(stats.premium, true);
  purchase.transaction.revocationDate = f.now();
  purchase.transaction.signedDate += 1;
  await f.call("/admin/subscription", { signed_transaction: purchase.jws }, a);
  stats = await (
    await f.call("/admin/stats?device=" + d.device, null, a)
  ).json();
  assert.equal(stats.daily.length, 0);
  const b = await f.register("family_b");
  assert.equal(
    (
      await f.call(
        "/admin/subscription",
        { signed_transaction: purchase.jws },
        b,
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.call("/admin/subscription", { signed_transaction: "forged" }, a))
      .status,
    403,
  );
});
test("health requires actual playback evidence and ADB closure before reboot", async (t) => {
  const f = fixture(t),
    a = await f.register("family_a"),
    d = await f.install(a);
  await f.beat(d, {
    boot_count: 5,
    adb_enabled: 1,
    permissions_ok: true,
    applied_revision: 1,
    enforcement_result: "stopped",
    playback_stop_verified: true,
  });
  await f.beat(d, {
    boot_count: 6,
    adb_enabled: 0,
    permissions_ok: true,
    applied_revision: 1,
    enforcement_result: "allowed",
  });
  let health = await (
    await f.call("/admin/installation_status?device=" + d.device, null, a)
  ).json();
  assert.equal(health.checks.rebooted, false);
  assert.equal(health.complete, false);
  await f.beat(d, {
    boot_count: 7,
    adb_enabled: 0,
    permissions_ok: true,
    applied_revision: 1,
    enforcement_result: "allowed",
  });
  health = await (
    await f.call("/admin/installation_status?device=" + d.device, null, a)
  ).json();
  assert.equal(health.complete, true);
});
