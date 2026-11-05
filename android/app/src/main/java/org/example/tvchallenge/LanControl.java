package org.example.tvchallenge;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.util.*;
import org.json.*;

/** Signed, bounded local controls. No ADB, shell, URL or arbitrary-code operation exists. */
final class LanControl {

  static final Object LOCK = NativeState.class;
  private static final String UUID_RE =
    "(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

  static String signingText(JSONObject e) throws Exception {
    return (
      "FamilyTV-LAN/1\n" +
      e.getString("device") +
      "\n" +
      e.getString("key_id") +
      "\n" +
      e.getString("request_id") +
      "\n" +
      e.getLong("issued_ms") +
      "\n" +
      e.getLong("base_revision") +
      "\n" +
      e.getString("payload")
    );
  }

  static String hex(byte[] bytes) {
    StringBuilder s = new StringBuilder();
    for (byte b : bytes) s.append(String.format(Locale.ROOT, "%02x", b & 255));
    return s.toString();
  }

  static String digest(String value) throws Exception {
    return hex(
      MessageDigest.getInstance("SHA-256").digest(
        value.getBytes(StandardCharsets.UTF_8)
      )
    );
  }

  static byte[] base64(String value, int max) throws Exception {
    if (
      value.length() > max || !value.matches("[A-Za-z0-9+/]+={0,2}")
    ) throw new SecurityException("Invalid encoding");
    return Base64.decode(value, Base64.NO_WRAP);
  }

  static JSONArray queue(SharedPreferences p) throws Exception {
    return new JSONArray(p.getString("lan_queue", "[]"));
  }

  static void validatePolicy(JSONObject p) throws Exception {
    String[] seconds = {
      "initial_seconds",
      "first_reward_seconds",
      "second_reward_seconds",
      "repeat_seconds",
      "rest_reset_seconds",
      "default_grant_seconds",
      "daily_limit_seconds",
    };
    for (String key : seconds) {
      if (key.equals("daily_limit_seconds") && p.isNull(key)) continue;
      Object v = p.get(key);
      if (
        !(v instanceof Number) ||
        ((Number) v).doubleValue() != ((Number) v).longValue() ||
        p.getLong(key) < (key.equals("daily_limit_seconds") ? 0 : 60) ||
        p.getLong(key) > 86400
      ) throw new SecurityException("Invalid policy");
    }
    if (!p.isNull("session_limit_seconds")) {
      Object value = p.get("session_limit_seconds");
      if (
        !(value instanceof Integer) ||
        p.getInt("session_limit_seconds") < 60 ||
        p.getInt("session_limit_seconds") > 86400
      ) throw new SecurityException("Invalid session limit");
    }
    if (p.has("session_break_seconds") && !p.isNull("session_break_seconds")) {
      Object value = p.get("session_break_seconds");
      if (
        !(value instanceof Integer) ||
        p.getInt("session_break_seconds") < 300 ||
        p.getInt("session_break_seconds") > 86400
      ) throw new SecurityException("Invalid session break");
    }
    JSONArray windows = p.getJSONArray("banned_windows");
    if (windows.length() > 32) throw new SecurityException("Too many windows");
    for (int i = 0; i < windows.length(); i++) {
      JSONObject w = windows.getJSONObject(i);
      if (
        w.getString("label").length() > 64 ||
        !(w.get("enabled") instanceof Boolean) ||
        !w.getString("start").matches("([01][0-9]|2[0-3]):[0-5][0-9]") ||
        !w.getString("end").matches("([01][0-9]|2[0-3]):[0-5][0-9]")
      ) throw new SecurityException("Invalid window");
      JSONArray days = w.getJSONArray("days");
      if (days.length() < 1 || days.length() > 7) throw new SecurityException(
        "Invalid days"
      );
      for (int j = 0; j < days.length(); j++) {
        Object day = days.get(j);
        if (
          !(day instanceof Integer) || days.getInt(j) < 0 || days.getInt(j) > 6
        ) throw new SecurityException("Invalid day");
      }
    }
  }

  static JSONObject verify(Context c, JSONObject e) throws Exception {
    SharedPreferences p = NativeState.prefs(c);
    long now = new OfflineState(c).now();
    if (
      !NativeState.enabled(c) ||
      e.getInt("v") != 1 ||
      !p.getString("device", "").equals(e.getString("device")) ||
      !e.getString("key_id").matches(UUID_RE) ||
      !e.getString("request_id").matches(UUID_RE)
    ) throw new SecurityException("Unpaired controller");
    for (String name : new String[] { "issued_ms", "base_revision" }) {
      Object n = e.get(name);
      if (
        !(n instanceof Number) ||
        ((Number) n).doubleValue() != ((Number) n).longValue()
      ) throw new SecurityException("Invalid number");
    }
    if (
      e.getLong("base_revision") < 1 ||
      e.getLong("issued_ms") > now + 30000 ||
      e.getLong("issued_ms") < now - 120000
    ) throw new SecurityException("Expired command");
    JSONObject cached = new JSONObject(p.getString("cached_state", "{}"));
    JSONArray keys = cached.optJSONArray("lan_keys");
    String der = null;
    if (keys != null) for (int i = 0; i < keys.length(); i++) {
      JSONObject key = keys.getJSONObject(i);
      if (
        key.getString("key_id").equals(e.getString("key_id")) &&
        key.getLong("expires_ms") > now
      ) der = key.getString("public_key_der");
    }
    if (der == null) throw new SecurityException(
      "Controller revoked or not received yet"
    );
    PublicKey key = KeyFactory.getInstance("EC").generatePublic(
      new X509EncodedKeySpec(base64(der, 180))
    );
    if (
      !(key instanceof java.security.interfaces.ECPublicKey) ||
      !((java.security.interfaces.ECPublicKey) key)
        .getParams()
        .getOrder()
        .toString(16)
        .equals(
          "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
        )
    ) throw new SecurityException("P-256 required");
    Signature signature = Signature.getInstance("SHA256withECDSA");
    signature.initVerify(key);
    signature.update(signingText(e).getBytes(StandardCharsets.UTF_8));
    if (
      !signature.verify(base64(e.getString("signature"), 120))
    ) throw new SecurityException("Invalid signature");
    JSONObject body = new JSONObject(
      new String(base64(e.getString("payload"), 20000), StandardCharsets.UTF_8)
    );
    String kind = body.getString("kind");
    if (
      kind.equals("status") ||
      kind.matches("update_(begin|chunk|finish|status)")
    ) return body;
    if (kind.equals("pause")) {
      if (!(body.get("paused") instanceof Boolean)) throw new SecurityException(
        "Boolean required"
      );
    } else if (kind.equals("grant")) {
      Object value = body.get("seconds");
      if (
        !(value instanceof Integer) ||
        body.getInt("seconds") < 60 ||
        body.getInt("seconds") > 7200
      ) throw new SecurityException("Invalid allowance");
    } else if (kind.equals("policy")) validatePolicy(
      body.getJSONObject("policy")
    );
    else throw new SecurityException("Unsupported command");
    return body;
  }

  static JSONObject handle(Context c, JSONObject e) throws Exception {
    synchronized (LOCK) {
      SharedPreferences p = NativeState.prefs(c);
      JSONObject body = verify(c, e);
      String kind = body.getString("kind");
      if (kind.startsWith("update_")) {
        JSONObject receipt = result(c, false);
        receipt.put("update", SelfUpdate.handle(c, e, body));
        return receipt;
      }
      if (!kind.equals("status")) {
        String id = e.getString("request_id"),
          digest = digest(signingText(e));
        JSONArray history = new JSONArray(p.getString("lan_history", "[]"));
        for (int i = 0; i < history.length(); i++) {
          JSONObject old = history.getJSONObject(i);
          if (old.getString("id").equals(id)) {
            if (
              !old.getString("digest").equals(digest)
            ) throw new SecurityException("Request ID reused");
            return result(c, true);
          }
        }
        JSONObject cached = new JSONObject(p.getString("cached_state", "{}"));
        if (
          e.getLong("base_revision") != cached.getLong("control_revision")
        ) throw new SecurityException("Configuration changed; refresh");
        JSONArray pending = queue(p);
        if (pending.length() >= 16) throw new SecurityException(
          "Pending synchronization queue full"
        );
        pending.put(e);
        JSONArray kept = new JSONArray();
        for (
          int i = Math.max(0, history.length() - 127);
          i < history.length();
          i++
        ) kept.put(history.get(i));
        kept.put(new JSONObject().put("id", id).put("digest", digest));
        SharedPreferences.Editor edit = p
          .edit()
          .putString("lan_queue", pending.toString())
          .putString("lan_history", kept.toString())
          .putString("lan_last_request", id)
          .putString("lan_execution", "waiting")
          .putString("lan_sync_outcome", "pending");
        if (kind.equals("grant")) edit.putInt(
          "lan_bonus_remaining",
          body.getInt("seconds")
        );
        if (!edit.commit()) throw new java.io.IOException(
          "Local command not persisted"
        );
        MonitorService.signalLocalCommand();
      }
      return result(c, false);
    }
  }

  static JSONObject result(Context c, boolean duplicate) throws Exception {
    SharedPreferences p = NativeState.prefs(c);
    return new JSONObject()
      .put("device", p.getString("device", ""))
      .put("accepted", true)
      .put("duplicate", duplicate)
      .put("state", new OfflineState(c).state())
      .put("last_request_id", p.getString("lan_last_request", ""))
      .put("execution_result", p.getString("lan_execution", "waiting"))
      .put("pending_sync", queue(p).length())
      .put("sync_outcome", p.getString("lan_sync_outcome", "none"));
  }

  static void reconcile(SharedPreferences p, JSONArray results)
    throws Exception {
    if (results == null) return;
    Set<String> accepted = new HashSet<>();
    boolean rejected = false;
    long target = 0;
    for (int i = 0; i < results.length(); i++) {
      JSONObject r = results.getJSONObject(i);
      if (r.optString("status").equals("accepted")) {
        accepted.add(r.getString("request_id"));
        if (
          r.getString("request_id").equals(p.getString("lan_last_request", ""))
        ) target = r.getLong("revision");
      } else rejected = true;
    }
    JSONArray old = queue(p),
      kept = new JSONArray();
    if (!rejected) for (int i = 0; i < old.length(); i++) {
      JSONObject e = old.getJSONObject(i);
      if (!accepted.contains(e.getString("request_id"))) kept.put(e);
    }
    SharedPreferences.Editor edit = p
      .edit()
      .putString("lan_queue", kept.toString());
    if (rejected) edit
      .putString("lan_sync_outcome", "conflict")
      .putString("lan_execution", "superseded");
    else if (old.length() > 0 && kept.length() == 0) edit.putString(
      "lan_sync_outcome",
      "synced"
    );
    if (target > 0) edit.putLong("lan_target_revision", target);
    if (!edit.commit()) throw new java.io.IOException("Sync result not saved");
  }

  static JSONObject overlay(SharedPreferences p, JSONObject state, long now)
    throws Exception {
    JSONArray queue = queue(p);
    for (int i = 0; i < queue.length(); i++) {
      JSONObject e = queue.getJSONObject(i),
        body = new JSONObject(
          new String(
            base64(e.getString("payload"), 20000),
            StandardCharsets.UTF_8
          )
        );
      String kind = body.getString("kind");
      if (kind.equals("pause")) state.put("paused", body.getBoolean("paused"));
      if (kind.equals("policy")) state.put(
        "policy_snapshot",
        body.getJSONObject("policy")
      );
      if (kind.equals("grant")) {
        state.put("lan_pending_bonus", true);
        state.put(
          "override_seconds",
          Math.max(0, p.getInt("lan_bonus_remaining", 0))
        );
        state.put("bonus_expires_ms", e.getLong("issued_ms") + 86400000);
      }
    }
    String id = p.getString("lan_last_request", "");
    if (
      !id.isEmpty() &&
      (queue.length() > 0 ||
        state.optLong("control_revision") ==
          p.getLong("lan_target_revision", -1))
    ) state.put("lan_request_id", id);
    return state;
  }

  static void executed(Context c, JSONObject state, String result) {
    synchronized (LOCK) {
      try {
        String id = state.optString("lan_request_id", "");
        if (
          !id.isEmpty() &&
          id.equals(NativeState.prefs(c).getString("lan_last_request", ""))
        ) NativeState.prefs(c)
          .edit()
          .putString("lan_execution", result)
          .apply();
      } catch (Exception ignored) {}
    }
  }
}
