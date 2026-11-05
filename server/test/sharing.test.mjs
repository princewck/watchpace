import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
test("sharing requires owner consent and isolates TV access and rules", async (t) => {
  const f = fixture(t),
    owner = await f.register("owner"),
    guest = await f.register("guest"),
    stranger = await f.register("stranger");
  const a = await f.install(owner),
    b = await f.install(owner);
  const path = (route, d = a) => route + "?device=" + d.device;
  const invite = await (
    await f.call(path("/admin/share/create"), {}, owner)
  ).json();
  assert.equal((await f.call(path("/admin/control"), null, guest)).status, 404);
  const request = await (
    await f.call("/admin/share/request", { code: invite.code }, guest)
  ).json();
  assert.equal(request.status, "pending");
  assert.equal((await f.call(path("/admin/control"), null, guest)).status, 404);
  assert.equal(
    (
      await f.call(
        path("/admin/share/approve"),
        { request_id: request.request_id },
        stranger,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await f.call(
        path("/admin/share/approve"),
        { request_id: request.request_id },
        owner,
      )
    ).status,
    200,
  );
  const devices = await (await f.call("/admin/devices", null, guest)).json();
  assert.deepEqual(
    devices.devices.map((d) => d.device_name),
    [a.device],
  );
  assert.equal(devices.devices[0].is_owner, false);
  assert.equal(
    (
      await f.call(
        path("/admin/control"),
        { paused: true, request_id: crypto.randomUUID() },
        guest,
      )
    ).status,
    200,
  );
  assert.equal(
    (await f.call(path("/admin/control", b), null, guest)).status,
    404,
  );
  assert.equal(
    (await f.call(path("/admin/share/create"), {}, guest)).status,
    403,
  );
  assert.equal(
    (await f.call(path("/admin/installation_restart"), {}, guest)).status,
    403,
  );
  const policy = (
    await (await f.call(path("/admin/config"), null, guest)).json()
  ).policy;
  policy.daily_limit_seconds = 1200;
  assert.equal(
    (await f.call(path("/admin/config"), { policy }, guest)).status,
    200,
  );
  assert.equal(
    (await (await f.call(path("/admin/config"), null, owner)).json()).policy
      .daily_limit_seconds,
    1200,
  );
  assert.equal(
    (await (await f.call(path("/admin/config", b), null, owner)).json()).policy
      .daily_limit_seconds,
    5400,
  );
  assert.equal(
    (await f.call("/admin/share/request", { code: invite.code }, stranger))
      .status,
    410,
  );
  assert.equal(
    (
      await f.call(
        path("/admin/share/revoke"),
        { household_id: guest.identity.tenant_id },
        owner,
      )
    ).status,
    200,
  );
  assert.equal((await f.call(path("/admin/control"), null, guest)).status, 404);
  const status = await (
    await f.call(
      "/admin/share/status?request=" + request.request_id,
      null,
      guest,
    )
  ).json();
  assert.equal(status.status, "revoked");
});
test("expired and rejected QR codes grant no access", async (t) => {
  const f = fixture(t),
    owner = await f.register("parent"),
    guest = await f.register("relative"),
    a = await f.install(owner);
  const invite = await (
    await f.call("/admin/share/create?device=" + a.device, {}, owner)
  ).json();
  f.advance(600001);
  assert.equal(
    (await f.call("/admin/share/request", { code: invite.code }, guest)).status,
    410,
  );
  assert.equal((await f.call("/admin/devices", null, guest)).status, 200);
  assert.equal(
    (await (await f.call("/admin/devices", null, guest)).json()).devices.length,
    0,
  );
});

test("a TV has at most three parent accounts including its owner, under concurrent approvals", async (t) => {
  const f = fixture(t),
    owner = await f.register("limited_owner");
  const guests = [];
  for (let i = 0; i < 3; i++) {
    f.advance(3600001);
    guests.push(await f.register("limited_guest_" + i));
  }
  const d = await f.install(owner),
    q = "?device=" + d.device,
    requests = [];
  for (const guest of guests) {
    const invite = await (
      await f.call("/admin/share/create" + q, {}, owner)
    ).json();
    const request = await (
      await f.call("/admin/share/request", { code: invite.code }, guest)
    ).json();
    requests.push(request.request_id);
  }
  const approved = await Promise.all(
    requests.map((request_id) =>
      f.call("/admin/share/approve" + q, { request_id }, owner),
    ),
  );
  assert.deepEqual(approved.map((r) => r.status).sort(), [200, 200, 409]);
  assert.equal(
    f.db.db
      .prepare("SELECT COUNT(*) n FROM tv_access WHERE device_id=?")
      .get(d.device).n,
    2,
  );
});
