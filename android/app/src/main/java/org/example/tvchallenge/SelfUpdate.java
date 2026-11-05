package org.example.tvchallenge;

import android.content.*;
import android.content.pm.*;
import android.os.Build;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Parent-authenticated LAN upload. Only this app, a higher version and the same signer. */
final class SelfUpdate {

  private static final long MAX_SIZE = 8 * 1024 * 1024;
  private static final long TTL = 15 * 60 * 1000;

  private static File directory(Context c) {
    return new File(c.getCacheDir(), "self-update");
  }

  private static File apk(Context c) {
    return new File(directory(c), "update.apk");
  }

  private static File metadata(Context c) {
    return new File(directory(c), "upload.json");
  }

  private static JSONObject read(Context c) throws Exception {
    try (FileInputStream input = new FileInputStream(metadata(c))) {
      byte[] bytes = new byte[4096];
      int count = input.read(bytes);
      if (count <= 0 || input.read() != -1) throw new SecurityException(
        "Invalid upload state"
      );
      return new JSONObject(
        new String(bytes, 0, count, java.nio.charset.StandardCharsets.UTF_8)
      );
    }
  }

  private static void write(Context c, JSONObject value) throws Exception {
    directory(c).mkdirs();
    File temp = new File(directory(c), "upload.tmp");
    try (FileOutputStream output = new FileOutputStream(temp)) {
      output.write(
        value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)
      );
      output.getFD().sync();
    }
    if (!temp.renameTo(metadata(c))) throw new IOException(
      "Cannot save upload"
    );
  }

  static long version(PackageInfo info) {
    return Build.VERSION.SDK_INT >= 28
      ? info.getLongVersionCode()
      : info.versionCode;
  }

  static long installedVersion(Context c) throws Exception {
    return version(c.getPackageManager().getPackageInfo(c.getPackageName(), 0));
  }

  static synchronized JSONObject handle(
    Context c,
    JSONObject envelope,
    JSONObject body
  ) throws Exception {
    String kind = body.getString("kind"),
      owner = envelope.getString("key_id"),
      id = body.optString("upload_id");
    if (!id.matches("[0-9a-fA-F-]{36}")) throw new SecurityException(
      "Invalid upload ID"
    );
    JSONObject upload;
    if (kind.equals("update_begin")) {
      long size = body.getLong("size"),
        version = body.getLong("version_code");
      String hash = body.getString("sha256");
      if (
        !(body.get("size") instanceof Number) ||
        !(body.get("version_code") instanceof Number) ||
        body.getDouble("size") != size ||
        body.getDouble("version_code") != version ||
        size < 1 ||
        size > MAX_SIZE ||
        version <= installedVersion(c) ||
        !hash.matches("[0-9a-f]{64}")
      ) throw new SecurityException("Invalid update metadata");
      try {
        JSONObject old = read(c);
        if (
          System.currentTimeMillis() - old.getLong("created_ms") < TTL &&
          !owner.equals(old.getString("owner"))
        ) throw new SecurityException(
          "Another parent is transferring an update"
        );
      } catch (FileNotFoundException ignored) {}
      upload = new JSONObject()
        .put("owner", owner)
        .put("upload_id", id)
        .put("size", size)
        .put("sha256", hash)
        .put("version_code", version)
        .put("created_ms", System.currentTimeMillis())
        .put("status", "receiving");
      directory(c).mkdirs();
      try (FileOutputStream output = new FileOutputStream(apk(c))) {
        output.getFD().sync();
      }
      write(c, upload);
    } else {
      upload = read(c);
      if (
        !owner.equals(upload.getString("owner")) ||
        !id.equals(upload.getString("upload_id")) ||
        System.currentTimeMillis() - upload.getLong("created_ms") > TTL
      ) throw new SecurityException(
        "Upload expired or belongs to another controller"
      );
      if (kind.equals("update_chunk")) {
        byte[] chunk = LanControl.base64(body.getString("data"), 12000);
        long offset = body.getLong("offset");
        if (
          chunk.length == 0 ||
          chunk.length > 8192 ||
          offset < 0 ||
          offset + chunk.length > upload.getLong("size") ||
          !"receiving".equals(upload.getString("status"))
        ) throw new SecurityException("Invalid chunk");
        try (RandomAccessFile file = new RandomAccessFile(apk(c), "rw")) {
          if (offset == file.length()) {
            file.seek(offset);
            file.write(chunk);
            file.getFD().sync();
          } else if (offset + chunk.length <= file.length()) {
            byte[] existing = new byte[chunk.length];
            file.seek(offset);
            file.readFully(existing);
            if (
              !MessageDigest.isEqual(existing, chunk)
            ) throw new SecurityException("Conflicting chunk");
          } else throw new SecurityException("Out of order chunk");
        }
      } else if (kind.equals("update_finish")) {
        verify(c, upload);
        upload.put("status", "awaiting_tv_confirmation");
        write(c, upload);
        Intent intent = new Intent(c, UpdateActivity.class).addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK
        );
        if (
          ControlAccessibilityService.instance != null
        ) ControlAccessibilityService.instance.startActivity(intent);
        else c.startActivity(intent);
      } else if (!kind.equals("update_status")) throw new SecurityException(
        "Unknown update operation"
      );
    }
    return new JSONObject()
      .put("status", upload.getString("status"))
      .put("received", apk(c).length())
      .put("size", upload.getLong("size"))
      .put("version_code", upload.getLong("version_code"));
  }

  private static Set<String> signatures(PackageInfo info) throws Exception {
    android.content.pm.Signature[] values =
      Build.VERSION.SDK_INT >= 28
        ? info.signingInfo.getApkContentsSigners()
        : info.signatures;
    if (values == null || values.length == 0) throw new SecurityException(
      "Unsigned APK"
    );
    Set<String> result = new HashSet<>();
    for (android.content.pm.Signature value : values)
      result.add(
        LanControl.hex(
          MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        )
      );
    return result;
  }

  static synchronized void verify(Context c, JSONObject upload)
    throws Exception {
    if (
      System.currentTimeMillis() - upload.getLong("created_ms") > TTL ||
      apk(c).length() != upload.getLong("size")
    ) throw new SecurityException("Incomplete or expired APK");
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (FileInputStream input = new FileInputStream(apk(c))) {
      byte[] buffer = new byte[8192];
      int count;
      while ((count = input.read(buffer)) != -1)
        digest.update(buffer, 0, count);
    }
    if (
      !LanControl.hex(digest.digest()).equals(upload.getString("sha256"))
    ) throw new SecurityException("APK hash mismatch");
    int flags =
      Build.VERSION.SDK_INT >= 28
        ? PackageManager.GET_SIGNING_CERTIFICATES
        : PackageManager.GET_SIGNATURES;
    PackageManager pm = c.getPackageManager();
    PackageInfo candidate = pm.getPackageArchiveInfo(apk(c).getPath(), flags);
    if (
      candidate == null ||
      !c.getPackageName().equals(candidate.packageName) ||
      version(candidate) != upload.getLong("version_code") ||
      version(candidate) <= installedVersion(c) ||
      !signatures(candidate).equals(
        signatures(pm.getPackageInfo(c.getPackageName(), flags))
      )
    ) throw new SecurityException("Wrong app, signature or version");
  }

  static synchronized int prepareInstall(Context c) throws Exception {
    JSONObject upload = read(c);
    verify(c, upload);
    if (
      !c.getPackageManager().canRequestPackageInstalls()
    ) throw new SecurityException("Installation permission required");
    PackageInstaller installer = c.getPackageManager().getPackageInstaller();
    PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
      PackageInstaller.SessionParams.MODE_FULL_INSTALL
    );
    params.setAppPackageName(c.getPackageName());
    params.setSize(apk(c).length());
    if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(
      PackageInstaller.SessionParams.USER_ACTION_REQUIRED
    );
    SharedPreferences saved = c.getSharedPreferences(
      "self-update",
      Context.MODE_PRIVATE
    );
    int previous = saved.getInt("install_session", -1);
    if (previous >= 0) try {
      installer.abandonSession(previous);
    } catch (Exception ignored) {}
    int id = installer.createSession(params);
    saved.edit().putInt("install_session", id).commit();
    try (
      PackageInstaller.Session session = installer.openSession(id);
      FileInputStream input = new FileInputStream(apk(c));
      OutputStream output = session.openWrite("base.apk", 0, apk(c).length())
    ) {
      byte[] buffer = new byte[8192];
      int count;
      while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
      session.fsync(output);
    } catch (Exception error) {
      installer.abandonSession(id);
      throw error;
    }
    return id;
  }

  static synchronized void discard(Context c) {
    SharedPreferences saved = c.getSharedPreferences(
      "self-update",
      Context.MODE_PRIVATE
    );
    int session = saved.getInt("install_session", -1);
    if (session >= 0) try {
      c.getPackageManager().getPackageInstaller().abandonSession(session);
    } catch (Exception ignored) {}
    saved.edit().clear().commit();
    apk(c).delete();
    metadata(c).delete();
  }
}
