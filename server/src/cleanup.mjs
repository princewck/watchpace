import { dayOf } from "./policy.mjs";
export async function cleanup(env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tv_invitations WHERE expires_ms<?").bind(
      now - 86400000,
    ),
    env.DB.prepare("DELETE FROM lan_pairings WHERE expires_ms<=?").bind(now),
    env.DB.prepare("DELETE FROM sessions WHERE expires_ms<=?").bind(now),
    env.DB.prepare("DELETE FROM installation_tickets WHERE expires_ms<=?").bind(
      now,
    ),
    env.DB.prepare("DELETE FROM usage_samples WHERE day<?").bind(
      dayOf(now - 2 * 86400000),
    ),
    env.DB.prepare("DELETE FROM heartbeat_receipts WHERE received_ms<?").bind(
      now - 86400000,
    ),
    env.DB.prepare("DELETE FROM operations WHERE created_ms<?").bind(
      now - 7 * 86400000,
    ),
    env.DB.prepare("DELETE FROM rate_limits WHERE reset_ms<=?").bind(now),
    env.OFFICIAL_CLOUD === "false"
      ? env.DB.prepare("DELETE FROM daily_usage WHERE day<?").bind(
          dayOf(now - 29 * 86400000),
        )
      : env.DB.prepare(
          `DELETE FROM daily_usage WHERE day<? OR (day<? AND device_id IN(SELECT d.id FROM devices d WHERE NOT EXISTS(SELECT 1 FROM subscriptions s WHERE s.household_id=d.household_id AND s.revoked=0 AND s.expires_ms>?)))`,
        ).bind(dayOf(now - 29 * 86400000), dayOf(now), now),
  ]);
}
