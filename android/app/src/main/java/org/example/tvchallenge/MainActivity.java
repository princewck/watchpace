package org.example.tvchallenge;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import org.json.JSONObject;

/** Native, offline-capable break screen. It never resumes media automatically. */
public class MainActivity extends Activity {

  private final Handler handler = new Handler(Looper.getMainLooper());
  private BreakScreenView screen;
  private SharedPreferences preferences;
  private boolean wasEnabled;
  private final SharedPreferences.OnSharedPreferenceChangeListener changed = (
    p,
    key
  ) -> handler.post(this::render);
  private final Runnable refresh = new Runnable() {
    @Override
    public void run() {
      render();
      if (!isFinishing()) handler.postDelayed(this, 500);
    }
  };

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    preferences = NativeState.prefs(this);
    wasEnabled = NativeState.enabled(this);
    if (wasEnabled) MonitorService.start(this);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    screen = new BreakScreenView(this);
    setContentView(screen);
  }

  @Override
  protected void onResume() {
    super.onResume();
    preferences.registerOnSharedPreferenceChangeListener(changed);
    screen.setActive(true);
    handler.post(refresh);
  }

  @Override
  protected void onPause() {
    screen.setActive(false);
    preferences.unregisterOnSharedPreferenceChangeListener(changed);
    handler.removeCallbacksAndMessages(null);
    super.onPause();
  }

  private void render() {
    if (isFinishing() || screen == null) return;
    boolean enabled = NativeState.enabled(this);
    if (wasEnabled && !enabled) {
      finish();
      return;
    }
    wasEnabled |= enabled;
    try {
      JSONObject state = new OfflineState(this).state();
      if (
        BreakScreenState.canDismiss(
          state,
          enabled,
          preferences.getString("mode", "observe"),
          preferences.getLong("applied_revision", 0),
          preferences.getString("enforcement_result", "")
        )
      ) {
        finish();
        return;
      }
      if ("allow".equals(state.optString("status"))) {
        show(R.string.break_allow_title, R.string.break_allow_body);
      } else switch (state.optString("lock_reason")) {
        case "session_limit":
          screen.showSession(
            state.optInt("session_break_remaining_seconds", 300)
          );
          break;
        case "parent_paused":
          show(R.string.break_pause_title, R.string.break_pause_body);
          break;
        case "daily_limit":
          show(R.string.break_limit_title, R.string.break_limit_body);
          break;
        case "restricted_time":
          show(R.string.break_rest_title, R.string.break_rest_body);
          break;
        default:
          show(R.string.break_wait_title, R.string.break_wait_body);
      }
    } catch (Exception unavailable) {
      show(R.string.break_wait_title, R.string.break_wait_body);
    }
  }

  private void show(int heading, int message) {
    screen.show(heading, message);
  }
}
