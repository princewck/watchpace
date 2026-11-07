package org.example.tvchallenge;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.*;
import org.json.*;

/** Device-private, retry-safe playback journal; no credentials are exposed. */
final class OfflineState {

  private final SharedPreferences p;

  OfflineState(Context c) {
    p = NativeState.prefs(c);
  }

  long now() {
    return System.currentTimeMillis() + p.getLong("server_offset", 0);
  }

  String day() {
    SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
    f.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
    return f.format(new Date(now()));
  }

  private JSONArray queue() {
    try {
      return new JSONArray(p.getString("usage_queue", "[]"));
    } catch (JSONException e) {
      return new JSONArray();
    }
  }

  void record(String app, int seconds) throws Exception {
    synchronized (NativeState.class) {
      if (seconds <= 0) return;
      String day = day();
      int used = day.equals(p.getString("usage_day", ""))
        ? p.getInt("local_used", 0)
        : 0;
      JSONArray queue = queue();
      JSONObject item = new JSONObject();
      item.put("id", UUID.randomUUID().toString());
      item.put("app", app);
      item.put("day", day);
      item.put("seconds", seconds);
      item.put("at_ms", now());
      if (queue.length() >= 17280) {
        samples();
        queue = queue();
      }
      if (queue.length() >= 17280) throw new IllegalStateException(
        "Playback journal full"
      );
      // Coalesce only samples never exposed to the transport: a retried event ID is immutable.
      JSONObject tail =
        queue.length() > 0 ? queue.getJSONObject(queue.length() - 1) : null;
      if (
        tail != null &&
        !tail.optBoolean("exported", false) &&
        app.equals(tail.optString("app")) &&
        day.equals(tail.optString("day")) &&
        tail.getInt("seconds") + seconds <= 10 &&
        now() - tail.getLong("at_ms") < 10000
      ) {
        tail.put("seconds", tail.getInt("seconds") + seconds);
        tail.put("at_ms", now());
      } else queue.put(item);
      if (
        !p
          .edit()
          .putString("usage_queue", queue.toString())
          .putString("usage_day", day)
          .putInt("local_used", used + seconds)
          .putInt(
            "local_bonus",
            Math.max(0, p.getInt("local_bonus", 0) - seconds)
          )
          .putInt(
            "lan_bonus_remaining",
            Math.max(0, p.getInt("lan_bonus_remaining", 0) - seconds)
          )
          .commit()
      ) throw new java.io.IOException("Journal not saved");
    }
  }

  JSONArray samples() throws Exception {
    synchronized (NativeState.class) {
      JSONArray out = new JSONArray(),
        queue = queue(),
        kept = new JSONArray();
      SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
      f.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
      String oldest = f.format(new Date(now() - 2L * 86400000));
      for (int i = 0; i < queue.length(); i++) {
        JSONObject item = queue.getJSONObject(i);
        if (item.getString("day").compareTo(oldest) < 0) continue;
        kept.put(item);
        if (out.length() < 64) {
          item.put("exported", true);
          JSONObject wire = new JSONObject(item.toString());
          wire.remove("exported");
          out.put(wire);
        }
      }
      if (
        !p.edit().putString("usage_queue", kept.toString()).commit()
      ) throw new java.io.IOException("Journal export not saved");
      return out;
    }
  }

  void accept(JSONObject state) throws Exception {
    synchronized (NativeState.class) {
      LanControl.reconcile(p, state.optJSONArray("lan_sync_results"));
      JSONArray ids = state.optJSONArray("accepted_usage_ids");
      Set<String> accepted = new HashSet<>();
      if (ids != null) for (int i = 0; i < ids.length(); i++) accepted.add(
        ids.getString(i)
      );
      JSONArray kept = new JSONArray(),
        queue = queue();
      for (int i = 0; i < queue.length(); i++) {
        JSONObject item = queue.getJSONObject(i);
        if (!accepted.contains(item.getString("id"))) kept.put(item);
      }
      String day = state.getString("day");
      int local = day.equals(p.getString("usage_day", ""))
        ? p.getInt("local_used", 0)
        : 0;
      int pending = 0,
        pendingBonus = 0;
      for (int i = 0; i < kept.length(); i++) {
        JSONObject item = kept.getJSONObject(i);
        if (day.equals(item.getString("day"))) pending += item.getInt(
          "seconds"
        );
        if (
          item.getLong("at_ms") >=
          state.optLong("bonus_expires_ms", 0) - 86400000
        ) pendingBonus += item.getInt("seconds");
      }
      p.edit()
        .putString("usage_queue", kept.toString())
        .putString("cached_state", state.toString())
        .putLong(
          "server_offset",
          state.getLong("server_now_ms") - System.currentTimeMillis()
        )
        .putString("usage_day", day)
        .putInt(
          "local_used",
          Math.max(local, state.getInt("watched_seconds") + pending)
        )
        .putInt(
          "local_bonus",
          Math.max(0, state.optInt("override_seconds", 0) - pendingBonus)
        )
        .commit();
    }
  }

  JSONObject state() throws Exception {
    synchronized (NativeState.class) {
      String cached = p.getString("cached_state", "");
      if (cached.isEmpty()) throw new IllegalStateException("No cached policy");
      JSONObject state = LanControl.overlay(p, new JSONObject(cached), now()),
        policy = state.getJSONObject("policy_snapshot");
      int used = day().equals(p.getString("usage_day", ""))
        ? p.getInt("local_used", 0)
        : 0;
      int limit = policy.isNull("daily_limit_seconds")
        ? 86400
        : policy.optInt("daily_limit_seconds", 5400);
      boolean paused = state.optBoolean("paused", false),
        quiet = false;
      Calendar cal = Calendar.getInstance(
        TimeZone.getTimeZone(
          policy.optString("schedule_time_zone", "Asia/Shanghai")
        )
      );
      cal.setTimeInMillis(now());
      int weekday = cal.get(Calendar.DAY_OF_WEEK) - 1,
        minute = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE);
      JSONArray windows = policy.getJSONArray("banned_windows");
      for (int i = 0; i < windows.length(); i++) {
        JSONObject w = windows.getJSONObject(i);
        if (!w.getBoolean("enabled")) continue;
        int start = minutes(w.getString("start")),
          end = minutes(w.getString("end"));
        JSONArray days = w.getJSONArray("days");
        boolean today = false,
          previous = false;
        for (int j = 0; j < days.length(); j++) {
          today |= days.getInt(j) == weekday;
          previous |= days.getInt(j) == (weekday + 6) % 7;
        }
        quiet |=
          start == end
            ? today
            : start < end
              ? today && minute >= start && minute < end
              : (today && minute >= start) || (previous && minute < end);
      }
      int bonus =
        state.optLong("bonus_expires_ms", 0) > now()
          ? state.optBoolean("lan_pending_bonus", false)
            ? state.optInt("override_seconds", 0)
            : p.getInt("local_bonus", 0)
          : 0;
      boolean lock = paused || (bonus <= 0 && (quiet || used >= limit));
      state.put("watched_seconds", used);
      state.put("override_seconds", bonus);
      state.put(
        "remaining_seconds",
        paused ? 0 : bonus > 0 ? bonus : Math.max(0, limit - used)
      );
      state.put("status", lock ? "lock" : "allow");
      state.put(
        "lock_reason",
        !lock
          ? JSONObject.NULL
          : paused
            ? "parent_paused"
            : quiet
              ? "restricted_time"
              : "daily_limit"
      );
      ViewingSession.apply(state, policy, queue(), now());
      return state;
    }
  }

  private int minutes(String time) {
    return (
      Integer.parseInt(time.substring(0, 2)) * 60 +
      Integer.parseInt(time.substring(3))
    );
  }
}
