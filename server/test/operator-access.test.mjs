import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
import { cleanup } from "../src/handler.mjs";
test("operator access, Apple subscription and 180-day retention are independent", async (t) => {
  const f = fixture(t),
    a = await f.register("maintainer"),
    b = await f.register("regular");
  f.env.OFFICIAL_CLOUD = "true";
  const d = await f.install(a),
    other = await f.install(b);
  f.db.db
    .prepare("INSERT INTO operator_access VALUES(?,?,NULL,NULL,?)")
    .run(a.identity.tenant_id, f.now(), "Operator test grant");
  for (const id of [d.device, other.device])
    for (const day of ["2030-01-01", "2029-11-01", "2029-01-01"])
      f.db.db
        .prepare("INSERT INTO daily_usage VALUES(?,?,?,?)")
        .run(id, day, "com.ktcp.video", 600);
  const caps = await (
    await f.call("/admin/mobile_capabilities", null, a)
  ).json();
  assert.equal(caps.paid_history, true);
  assert.equal(caps.history_access, true);
  assert.equal(
    (await (await f.call("/admin/mobile_capabilities", null, b)).json())
      .history_access,
    false,
  );
  assert.equal(
    (await (await f.call("/admin/subscription", null, a)).json()).active,
    false,
  );
  await cleanup(f.env, f.now());
  assert.equal(
    f.db.db.prepare("SELECT COUNT(*) n FROM daily_usage").get().n,
    4,
  );
  const stats = await (
    await f.call("/admin/stats?device=" + d.device, null, a)
  ).json();
  assert.equal(stats.daily.length, 2);
  assert.equal(stats.premium, false);
  assert.equal(
    (await f.call("/admin/stats?device=" + d.device, null, b)).status,
    404,
  );
  assert.equal(
    (
      await (
        await f.call("/admin/stats?device=" + other.device, null, b)
      ).json()
    ).daily.length,
    0,
  );
  f.db.db
    .prepare("UPDATE operator_access SET revoked_ms=? WHERE household_id=?")
    .run(f.now(), a.identity.tenant_id);
  assert.equal(
    (await (await f.call("/admin/mobile_capabilities", null, a)).json())
      .history_access,
    false,
  );
  assert.equal(
    (await (await f.call("/admin/stats?device=" + d.device, null, a)).json())
      .daily.length,
    0,
  );
  await cleanup(f.env, f.now());
  assert.equal(
    f.db.db.prepare("SELECT COUNT(*) n FROM daily_usage").get().n,
    4,
  );
  await f.premium(a);
  assert.equal(
    (await (await f.call("/admin/subscription", null, a)).json()).active,
    true,
  );
  assert.equal(
    (await (await f.call("/admin/stats?device=" + d.device, null, a)).json())
      .daily.length,
    2,
  );
});
test("expired operator grants cannot grant history or Apple subscription", async (t) => {
  const f = fixture(t),
    a = await f.register("expired_grant");
  f.env.OFFICIAL_CLOUD = "true";
  f.db.db
    .prepare("INSERT INTO operator_access VALUES(?,?,?,NULL,?)")
    .run(a.identity.tenant_id, f.now() - 1000, f.now() - 1, "Expired fixture");
  assert.equal(
    (await (await f.call("/admin/mobile_capabilities", null, a)).json())
      .history_access,
    false,
  );
  assert.equal(
    (await (await f.call("/admin/subscription", null, a)).json()).active,
    false,
  );
});

test("shared television uses its owning family subscription, never the viewer other family", async (t) => {
  const f = fixture(t),
    owner = await f.register("tv_family"),
    guest = await f.register("guest_family");
  const d = await f.install(owner),
    own = await f.install(guest),
    q = "?device=" + d.device;
  const invite = await (
    await f.call("/admin/share/create" + q, {}, owner)
  ).json();
  const request = await (
    await f.call("/admin/share/request", { code: invite.code }, guest)
  ).json();
  await f.call(
    "/admin/share/approve" + q,
    { request_id: request.request_id },
    owner,
  );
  f.db.db
    .prepare("INSERT INTO daily_usage VALUES(?,?,?,?)")
    .run(d.device, "2030-01-01", "com.ktcp.video", 300);
  const guestPurchase = await f.premium(guest);
  assert.equal(
    (await (await f.call("/admin/subscription" + q, null, guest)).json())
      .active,
    false,
  );
  assert.equal(
    (await (await f.call("/admin/stats" + q, null, guest)).json()).daily.length,
    0,
  );
  assert.equal(
    (
      await f.call(
        "/admin/subscription" + q,
        { signed_transaction: guestPurchase.jws },
        guest,
      )
    ).status,
    409,
  );
  const ownerPurchase = await f.premium(owner);
  assert.equal(
    (await (await f.call("/admin/subscription" + q, null, guest)).json())
      .active,
    true,
  );
  assert.equal(
    (await (await f.call("/admin/stats" + q, null, guest)).json()).daily.length,
    1,
  );
  const ownStatus = await (
    await f.call("/admin/subscription?device=" + own.device, null, guest)
  ).json();
  assert.deepEqual(ownStatus.original_ids, [
    guestPurchase.transaction.originalTransactionId,
  ]);
  assert.equal(
    (
      await f.call(
        "/admin/subscription" + q,
        { signed_transaction: ownerPurchase.jws },
        guest,
      )
    ).status,
    200,
  );
});
