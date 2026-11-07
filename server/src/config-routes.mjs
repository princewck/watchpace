import { json, HTTPError } from "./security.mjs";
import { validatePolicy, validateScheduleForDevice } from "./policy.mjs";
import { ownDevice, devicePolicy } from "./device-access.mjs";

export async function configRoute({ db, s, url, path, post, body }) {
  if (path !== "/admin/config") return null;
  if (url.searchParams.has("device")) {
    const d = await ownDevice(db, s, url);
    if (!post) return json({ policy: devicePolicy(d) });
    const policy = validatePolicy(body.policy);
    validateScheduleForDevice(policy, d);
    if (policy.session_limit_seconds !== null && d.session_rules_version < 1)
      throw new HTTPError(
        409,
        "Update the TV client before enabling session rules",
      );
    await db
      .prepare(
        "UPDATE devices SET policy_json=?,revision=revision+1 WHERE id=?",
      )
      .bind(JSON.stringify(policy), d.id)
      .run();
    return json({ success: true, policy });
  }
  // Compatibility: requests with no TV retain the household default for future installations.
  if (!post) return json({ policy: JSON.parse(s.policy_json) });
  const policy = validatePolicy(body.policy);
  validateScheduleForDevice(policy, null);
  if (policy.session_limit_seconds !== null)
    throw new HTTPError(400, "Select a compatible TV for session rules");
  await db.batch([
    db
      .prepare("UPDATE households SET policy_json=? WHERE id=?")
      .bind(JSON.stringify(policy), s.household_id),
    db
      .prepare(
        "UPDATE devices SET revision=revision+1 WHERE household_id=? AND policy_json IS NULL",
      )
      .bind(s.household_id),
  ]);
  return json({ success: true, policy });
}
