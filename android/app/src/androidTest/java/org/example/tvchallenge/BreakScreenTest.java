package org.example.tvchallenge;

import static org.junit.Assert.*;

import android.app.Instrumentation;
import android.content.*;
import android.graphics.Bitmap;
import android.view.View;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;

/** Disposable emulator only. No server calls or real device credentials. */
@RunWith(AndroidJUnit4.class)
public class BreakScreenTest {

  private Instrumentation instrumentation;
  private Context context;
  private SharedPreferences preferences;
  private MainActivity activity;

  @Before
  public void before() {
    instrumentation = InstrumentationRegistry.getInstrumentation();
    context = instrumentation.getTargetContext();
    context.stopService(new Intent(context, MonitorService.class));
    Recovery.cancel(context);
    preferences = NativeState.prefs(context);
    preferences.edit().clear().putString("mode", "enforce").commit();
  }

  @After
  public void after() {
    if (activity != null) instrumentation.runOnMainSync(() ->
      activity.finish()
    );
    preferences.edit().putBoolean("enabled", false).commit();
    Recovery.cancel(context);
    context.stopService(new Intent(context, MonitorService.class));
    preferences.edit().clear().commit();
  }

  private JSONObject state(boolean paused, int used, int limit, long revision)
    throws Exception {
    long now = System.currentTimeMillis();
    SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
    format.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
    return new JSONObject()
      .put("day", format.format(new Date(now)))
      .put("watched_seconds", used)
      .put("paused", paused)
      .put("override_seconds", 0)
      .put("bonus_expires_ms", 0)
      .put("server_now_ms", now)
      .put("control_revision", revision)
      .put(
        "policy_snapshot",
        new JSONObject()
          .put("daily_limit_seconds", limit)
          .put("banned_windows", new JSONArray())
      );
  }

  private void open() {
    // Disabled during creation prevents the real monitor from starting in this fixture.
    activity = (MainActivity) instrumentation.startActivitySync(
      new Intent(context, MainActivity.class).addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK
      )
    );
    preferences.edit().putBoolean("enabled", true).commit();
  }

  private void waitForClosed() throws Exception {
    long until = System.currentTimeMillis() + 2500;
    while (!activity.isFinishing() && System.currentTimeMillis() < until)
      Thread.sleep(100);
    assertTrue(
      "Allowed page should close without pressing Back",
      activity.isFinishing()
    );
  }

  @Test
  public void onlyClosesAfterMatchingAllowWasApplied() throws Exception {
    new OfflineState(context).accept(state(false, 0, 600, 2));
    preferences
      .edit()
      .putLong("applied_revision", 1)
      .putString("enforcement_result", "allowed")
      .commit();
    open();
    Thread.sleep(650);
    assertFalse(activity.isFinishing());
    preferences.edit().putLong("applied_revision", 2).commit();
    waitForClosed();
  }

  @Test
  public void unpauseStillShowsDailyLimitAndUpdatesCopy() throws Exception {
    OfflineState cache = new OfflineState(context);
    cache.accept(state(true, 600, 600, 2));
    open();
    Thread.sleep(650);
    cache.accept(state(false, 600, 600, 3));
    preferences
      .edit()
      .putLong("applied_revision", 3)
      .putString("enforcement_result", "allowed")
      .commit();
    Thread.sleep(650);
    assertFalse(
      "Unpause must not override a remaining daily limit",
      activity.isFinishing()
    );
    instrumentation.runOnMainSync(() -> {
      ArrayList<View> matches = new ArrayList<>();
      activity
        .getWindow()
        .getDecorView()
        .findViewsWithText(
          matches,
          context.getString(R.string.break_limit_title),
          View.FIND_VIEWS_WITH_TEXT
        );
      assertFalse(
        "Visible copy should explain the daily limit",
        matches.isEmpty()
      );
    });
    Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
    try (
      FileOutputStream file = new FileOutputStream(
        new File(context.getExternalFilesDir(null), "break-limit.png")
      )
    ) {
      screenshot.compress(Bitmap.CompressFormat.PNG, 100, file);
    }
    cache.accept(state(false, 600, 1200, 4));
    preferences.edit().putLong("applied_revision", 4).commit();
    waitForClosed();
  }

  @Test
  public void threeLightShadersRenderAndStopWhenInactive() throws Exception {
    new OfflineState(context).accept(state(true, 0, 600, 2));
    open();
    for (int theme = 0; theme < 3; theme++) {
      final int choice = theme;
      BreakScreenView[] screen = new BreakScreenView[1];
      instrumentation.runOnMainSync(() -> {
        screen[0] = new BreakScreenView(context, choice);
        screen[0].show(R.string.break_pause_title, R.string.break_pause_body);
        activity.setContentView(screen[0]);
        screen[0].setActive(true);
      });
      RestBackground background = screen[0].backgroundForTest();
      long until = System.currentTimeMillis() + 8000;
      while (!background.hasRendered() && System.currentTimeMillis() < until)
        Thread.sleep(100);
      assertTrue(
        "Shader " + theme + " must compile and render",
        background.hasRendered()
      );
      Thread.sleep(600);
      Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
      try (
        FileOutputStream file = new FileOutputStream(
          new File(
            context.getExternalFilesDir(null),
            "rest-theme-" + theme + ".png"
          )
        )
      ) {
        screenshot.compress(Bitmap.CompressFormat.PNG, 100, file);
      }
      instrumentation.runOnMainSync(() -> screen[0].setActive(false));
      Thread.sleep(150);
      int frames = background.renderedFrames();
      Thread.sleep(200);
      assertEquals(
        "Hidden shader must stop rendering",
        frames,
        background.renderedFrames()
      );
    }
  }

  @Test
  public void captureLocalizedReadmeScreenshots() throws Exception {
    open();
    String[] languages = { "en", "zh-CN", "ja", "ko" };
    for (String language : languages) {
      android.content.res.Configuration config =
        new android.content.res.Configuration(
          context.getResources().getConfiguration()
        );
      config.setLocale(Locale.forLanguageTag(language));
      Context localized = activity.createConfigurationContext(config);
      final BreakScreenView[] view = new BreakScreenView[1];
      instrumentation.runOnMainSync(() -> {
        android.view.WindowManager.LayoutParams windowParams = activity
          .getWindow()
          .getAttributes();
        windowParams.layoutInDisplayCutoutMode =
          android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        activity.getWindow().setAttributes(windowParams);
        activity.getWindow().setDecorFitsSystemWindows(false);
        activity
          .getWindow()
          .getInsetsController()
          .hide(android.view.WindowInsets.Type.systemBars());
        activity
          .getWindow()
          .getDecorView()
          .setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
              View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
              View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
              View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
              View.SYSTEM_UI_FLAG_FULLSCREEN |
              View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
          );
        view[0] = new BreakScreenView(localized, 1);
        view[0].show(R.string.break_rest_title, R.string.break_rest_body);
        activity.setContentView(view[0]);
        view[0].setActive(true);
        android.widget.TextView label = new android.widget.TextView(localized);
        label.setText("DEMO");
        label.setTextSize(14);
        label.setTextColor(0xff465371);
        android.widget.FrameLayout.LayoutParams params =
          new android.widget.FrameLayout.LayoutParams(
            -2,
            -2,
            android.view.Gravity.BOTTOM | android.view.Gravity.RIGHT
          );
        params.setMargins(0, 0, 28, 16);
        view[0].addView(label, params);
      });
      Thread.sleep(1400);
      Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
      assertNotNull(screenshot);
      try (
        FileOutputStream output = new FileOutputStream(
          new File(
            context.getExternalFilesDir(null),
            "readme-" + language + "-tv-break.png"
          )
        )
      ) {
        screenshot.compress(Bitmap.CompressFormat.PNG, 100, output);
      }
      instrumentation.runOnMainSync(() -> view[0].setActive(false));
    }
  }
}
