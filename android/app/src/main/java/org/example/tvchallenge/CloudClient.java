package org.example.tvchallenge;

import android.content.Context;
import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** HTTPS transport; monitoring and local enforcement do not run on this thread. */
final class CloudClient {

  static final class DeviceRevoked extends IOException {}

  static JSONObject request(Context context, String path, JSONObject body)
    throws Exception {
    HttpsURLConnection c = (HttpsURLConnection) new URL(
      NativeState.origin(context) + path
    ).openConnection(java.net.Proxy.NO_PROXY);
    c.setConnectTimeout(2000);
    c.setReadTimeout(2000);
    c.setInstanceFollowRedirects(false);
    c.setRequestProperty("Accept", "application/json");
    try {
      if (body != null) {
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty(
          "Authorization",
          "Bearer " + NativeState.prefs(context).getString("token", "")
        );
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        c.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream out = c.getOutputStream()) {
          out.write(bytes);
        }
      }
      if (c.getResponseCode() == 401) throw new DeviceRevoked();
      if (c.getResponseCode() != 200) throw new IOException("Non-200");
      try (
        InputStream in = c.getInputStream();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream()
      ) {
        byte[] b = new byte[1024];
        int n;
        while ((n = in.read(b)) != -1) {
          if (bytes.size() + n > 16384) throw new IOException("Too large");
          bytes.write(b, 0, n);
        }
        return new JSONObject(bytes.toString("UTF-8"));
      }
    } finally {
      c.disconnect();
    }
  }
}
