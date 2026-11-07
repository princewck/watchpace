import { viewingSession } from "./viewing-session.mjs";
import { HTTPError } from "./security.mjs";
export const DEFAULT_SCHEDULE_ZONE = "Asia/Shanghai";
export const DEFAULT_POLICY = {
  initial_seconds: 1800,
  first_reward_seconds: 1200,
  second_reward_seconds: 300,
  repeat_seconds: 120,
  rest_reset_seconds: 18000,
  default_grant_seconds: 900,
  daily_limit_seconds: 5400,
  banned_windows: [],
  session_limit_seconds: null,
  session_break_seconds: 300,
};
export const dayOf = (now) =>
  new Date(now + 8 * 3600000).toISOString().slice(0, 10);
export function validatePolicy(input) {
  const value = { ...DEFAULT_POLICY, ...input };
  for (const key of [
    "initial_seconds",
    "first_reward_seconds",
    "second_reward_seconds",
    "repeat_seconds",
    "rest_reset_seconds",
    "default_grant_seconds",
    "daily_limit_seconds",
  ])
    if (
      !(key === "daily_limit_seconds" && value[key] === null) &&
      (!Number.isInteger(value[key]) ||
        value[key] < (key === "daily_limit_seconds" ? 0 : 60) ||
        value[key] > 86400)
    )
      throw new HTTPError(400, "Invalid " + key);
  if (
    value.session_limit_seconds !== null &&
    (!Number.isInteger(value.session_limit_seconds) ||
      value.session_limit_seconds < 60 ||
      value.session_limit_seconds > 86400)
  )
    throw new HTTPError(400, "Invalid session limit");
  if (
    !Number.isInteger(value.session_break_seconds) ||
    value.session_break_seconds < 300 ||
    value.session_break_seconds > 86400
  )
    throw new HTTPError(400, "Invalid session break");
  if (value.schedule_time_zone !== undefined) {
    const zone = value.schedule_time_zone;
    if (
      typeof zone !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(zone)
    )
      throw new HTTPError(400, "Invalid schedule time zone");
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
    } catch {
      throw new HTTPError(400, "Invalid schedule time zone");
    }
  }
  if (!Array.isArray(value.banned_windows) || value.banned_windows.length > 32)
    throw new HTTPError(400, "Invalid windows");
  value.banned_windows = value.banned_windows.map((w) => {
    if (
      typeof w.label !== "string" ||
      w.label.length > 64 ||
      !Array.isArray(w.days) ||
      !w.days.length ||
      w.days.some((x) => !Number.isInteger(x) || x < 0 || x > 6) ||
      typeof w.enabled !== "boolean" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.end)
    )
      throw new HTTPError(400, "Invalid window");
    return {
      id: typeof w.id === "string" ? w.id : crypto.randomUUID(),
      label: w.label,
      days: [...new Set(w.days)],
      start: w.start,
      end: w.end,
      enabled: w.enabled,
    };
  });
  return value;
}
export function validateScheduleForDevice(policy, device) {
  if (
    (policy.schedule_time_zone ?? DEFAULT_SCHEDULE_ZONE) !==
      DEFAULT_SCHEDULE_ZONE &&
    (device?.client_version_code ?? 0) < 16
  )
    throw new HTTPError(
      409,
      "Update the TV client before changing the schedule time zone",
    );
}
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function bannedAt(policy, now) {
  if (!policy.banned_windows.some((window) => window.enabled)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: policy.schedule_time_zone ?? DEFAULT_SCHEDULE_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const fields = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  const day = weekdays.indexOf(fields.weekday);
  const minute = Number(fields.hour) * 60 + Number(fields.minute);
  const n = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return (
    policy.banned_windows.find((w) => {
      if (!w.enabled) return false;
      const a = n(w.start),
        b = n(w.end);
      return a === b
        ? w.days.includes(day)
        : a < b
          ? w.days.includes(day) && minute >= a && minute < b
          : (w.days.includes(day) && minute >= a) ||
            (w.days.includes((day + 6) % 7) && minute < b);
    }) || null
  );
}
export async function stateFor(db, device, policy, now) {
  const usage = await db
    .prepare(
      "SELECT COALESCE(SUM(seconds),0) seconds FROM daily_usage WHERE device_id=? AND day=?",
    )
    .bind(device.id, dayOf(now))
    .first();
  const watched = Number(usage.seconds),
    limit = policy.daily_limit_seconds ?? 86400,
    bonus = device.bonus_expires_ms > now ? device.bonus_seconds : 0;
  const ban = bannedAt(policy, now);
  const session = await viewingSession(db, device, policy, now);
  let reason =
    bonus > 0
      ? null
      : ban
        ? "restricted_time"
        : watched >= limit
          ? "daily_limit"
          : null;
  if (session.session_break_remaining_seconds > 0) reason = "session_limit";
  if (device.paused) reason = "parent_paused";
  return {
    ...session,
    day: dayOf(now),
    status: reason ? "lock" : "allow",
    lock_reason: reason,
    stage: 0,
    stage_used_seconds: watched,
    stage_budget_seconds: limit,
    remaining_seconds:
      device.paused || session.session_break_remaining_seconds > 0
        ? 0
        : Math.min(
            bonus || Math.max(0, limit - watched),
            policy.session_limit_seconds == null
              ? 86400
              : Math.max(
                  0,
                  policy.session_limit_seconds - session.session_used_seconds,
                ),
          ),
    daily_limit_seconds: limit,
    watched_seconds: watched,
    override_seconds: bonus,
    bonus_expires_ms: device.bonus_expires_ms,
    paused: !!device.paused,
    control_revision: device.revision,
    applied_revision: device.applied_revision,
    enforcement_result: device.enforcement_result,
    applied_ms: device.applied_ms,
    server_now_ms: now,
    mode: "daily",
    policy_snapshot: policy,
  };
}
