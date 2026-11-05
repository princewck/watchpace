import { ownDevice } from "./device-access.mjs";
import { operatorHistoryAccess } from "./operator-access.mjs";
export async function billingHousehold(db, session, url) {
  return url.searchParams.has("device")
    ? (await ownDevice(db, session, url)).household_id
    : session.household_id;
}
export async function operatorHistoryFor(db, viewer, owner, now) {
  return (
    !!(await operatorHistoryAccess(db, owner, now)) ||
    (viewer !== owner && !!(await operatorHistoryAccess(db, viewer, now)))
  );
}
