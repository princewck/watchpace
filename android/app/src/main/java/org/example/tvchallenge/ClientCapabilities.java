package org.example.tvchallenge;

import android.content.Context;
import org.json.JSONObject;

/** Versioned capabilities let parents distinguish installed support from server support. */
final class ClientCapabilities {

  static void append(Context context, JSONObject body, LanServer lan)
    throws Exception {
    body.put("client_mode", "native");
    body.put("session_rules_version", 1);
    body.put("update_protocol_version", 1);
    body.put("client_version_code", SelfUpdate.installedVersion(context));
    if (lan != null) {
      body.put("lan_version", 1);
      body.put("lan_certificate_sha256", lan.fingerprint());
    }
  }
}
