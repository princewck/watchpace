import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";
import { validatePolicy } from "../src/policy.mjs";

test("session settings require five minutes of rest and support a zero daily allowance", () => {
  assert.equal(
    validatePolicy({ daily_limit_seconds: 0 }).daily_limit_seconds,
    0,
  );
  assert.throws(() => validatePolicy({ session_limit_seconds: 0 }));
  assert.throws(() => validatePolicy({ session_break_seconds: 299 }));
  assert.throws(() => validatePolicy({ session_limit_seconds: NaN }));
});
test("heartbeat samples enforce a session and only five inactive minutes reset it", async (t) => {
  const f = fixture(t),
    a = await f.register("session_parent"),
    d = await f.install(a);
  const path = "/admin/config?device=" + d.device;
  const policy = validatePolicy({
    session_limit_seconds: 60,
    session_break_seconds: 300,
    daily_limit_seconds: 3600,
  });
  assert.equal((await f.call(path, { policy }, a)).status, 409);
  await f.beat(d, { session_rules_version: 1, usage_samples: [] });
  assert.equal((await f.call(path, { policy }, a)).status, 200);
  let result;
  for (let i = 0; i < 6; i++) {
    const at = f.now() + 10000;
    result = await (
      await f.beat(d, {
        session_rules_version: 1,
        usage_samples: [
          {
            id: randomUUID(),
            app: "com.ktcp.video",
            seconds: 10,
            at_ms: at,
            day: new Date(at + 8 * 3600000).toISOString().slice(0, 10),
          },
        ],
      })
    ).json();
  }
  assert.equal(result.session_used_seconds, 60);
  assert.equal(result.lock_reason, "session_limit");
  assert.equal(result.session_break_remaining_seconds, 300);
  const stats = () =>
    f.call("/admin/stats?device=" + d.device, null, a).then((r) => r.json());
  f.advance(299000);
  assert.equal((await stats()).state.session_break_remaining_seconds, 1);
  f.advance(1000);
  assert.equal((await stats()).state.status, "allow");
  assert.equal((await stats()).state.session_used_seconds, 0);
});
test("short pauses and application changes remain one session, with TV isolation", async (t) => {
  const f = fixture(t),
    a = await f.register("session_isolation"),
    d = await f.install(a),
    other = await f.install(a);
  f.db.db
    .prepare("UPDATE devices SET policy_json=? WHERE id=?")
    .run(
      JSON.stringify(validatePolicy({ session_limit_seconds: 60 })),
      d.device,
    );
  const add = (device, app, end, seconds) =>
    f.db.db
      .prepare("INSERT INTO usage_samples VALUES(?,?,?,?,?,?)")
      .run(device, randomUUID(), "2030-01-02", app, seconds, end);
  add(d.device, "com.ktcp.video", f.now() - 120000, 30);
  add(d.device, "com.xiaodianshi.tv.yst", f.now(), 30);
  add(other.device, "com.ktcp.video", f.now(), 500);
  const state = (
    await (await f.call("/admin/stats?device=" + d.device, null, a)).json()
  ).state;
  assert.equal(state.session_used_seconds, 60);
  assert.equal(state.lock_reason, "session_limit");
  f.advance(300000);
  add(d.device, "com.ktcp.video", f.now() + 10000, 10);
  f.advance(10000);
  assert.equal(
    (await (await f.call("/admin/stats?device=" + d.device, null, a)).json())
      .state.session_used_seconds,
    10,
  );
});
