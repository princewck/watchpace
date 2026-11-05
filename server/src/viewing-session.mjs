/** Reuse deduplicated playback samples. Short pauses stay in the same session. */
export async function viewingSession(db, device, policy, now) {
  const limit = policy.session_limit_seconds ?? null;
  const rest = Math.max(300, policy.session_break_seconds ?? 300) * 1000;
  let used = 0,
    last = null,
    newerStart = null;
  let cursorTime = now + 30001,
    cursorID = "\uffff";
  scan: for (;;) {
    const { results } = await db
      .prepare(
        "SELECT at_ms,event_id,seconds FROM usage_samples WHERE device_id=? AND at_ms>=? AND (at_ms,event_id)<(?,?) ORDER BY at_ms DESC,event_id DESC LIMIT 128",
      )
      .bind(device.id, now - 2 * 86400000, cursorTime, cursorID)
      .all();
    for (const sample of results) {
      if (last === null) {
        last = sample.at_ms;
        if (now - last >= rest) break scan;
      }
      if (newerStart !== null && newerStart - sample.at_ms >= rest) break scan;
      used += sample.seconds;
      newerStart = sample.at_ms - sample.seconds * 1000;
      cursorTime = sample.at_ms;
      cursorID = sample.event_id;
    }
    if (results.length < 128) break;
  }
  return {
    session_used_seconds: used,
    session_last_play_ms: last,
    session_break_remaining_seconds:
      limit !== null && used >= limit
        ? Math.max(0, Math.ceil((last + rest - now) / 1000))
        : 0,
  };
}
