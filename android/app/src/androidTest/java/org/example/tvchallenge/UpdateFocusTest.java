package org.example.tvchallenge;

import static org.junit.Assert.*;

import android.app.Instrumentation;
import android.content.Intent;
import android.view.KeyEvent;
import android.widget.Button;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class UpdateFocusTest {

  @Test
  public void remoteFocusUsesWhiteTextOnlyOnTheSelectedButton() {
    Instrumentation instrument = InstrumentationRegistry.getInstrumentation();
    UpdateActivity page = (UpdateActivity) instrument.startActivitySync(
      new Intent(instrument.getTargetContext(), UpdateActivity.class).addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK
      )
    );
    try {
      instrument.waitForIdleSync();
      Button first = (Button) page.getCurrentFocus();
      assertNotNull(first);
      assertEquals(0xffffffff, first.getCurrentTextColor());
      instrument.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);
      instrument.waitForIdleSync();
      Button second = (Button) page.getCurrentFocus();
      assertNotNull(second);
      assertNotSame(first, second);
      assertEquals(
        page.getString(android.R.string.cancel),
        second.getText().toString()
      );
      assertEquals(0xffffffff, second.getCurrentTextColor());
      assertEquals(0xff18223d, first.getCurrentTextColor());
    } finally {
      instrument.runOnMainSync(page::finish);
    }
  }
}
