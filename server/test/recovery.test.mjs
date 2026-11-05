import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cleanup } from "../src/handler.mjs";
import { fixture } from "./fixture.mjs";
test("deleted-household restore requires matching verified Apple account and refuses a live original household", async (t) => {
  const f = fixture(t),
    a = await f.register("family_a"),
    b = await f.register("family_b"),
    purchase = await f.premium(a);
  purchase.transaction.appTransactionId = "apple-account-a";
  f.claims.set("proof", {
    bundleId: f.env.BUNDLE_ID,
    receiptType: "Sandbox",
    receiptCreationDate: f.now(),
    appTransactionId: "apple-account-a",
  });
  const restore = (proof = "proof") =>
    f.call(
      "/admin/subscription",
      { signed_transaction: purchase.jws, signed_app_transaction: proof },
      b,
    );
  assert.equal((await restore()).status, 409);
  await f.call(
    "/admin/delete_household",
    { confirmation: "DELETE", password: "test-private-password-123" },
    a,
  );
  assert.equal(
    (
      await f.call(
        "/admin/subscription",
        { signed_transaction: purchase.jws },
        b,
      )
    ).status,
    403,
  );
  assert.equal((await restore("forged")).status, 403);
  f.claims.set("wrong-proof", {
    ...f.claims.get("proof"),
    appTransactionId: "another-apple-account",
  });
  assert.equal((await restore("wrong-proof")).status, 403);
  f.claims.set("old-proof", {
    ...f.claims.get("proof"),
    receiptCreationDate: f.now() - 3600001,
  });
  assert.equal((await restore("old-proof")).status, 403);
  const response = await restore();
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.active, true);
  assert.deepEqual(result.original_ids, [
    purchase.transaction.originalTransactionId,
  ]);
  assert.equal(
    (
      await f.call(
        "/admin/subscription",
        { signed_transaction: purchase.jws },
        b,
      )
    ).status,
    200,
  );
  const c = await f.register("family_c");
  assert.equal(
    (
      await f.call(
        "/admin/subscription",
        { signed_transaction: purchase.jws, signed_app_transaction: "proof" },
        c,
      )
    ).status,
    409,
  );
  // A renewed transaction still carries the permanently deleted family token.
  f.advance(1000);
  purchase.transaction.transactionId = "renewal";
  purchase.transaction.expiresDate = f.now() + 2 * 86400000;
  purchase.transaction.signedDate = f.now();
  f.claims.set("notification", {
    data: { signedTransactionInfo: purchase.jws },
  });
  assert.equal(
    (await f.call("/apple/notifications", { signedPayload: "notification" }))
      .status,
    200,
  );
  let state = await (await f.call("/admin/subscription", null, b)).json();
  assert.equal(state.expires_ms, purchase.transaction.expiresDate);
  purchase.transaction.revocationDate = f.now();
  purchase.transaction.signedDate += 1;
  assert.equal(
    (await f.call("/apple/notifications", { signedPayload: "notification" }))
      .status,
    200,
  );
  state = await (await f.call("/admin/subscription", null, b)).json();
  assert.equal(state.active, false);
});
test("restore validates proof identity/environment/expiry and concurrent households cannot both claim it", async (t) => {
  const f = fixture(t),
    a = await f.register("family_a"),
    b = await f.register("family_b"),
    c = await f.register("family_c"),
    purchase = await f.premium(a);
  purchase.transaction.appTransactionId = "apple-account-a";
  await f.call(
    "/admin/delete_household",
    { confirmation: "DELETE", password: "test-private-password-123" },
    a,
  );
  const proof = {
    bundleId: f.env.BUNDLE_ID,
    receiptType: "Sandbox",
    receiptCreationDate: f.now(),
    appTransactionId: "apple-account-a",
  };
  for (const change of [
    { bundleId: "wrong.app" },
    { receiptType: "Production" },
    { appTransactionId: "" },
    { receiptCreationDate: f.now() + 300001 },
  ]) {
    f.claims.set("bad-proof", { ...proof, ...change });
    assert.equal(
      (
        await f.call(
          "/admin/subscription",
          {
            signed_transaction: purchase.jws,
            signed_app_transaction: "bad-proof",
          },
          b,
        )
      ).status,
      403,
    );
  }
  f.claims.set("proof", proof);
  for (const change of [
    { revocationDate: f.now() },
    { expiresDate: f.now() - 1 },
    { isUpgraded: true },
    { appTransactionId: undefined },
    { appAccountToken: undefined },
  ]) {
    f.claims.set("bad-transaction", { ...purchase.transaction, ...change });
    assert.equal(
      (
        await f.call(
          "/admin/subscription",
          {
            signed_transaction: "bad-transaction",
            signed_app_transaction: "proof",
          },
          b,
        )
      ).status,
      403,
    );
  }
  const responses = await Promise.all(
    [b, c].map((account) =>
      f.call(
        "/admin/subscription",
        { signed_transaction: purchase.jws, signed_app_transaction: "proof" },
        account,
      ),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const states = await Promise.all(
    [b, c].map(async (account) =>
      (await f.call("/admin/subscription", null, account)).json(),
    ),
  );
  assert.equal(states.filter((value) => value.active).length, 1);
});

test("failed redeemed setup can restart: old code/token revoked, first heartbeat confirms connection, removal is scoped", async (t) => {
  const f = fixture(t),
    a = await f.register("recover_family"),
    b = await f.register("other_family"),
    d = await f.install(a);
  let list = (await (await f.call("/admin/devices", null, a)).json()).devices;
  assert.equal(list[0].last_heartbeat_ms, null);
  assert.equal(list[0].installation_complete, false);
  assert.equal(
    (await f.call("/admin/installation_restart?device=" + d.device, {}, b))
      .status,
    404,
  );
  const restart = await f.call(
    "/admin/installation_restart?device=" + d.device,
    {},
    a,
  );
  assert.equal(restart.status, 201);
  const ticket = await restart.json();
  assert.equal(ticket.device, d.device);
  assert.equal((await f.beat(d)).status, 401);
  assert.equal(
    (await f.call("/installation/redeem", { code: d.code })).status,
    410,
  );
  const fresh = await (
    await f.call("/installation/redeem", { code: ticket.code })
  ).json();
  list = (await (await f.call("/admin/devices", null, a)).json()).devices;
  assert.equal(list[0].last_heartbeat_ms, null);
  assert.equal((await f.beat(fresh)).status, 200);
  list = (await (await f.call("/admin/devices", null, a)).json()).devices;
  assert.ok(list[0].last_heartbeat_ms > 0);
  assert.equal(list[0].installation_complete, false);
  assert.equal(
    (await f.call("/admin/device_remove?device=" + fresh.device, {}, b)).status,
    404,
  );
  assert.equal(
    (await f.call("/admin/device_remove?device=" + fresh.device, {}, a)).status,
    200,
  );
  assert.equal((await f.beat(fresh)).status, 401);
  assert.equal(
    (await (await f.call("/admin/devices", null, a)).json()).devices.length,
    0,
  );
});

test("self-hosted runtime includes history without Apple credentials or subscription", async (t) => {
  const f = fixture(t);
  f.env.OFFICIAL_CLOUD = "false";
  const a = await f.register("self_hosted"),
    d = await f.install(a);
  f.db.db
    .prepare("INSERT INTO daily_usage VALUES(?,?,?,?)")
    .run(d.device, "2030-01-01", "com.ktcp.video", 600);
  assert.equal(
    (await (await f.call("/admin/mobile_capabilities", null, a)).json())
      .paid_history,
    false,
  );
  assert.equal(
    (await (await f.call("/admin/subscription", null, a)).json()).active,
    false,
  );
  await cleanup(f.env, f.now());
  const stats = await (
    await f.call("/admin/stats?device=" + d.device, null, a)
  ).json();
  assert.equal(stats.premium, true);
  assert.equal(stats.daily[0].seconds, 600);
});
