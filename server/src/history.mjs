import { HTTPError } from "./security.mjs";
import { dayOf, stateFor } from "./policy.mjs";
import { subscriptionStatus } from "./subscriptions.mjs";
import { operatorHistoryFor } from "./family-billing.mjs";
export async function historyStats({
  db,
  session,
  device,
  policy,
  env,
  now,
  day,
}) {
  const premium =
    env.OFFICIAL_CLOUD === "false"
      ? { active: true }
      : await subscriptionStatus(db, device.household_id, now);
  const today = dayOf(now),
    historyAccess =
      premium.active ||
      (await operatorHistoryFor(
        db,
        session.household_id,
        device.household_id,
        now,
      ));
  const start = historyAccess ? dayOf(now - 179 * 86400000) : today;
  if (day !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < start || day > today)
      throw new HTTPError(403, "Day is outside available history");
    const hourly = await db
      .prepare(
        "SELECT hour,app_package,seconds FROM hourly_usage WHERE device_id=? AND day=? ORDER BY hour,app_package",
      )
      .bind(device.id, day)
      .all();
    return { day, hourly: hourly.results };
  }
  const daily = await db
    .prepare(
      "SELECT day,app_package,seconds FROM daily_usage WHERE device_id=? AND day>=? AND day<=? ORDER BY day,app_package",
    )
    .bind(device.id, start, today)
    .all();
  return {
    today,
    daily: daily.results,
    state: await stateFor(db, device, policy, now),
    server_now_ms: now,
    premium: premium.active,
    history_access: historyAccess,
    retention_days: 180,
  };
}
