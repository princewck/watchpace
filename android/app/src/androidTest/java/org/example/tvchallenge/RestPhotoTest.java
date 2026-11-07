package org.example.tvchallenge;

import static org.junit.Assert.*;

import android.content.Context;
import android.graphics.Bitmap;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class RestPhotoTest {

  @Test
  public void completeLandscapeReplacesBackgroundAndPortraitLeavesItInPlace()
    throws Exception {
    Context context =
      InstrumentationRegistry.getInstrumentation().getTargetContext();
    RestPhoto.clear(context);
    try {
      byte[] landscape = jpeg(2304, 1296);
      assertEquals("saved", upload(context, landscape).getString("status"));
      assertArrayEquals(
        landscape,
        Files.readAllBytes(RestPhoto.file(context).toPath())
      );
      try {
        upload(context, jpeg(1296, 2304));
        fail("Portrait should be rejected");
      } catch (SecurityException expected) {
        assertArrayEquals(
          landscape,
          Files.readAllBytes(RestPhoto.file(context).toPath())
        );
      }
    } finally {
      RestPhoto.clear(context);
    }
  }

  private static byte[] jpeg(int width, int height) {
    Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
    try {
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 85, bytes));
      return bytes.toByteArray();
    } finally {
      bitmap.recycle();
    }
  }

  private static JSONObject upload(Context context, byte[] bytes)
    throws Exception {
    JSONObject envelope = new JSONObject().put("key_id", "test-parent");
    String id = UUID.randomUUID().toString();
    String hash = LanControl.hex(
      MessageDigest.getInstance("SHA-256").digest(bytes)
    );
    RestPhoto.handle(
      context,
      envelope,
      body("photo_begin", id).put("size", bytes.length).put("sha256", hash)
    );
    for (int offset = 0; offset < bytes.length; offset += 8192) {
      byte[] chunk = Arrays.copyOfRange(
        bytes,
        offset,
        Math.min(bytes.length, offset + 8192)
      );
      JSONObject request = body("photo_chunk", id)
        .put("offset", offset)
        .put("data", Base64.encodeToString(chunk, Base64.NO_WRAP));
      RestPhoto.handle(context, envelope, request);
      assertEquals(
        offset + chunk.length,
        RestPhoto.handle(context, envelope, request).getInt("received")
      );
    }
    return RestPhoto.handle(context, envelope, body("photo_finish", id));
  }

  private static JSONObject body(String kind, String id) throws Exception {
    return new JSONObject().put("kind", kind).put("upload_id", id);
  }
}
