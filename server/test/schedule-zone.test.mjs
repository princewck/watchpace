import assert from "node:assert/strict";
import test from "node:test";
import {
  bannedAt,
  validatePolicy,
  validateScheduleForDevice,
} from "../src/policy.mjs";

test("saved time zone governs overnight rest and older TVs reject a zone change", () => {
  const policy = validatePolicy({
    schedule_time_zone: "Asia/Tokyo",
    banned_windows: [
      { label: "Rest", enabled: true, days: [6], start: "22:30", end: "07:00" },
    ],
  });
  assert.ok(bannedAt(policy, Date.parse("2026-11-07T13:45:00Z")));
  assert.ok(bannedAt(policy, Date.parse("2026-11-07T21:59:00Z")));
  assert.equal(bannedAt(policy, Date.parse("2026-11-07T22:00:00Z")), null);
  assert.throws(
    () => validateScheduleForDevice(policy, { client_version_code: 15 }),
    { status: 409 },
  );
  assert.doesNotThrow(() =>
    validateScheduleForDevice(policy, { client_version_code: 16 }),
  );
  assert.equal(validatePolicy({}).schedule_time_zone, undefined);
  assert.throws(() => validatePolicy({ schedule_time_zone: "Invalid/Zone" }), {
    status: 400,
  });
});
