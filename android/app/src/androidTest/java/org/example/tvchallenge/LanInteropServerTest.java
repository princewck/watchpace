package org.example.tvchallenge;

import android.os.Bundle;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import org.json.*;
import org.junit.*;

/** Explicit opt-in integration fixture, never enabled in the production APK. */
public class LanInteropServerTest extends LanRuntimeTest {

  @Test
  public void serveForIOS() throws Exception {
    Assume.assumeTrue(
      "Run explicitly with lan_interop=1",
      "1".equals(
        InstrumentationRegistry.getArguments().getString("lan_interop")
      )
    );
    JSONObject vector = fixture.getJSONObject("envelope"),
      s = state(System.currentTimeMillis(), false, 5400, 0);
    s.put(
      "lan_keys",
      new JSONArray().put(
        new JSONObject()
          .put("key_id", vector.getString("key_id"))
          .put("public_key_der", fixture.getString("public_key_der"))
          .put("expires_ms", System.currentTimeMillis() + 86400000)
      )
    );
    cache.accept(s);
    server = new LanServer(c);
    server.update(s.getJSONArray("lan_keys"));
    File done = new File(c.getExternalFilesDir(null), "lan-interop-done");
    done.delete();
    Bundle status = new Bundle();
    status.putString(
      "lan_fixture",
      new JSONObject()
        .put("port", server.port())
        .put("certificate_sha256", server.fingerprint())
        .toString()
    );
    InstrumentationRegistry.getInstrumentation().sendStatus(0, status);
    long end = System.currentTimeMillis() + 240000;
    while (!done.exists() && System.currentTimeMillis() < end)
      Thread.sleep(250);
    org.junit.Assert.assertTrue(
      "iOS integration did not signal completion",
      done.exists()
    );
    done.delete();
  }
}
