package org.example.tvchallenge;

import android.content.*;

/** Explicit private PendingIntent callback from Android's package installer. */
public class UpdateResultReceiver extends BroadcastReceiver {

  @Override
  public void onReceive(Context c, Intent intent) {
    UpdateActivity.result(c, intent);
  }
}
