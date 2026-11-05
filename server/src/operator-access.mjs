export async function operatorHistoryAccess(db, household, now) {
  return db
    .prepare(
      "SELECT granted_ms,expires_ms FROM operator_access WHERE household_id=? AND revoked_ms IS NULL AND (expires_ms IS NULL OR expires_ms>?)",
    )
    .bind(household, now)
    .first();
}
