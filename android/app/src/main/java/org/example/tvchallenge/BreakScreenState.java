package org.example.tvchallenge;

import org.json.JSONObject;

/** Only dismiss after the matching rule has actually been applied locally. */
final class BreakScreenState {

  static boolean canDismiss(
    JSONObject state,
    boolean enabled,
    String mode,
    long appliedRevision,
    String result
  ) {
    long revision = state.optLong("control_revision", -1);
    return (
      enabled &&
      "enforce".equals(mode) &&
      "allow".equals(state.optString("status")) &&
      revision >= 1 &&
      appliedRevision == revision &&
      "allowed".equals(result)
    );
  }
}
