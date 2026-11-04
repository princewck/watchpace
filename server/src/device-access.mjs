import { HTTPError } from "./security.mjs";
export const deviceJoin =
  "SELECT d.*,h.policy_json AS household_policy_json FROM devices d JOIN households h ON h.id=d.household_id";
export const accessWhere =
  "(d.household_id=? OR EXISTS(SELECT 1 FROM tv_access a WHERE a.device_id=d.id AND a.household_id=?))";
export async function ownDevice(db, s, url) {
  const id = url.searchParams.get("device");
  const row = id
    ? await db
        .prepare(deviceJoin + " WHERE d.id=? AND " + accessWhere)
        .bind(id, s.household_id, s.household_id)
        .first()
    : await db
        .prepare(
          deviceJoin +
            " WHERE " +
            accessWhere +
            " ORDER BY d.created_ms,d.id LIMIT 1",
        )
        .bind(s.household_id, s.household_id)
        .first();
  if (!row) throw new HTTPError(404, "Device not found");
  return row;
}
export function requireOwner(device, session) {
  if (device.household_id !== session.household_id)
    throw new HTTPError(403, "Only the TV owner can do this");
}
export function devicePolicy(device) {
  return JSON.parse(device.policy_json ?? device.household_policy_json);
}
export async function canAccess(db, device, household) {
  return (
    device.household_id === household ||
    !!(await db
      .prepare("SELECT 1 FROM tv_access WHERE device_id=? AND household_id=?")
      .bind(device.id, household)
      .first())
  );
}
