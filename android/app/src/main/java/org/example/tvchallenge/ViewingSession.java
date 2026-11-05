package org.example.tvchallenge;

import java.util.*;
import org.json.*;

/** Cloud heartbeat summary plus the existing unacknowledged journal; no second timer. */
final class ViewingSession {

  static void apply(
    JSONObject state,
    JSONObject policy,
    JSONArray pending,
    long now
  ) throws Exception {
    int used = state.optInt("session_used_seconds", 0);
    long last = state.optLong("session_last_play_ms", 0);
    long rest =
      Math.max(300, policy.optInt("session_break_seconds", 300)) * 1000L;
    List<JSONObject> samples = new ArrayList<>();
    for (int i = 0; i < pending.length(); i++) samples.add(
      pending.getJSONObject(i)
    );
    samples.sort(Comparator.comparingLong(sample -> sample.optLong("at_ms")));
    for (JSONObject sample : samples) {
      long end = sample.getLong("at_ms");
      if (end <= last) continue;
      int seconds = sample.getInt("seconds");
      if (last == 0 || end - seconds * 1000L - last >= rest) used = 0;
      used += seconds;
      last = end;
    }
    if (last == 0 || now - last >= rest) used = 0;
    int limit = policy.isNull("session_limit_seconds")
      ? 0
      : policy.optInt("session_limit_seconds", 0);
    int remaining =
      limit > 0 && used >= limit
        ? (int) Math.max(0, (last + rest - now + 999) / 1000)
        : 0;
    state.put("session_used_seconds", used);
    state.put("session_last_play_ms", last);
    state.put("session_break_remaining_seconds", remaining);
    if (remaining > 0 && !state.optBoolean("paused", false)) {
      state.put("status", "lock");
      state.put("lock_reason", "session_limit");
      state.put("remaining_seconds", 0);
    } else if (limit > 0 && "allow".equals(state.optString("status"))) {
      state.put(
        "remaining_seconds",
        Math.min(state.optInt("remaining_seconds"), Math.max(0, limit - used))
      );
    }
  }
}
