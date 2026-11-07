package org.example.tvchallenge;

import android.content.Context;
import android.graphics.BitmapFactory;
import android.os.SystemClock;
import android.util.AtomicFile;
import java.io.*;
import java.security.MessageDigest;
import java.util.Arrays;
import org.json.JSONObject;

/** One bounded upload over the existing authenticated LAN connection. */
final class RestPhoto {

  private static final int MAX_BYTES = 2 * 1024 * 1024;
  private static Transfer pending;

  private static final class Transfer {

    final String id, owner, hash;
    final byte[] bytes;
    final long expires = SystemClock.elapsedRealtime() + 300_000;
    int received;
    boolean saved;

    Transfer(String id, String owner, String hash, int size) {
      this.id = id;
      this.owner = owner;
      this.hash = hash;
      bytes = new byte[size];
    }
  }

  static File file(Context context) {
    return new File(context.getFilesDir(), "rest-background.jpg");
  }

  static synchronized void clear(Context context) {
    pending = null;
    new AtomicFile(file(context)).delete();
  }

  static synchronized JSONObject handle(
    Context context,
    JSONObject envelope,
    JSONObject body
  ) throws Exception {
    String kind = body.getString("kind");
    String id = body.getString("upload_id");
    String owner = envelope.getString("key_id");
    if (!id.matches("[0-9a-fA-F-]{36}")) throw new SecurityException(
      "Invalid upload ID"
    );
    if (
      pending != null && SystemClock.elapsedRealtime() >= pending.expires
    ) pending = null;
    if (kind.equals("photo_begin")) {
      int size = body.getInt("size");
      String hash = body.getString("sha256");
      if (
        size < 1 || size > MAX_BYTES || !hash.matches("[0-9a-f]{64}")
      ) throw new SecurityException("Invalid photo metadata");
      if (pending != null && pending.id.equals(id)) {
        if (
          !pending.owner.equals(owner) ||
          pending.bytes.length != size ||
          !pending.hash.equals(hash)
        ) throw new SecurityException("Upload ID reused");
      } else {
        if (
          pending != null && !pending.saved && !pending.owner.equals(owner)
        ) throw new SecurityException(
          "Another controller is transferring a photo"
        );
        pending = new Transfer(id, owner, hash, size);
      }
    }
    Transfer transfer = pending;
    if (
      transfer == null ||
      !transfer.id.equals(id) ||
      !transfer.owner.equals(owner)
    ) throw new SecurityException("Photo upload expired");
    if (kind.equals("photo_chunk")) {
      byte[] chunk = LanControl.base64(body.getString("data"), 12000);
      int offset = body.getInt("offset");
      if (
        chunk.length == 0 ||
        chunk.length > 8192 ||
        offset < 0 ||
        offset > transfer.bytes.length - chunk.length
      ) throw new SecurityException("Invalid photo chunk");
      int end = offset + chunk.length;
      if (offset == transfer.received && !transfer.saved) {
        System.arraycopy(chunk, 0, transfer.bytes, offset, chunk.length);
        transfer.received = end;
      } else if (
        end > transfer.received ||
        !Arrays.equals(chunk, Arrays.copyOfRange(transfer.bytes, offset, end))
      ) {
        throw new SecurityException("Unexpected photo chunk");
      }
    }
    if (kind.equals("photo_finish") && !transfer.saved) {
      if (
        transfer.received != transfer.bytes.length ||
        !transfer.hash.equals(
          LanControl.hex(
            MessageDigest.getInstance("SHA-256").digest(transfer.bytes)
          )
        )
      ) throw new SecurityException("Photo integrity check failed");
      BitmapFactory.Options bounds = new BitmapFactory.Options();
      bounds.inJustDecodeBounds = true;
      BitmapFactory.decodeByteArray(
        transfer.bytes,
        0,
        transfer.bytes.length,
        bounds
      );
      if (
        !"image/jpeg".equals(bounds.outMimeType) ||
        bounds.outWidth <= 2048 ||
        bounds.outWidth > 3840 ||
        bounds.outHeight < 1080 ||
        bounds.outWidth <= bounds.outHeight
      ) throw new SecurityException("Unsupported photo dimensions");
      AtomicFile target = new AtomicFile(file(context));
      FileOutputStream output = target.startWrite();
      try {
        output.write(transfer.bytes);
        target.finishWrite(output);
      } catch (IOException error) {
        target.failWrite(output);
        throw error;
      }
      transfer.saved = true;
    }
    return new JSONObject()
      .put("status", transfer.saved ? "saved" : "receiving")
      .put("received", transfer.received)
      .put("size", transfer.bytes.length)
      .put("version_code", 0);
  }
}
