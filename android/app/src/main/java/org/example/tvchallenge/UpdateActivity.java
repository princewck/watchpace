package org.example.tvchallenge;

import android.app.*;
import android.content.*;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.widget.*;

/** User-visible installer: no silent install, uninstallation or preference reset. */
public class UpdateActivity extends Activity {

  private static java.lang.ref.WeakReference<UpdateActivity> current =
    new java.lang.ref.WeakReference<>(null);
  private TextView message;
  private Button install;
  private boolean waiting;

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    current = new java.lang.ref.WeakReference<>(this);
    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setPadding(64, 48, 64, 48);
    content.setBackgroundColor(0xfff4f6ff);
    TextView title = new TextView(this);
    title.setText(R.string.update_title);
    title.setTextSize(30);
    title.setTextColor(0xff18223d);
    content.addView(title);
    message = new TextView(this);
    message.setTextSize(20);
    message.setTextColor(0xff465371);
    content.addView(message);
    install = new Button(this);
    install.setOnClickListener(v -> proceed());
    content.addView(install);
    Button cancel = new Button(this);
    cancel.setText(android.R.string.cancel);
    cancel.setOnClickListener(v -> {
      SelfUpdate.discard(this);
      finish();
    });
    content.addView(cancel);
    setContentView(content);
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (!waiting) render();
  }

  private void render() {
    boolean allowed = getPackageManager().canRequestPackageInstalls();
    message.setText(
      allowed ? R.string.update_confirm_body : R.string.update_permission_body
    );
    install.setText(
      allowed ? R.string.update_install : R.string.update_open_permission
    );
  }

  private void proceed() {
    if (!getPackageManager().canRequestPackageInstalls()) {
      try {
        startActivity(
          new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getPackageName())
          )
        );
      } catch (Exception unavailable) {
        message.setText(R.string.update_permission_unavailable);
      }
      return;
    }
    try {
      int id = SelfUpdate.prepareInstall(this);
      Intent callback = new Intent(this, UpdateResultReceiver.class).setAction(
        getPackageName() + ".UPDATE_RESULT"
      );
      int flags =
        PendingIntent.FLAG_UPDATE_CURRENT |
        (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
      PendingIntent result = PendingIntent.getBroadcast(
        this,
        id,
        callback,
        flags
      );
      try (
        PackageInstaller.Session session = getPackageManager()
          .getPackageInstaller()
          .openSession(id)
      ) {
        waiting = true;
        install.setEnabled(false);
        message.setText(R.string.update_waiting);
        session.commit(result.getIntentSender());
      }
    } catch (Exception rejected) {
      waiting = false;
      message.setText(R.string.update_failed);
      install.setEnabled(true);
    }
  }

  static void result(Context c, Intent result) {
    UpdateActivity screen = current.get();
    int status = result.getIntExtra(
      PackageInstaller.EXTRA_STATUS,
      PackageInstaller.STATUS_FAILURE
    );
    if (status == PackageInstaller.STATUS_SUCCESS) {
      SelfUpdate.discard(c);
      if (screen != null) screen.finish();
      return;
    }
    if (screen == null || screen.isFinishing()) return;
    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      Intent confirm =
        Build.VERSION.SDK_INT >= 33
          ? result.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
          : result.getParcelableExtra(Intent.EXTRA_INTENT);
      if (confirm != null) {
        try {
          screen.startActivity(confirm);
          return;
        } catch (Exception ignored) {}
      }
    }
    screen.waiting = false;
    screen.install.setEnabled(true);
    screen.message.setText(R.string.update_failed);
  }
}
