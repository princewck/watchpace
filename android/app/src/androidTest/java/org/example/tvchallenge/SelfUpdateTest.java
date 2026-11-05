package org.example.tvchallenge;

import static org.junit.Assert.*;

import android.content.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.security.MessageDigest;
import java.util.UUID;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SelfUpdateTest {

  private Context context;
  private JSONObject envelope;
  private String id;

  @Before
  public void before() throws Exception {
    context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    SelfUpdate.discard(context);
    id = UUID.randomUUID().toString();
    envelope = new JSONObject().put("key_id", UUID.randomUUID().toString());
  }

  @After
  public void after() {
    SelfUpdate.discard(context);
  }

  private JSONObject begin(int size, String hash, long version)
    throws Exception {
    return new JSONObject()
      .put("kind", "update_begin")
      .put("upload_id", id)
      .put("size", size)
      .put("sha256", hash)
      .put("version_code", version);
  }

  @Test
  public void rejectsDowngradeOutOfOrderWrongOwnerAndChangedReplay()
    throws Exception {
    long current = SelfUpdate.installedVersion(context);
    try {
      SelfUpdate.handle(
        context,
        envelope,
        begin(4, new String(new char[64]).replace((char) 0, '0'), current)
      );
      fail();
    } catch (SecurityException expected) {}
    SelfUpdate.handle(
      context,
      envelope,
      begin(4, new String(new char[64]).replace((char) 0, '0'), current + 1)
    );
    JSONObject chunk = new JSONObject()
      .put("kind", "update_chunk")
      .put("upload_id", id)
      .put("offset", 1)
      .put("data", "AQI=");
    try {
      SelfUpdate.handle(context, envelope, chunk);
      fail();
    } catch (SecurityException expected) {}
    chunk.put("offset", 0);
    assertEquals(
      2,
      SelfUpdate.handle(context, envelope, chunk).getInt("received")
    );
    assertEquals(
      2,
      SelfUpdate.handle(context, envelope, chunk).getInt("received")
    );
    try {
      SelfUpdate.handle(
        context,
        new JSONObject().put("key_id", UUID.randomUUID().toString()),
        chunk
      );
      fail();
    } catch (SecurityException expected) {}
    chunk.put("data", "AwQ=");
    try {
      SelfUpdate.handle(context, envelope, chunk);
      fail();
    } catch (SecurityException expected) {}
  }

  @Test
  public void validHashCannotTurnAnOldApkIntoANewerVersion() throws Exception {
    File source = new File(context.getApplicationInfo().sourceDir);
    byte[] bytes = new byte[(int) source.length()];
    try (
      DataInputStream input = new DataInputStream(new FileInputStream(source))
    ) {
      input.readFully(bytes);
    }
    String hash = LanControl.hex(
      MessageDigest.getInstance("SHA-256").digest(bytes)
    );
    SelfUpdate.handle(
      context,
      envelope,
      begin(bytes.length, hash, SelfUpdate.installedVersion(context) + 1)
    );
    for (int offset = 0; offset < bytes.length; offset += 8192) {
      byte[] chunk = java.util.Arrays.copyOfRange(
        bytes,
        offset,
        Math.min(bytes.length, offset + 8192)
      );
      SelfUpdate.handle(
        context,
        envelope,
        new JSONObject()
          .put("kind", "update_chunk")
          .put("upload_id", id)
          .put("offset", offset)
          .put(
            "data",
            android.util.Base64.encodeToString(
              chunk,
              android.util.Base64.NO_WRAP
            )
          )
      );
    }
    try {
      SelfUpdate.handle(
        context,
        envelope,
        new JSONObject().put("kind", "update_finish").put("upload_id", id)
      );
      fail("Declared version must match the APK and be higher than installed");
    } catch (SecurityException expected) {}
  }
}
