package org.example.tvchallenge;

import static org.junit.Assert.*;

import android.content.*;
import android.content.SharedPreferences;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.net.ssl.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LanRuntimeTest {

  Context c;
  SharedPreferences p;
  OfflineState cache;
  JSONObject fixture;
  KeyPair phone;
  String keyID;
  LanServer server;

  @Before
  public void before() throws Exception {
    c = InstrumentationRegistry.getInstrumentation().getTargetContext();
    c.stopService(new Intent(c, MonitorService.class));
    Recovery.cancel(c);
    p = NativeState.prefs(c);
    p.edit()
      .clear()
      .putBoolean("enabled", true)
      .putString("device", "tv_lan_fixture")
      .commit();
    cache = new OfflineState(c);
    try (
      InputStream in = InstrumentationRegistry.getInstrumentation()
        .getContext()
        .getAssets()
        .open("LanVector.json")
    ) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] b = new byte[1024];
      int n;
      while ((n = in.read(b)) != -1) out.write(b, 0, n);
      fixture = new JSONObject(out.toString("UTF-8"));
    }
    KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
    generator.initialize(
      new java.security.spec.ECGenParameterSpec("secp256r1")
    );
    phone = generator.generateKeyPair();
    keyID = UUID.randomUUID().toString();
    cache.accept(state(System.currentTimeMillis(), false, 5400, 0));
  }

  @After
  public void after() {
    if (server != null) server.close();
    p.edit().clear().commit();
    Recovery.cancel(c);
  }

  String day(long now) {
    java.text.SimpleDateFormat f = new java.text.SimpleDateFormat(
      "yyyy-MM-dd",
      Locale.ROOT
    );
    f.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
    return f.format(new Date(now));
  }

  JSONObject state(long now, boolean paused, int limit, int used)
    throws Exception {
    JSONObject policy = new JSONObject()
      .put("initial_seconds", 1800)
      .put("first_reward_seconds", 1200)
      .put("second_reward_seconds", 300)
      .put("repeat_seconds", 120)
      .put("rest_reset_seconds", 18000)
      .put("default_grant_seconds", 900)
      .put("daily_limit_seconds", limit)
      .put("banned_windows", new JSONArray());
    JSONObject key = new JSONObject()
      .put("key_id", keyID)
      .put(
        "public_key_der",
        Base64.encodeToString(phone.getPublic().getEncoded(), Base64.NO_WRAP)
      )
      .put("expires_ms", now + 30L * 86400000);
    return new JSONObject()
      .put("day", day(now))
      .put("watched_seconds", used)
      .put("paused", paused)
      .put("override_seconds", 0)
      .put("server_now_ms", now)
      .put("control_revision", 1)
      .put("mode", "daily")
      .put("stage", 0)
      .put("policy_snapshot", policy)
      .put("lan_keys", new JSONArray().put(key));
  }

  JSONObject envelope(JSONObject body) throws Exception {
    JSONObject e = new JSONObject()
      .put("v", 1)
      .put("device", "tv_lan_fixture")
      .put("key_id", keyID)
      .put("request_id", UUID.randomUUID().toString())
      .put("issued_ms", cache.now())
      .put("base_revision", 1)
      .put(
        "payload",
        Base64.encodeToString(
          body.toString().getBytes(StandardCharsets.UTF_8),
          Base64.NO_WRAP
        )
      );
    Signature sign = Signature.getInstance("SHA256withECDSA");
    sign.initSign(phone.getPrivate());
    sign.update(LanControl.signingText(e).getBytes(StandardCharsets.UTF_8));
    e.put("signature", Base64.encodeToString(sign.sign(), Base64.NO_WRAP));
    return e;
  }

  void reject(JSONObject e) throws Exception {
    try {
      LanControl.handle(c, e);
      fail("Command accepted unexpectedly");
    } catch (SecurityException expected) {}
  }

  @Test
  public void swiftP256SignatureWorksOnAndroidAndDuplicatesDoNotExecuteTwice()
    throws Exception {
    JSONObject e = fixture.getJSONObject("envelope"),
      s = state(e.getLong("issued_ms"), false, 5400, 0);
    s.put(
      "lan_keys",
      new JSONArray().put(
        new JSONObject()
          .put("key_id", e.getString("key_id"))
          .put("public_key_der", fixture.getString("public_key_der"))
          .put("expires_ms", e.getLong("issued_ms") + 86400000)
      )
    );
    cache.accept(s);
    assertTrue(LanControl.handle(c, e).getBoolean("accepted"));
    assertEquals("parent_paused", cache.state().getString("lock_reason"));
    assertTrue(LanControl.handle(c, e).getBoolean("duplicate"));
    assertEquals(1, LanControl.queue(p).length());
  }

  @Test
  public void staleTamperedUnpairedAndWrongDeviceCommandsAreRejected()
    throws Exception {
    JSONObject e = envelope(
      new JSONObject().put("kind", "pause").put("paused", true)
    );
    reject(
      new JSONObject(e.toString()).put(
        "payload",
        Base64.encodeToString(
          "{\"kind\":\"pause\",\"paused\":false}".getBytes(
            StandardCharsets.UTF_8
          ),
          Base64.NO_WRAP
        )
      )
    );
    reject(new JSONObject(e.toString()).put("device", "wrong_tv"));
    reject(
      new JSONObject(e.toString()).put("key_id", UUID.randomUUID().toString())
    );
    p.edit()
      .putLong("server_offset", p.getLong("server_offset", 0) + 121000)
      .commit();
    reject(e);
    assertEquals(0, LanControl.queue(p).length());
  }

  @Test
  public void offlineGrantSurvivesHeartbeatUntilAcceptedWithoutResetOrDoubleDebit()
    throws Exception {
    long now = System.currentTimeMillis();
    cache.accept(state(now, false, 60, 60));
    assertEquals("lock", cache.state().getString("status"));
    JSONObject e = envelope(
      new JSONObject().put("kind", "grant").put("seconds", 120)
    );
    LanControl.handle(c, e);
    cache.record("com.ktcp.video", 10);
    assertEquals(110, cache.state().getInt("remaining_seconds"));
    cache.accept(state(now + 1000, false, 60, 60));
    assertEquals(110, cache.state().getInt("remaining_seconds"));
    JSONArray ids = new JSONArray().put(
      cache.samples().getJSONObject(0).getString("id")
    );
    JSONObject synced = state(now + 2000, false, 60, 70)
      .put("override_seconds", 110)
      .put("bonus_expires_ms", e.getLong("issued_ms") + 86400000)
      .put("control_revision", 2)
      .put("accepted_usage_ids", ids)
      .put(
        "lan_sync_results",
        new JSONArray().put(
          new JSONObject()
            .put("request_id", e.getString("request_id"))
            .put("status", "accepted")
            .put("revision", 2)
        )
      );
    cache.accept(synced);
    assertEquals(0, LanControl.queue(p).length());
    assertEquals(110, cache.state().getInt("remaining_seconds"));
  }

  @Test
  public void frequentLocalChecksNeverMutateAnExportedUsageID()
    throws Exception {
    cache.record("com.ktcp.video", 1);
    cache.record("com.ktcp.video", 1);
    JSONArray first = cache.samples();
    assertEquals(1, first.length());
    assertEquals(2, first.getJSONObject(0).getInt("seconds"));
    String id = first.getJSONObject(0).getString("id");
    cache.record("com.ktcp.video", 1);
    JSONArray retried = cache.samples();
    assertEquals(2, retried.length());
    assertEquals(id, retried.getJSONObject(0).getString("id"));
    assertEquals(2, retried.getJSONObject(0).getInt("seconds"));
    assertEquals(3, cache.state().getInt("watched_seconds"));
  }

  @Test
  public void newerCloudConfigurationRejectsPendingLocalOverlay()
    throws Exception {
    JSONObject e = envelope(
      new JSONObject().put("kind", "pause").put("paused", true)
    );
    LanControl.handle(c, e);
    assertEquals("lock", cache.state().getString("status"));
    JSONObject cloud = state(System.currentTimeMillis(), false, 5400, 0)
      .put("control_revision", 2)
      .put(
        "lan_sync_results",
        new JSONArray().put(
          new JSONObject()
            .put("request_id", e.getString("request_id"))
            .put("status", "conflict")
        )
      );
    cache.accept(cloud);
    assertEquals("allow", cache.state().getString("status"));
    assertEquals("conflict", p.getString("lan_sync_outcome", ""));
    assertEquals(0, LanControl.queue(p).length());
  }

  @Test
  public void realTLSRequiresSignatureAndRevokingLastKeyClosesListener()
    throws Exception {
    server = new LanServer(c);
    server.update(
      new JSONObject(p.getString("cached_state", "{}")).getJSONArray("lan_keys")
    );
    assertTrue(server.port() > 0);
    final String expected = server.fingerprint();
    SSLContext tls = SSLContext.getInstance("TLS");
    tls.init(
      null,
      new TrustManager[] {
        new X509TrustManager() {
          public void checkClientTrusted(
            java.security.cert.X509Certificate[] c,
            String a
          ) {}

          public java.security.cert.X509Certificate[] getAcceptedIssuers() {
            return new java.security.cert.X509Certificate[0];
          }

          public void checkServerTrusted(
            java.security.cert.X509Certificate[] chain,
            String auth
          ) throws java.security.cert.CertificateException {
            try {
              if (
                !LanControl.hex(
                  MessageDigest.getInstance("SHA-256").digest(
                    chain[0].getEncoded()
                  )
                ).equals(expected)
              ) throw new Exception();
            } catch (Exception e) {
              throw new java.security.cert.CertificateException("Pin mismatch");
            }
          }
        },
      },
      new SecureRandom()
    );
    try (
      SSLSocket socket = (SSLSocket) tls
        .getSocketFactory()
        .createSocket("127.0.0.1", server.port())
    ) {
      socket.setSoTimeout(5000);
      socket.startHandshake();
      byte[] request = envelope(
        new JSONObject().put("kind", "pause").put("paused", true)
      )
        .toString()
        .getBytes(StandardCharsets.UTF_8);
      DataOutputStream out = new DataOutputStream(socket.getOutputStream());
      out.writeInt(request.length);
      out.write(request);
      out.flush();
      DataInputStream in = new DataInputStream(socket.getInputStream());
      int size = in.readInt();
      assertTrue(size < 65536);
      byte[] response = new byte[size];
      in.readFully(response);
      assertTrue(
        new JSONObject(new String(response, StandardCharsets.UTF_8)).getBoolean(
          "accepted"
        )
      );
    }
    server.update(new JSONArray());
    assertEquals(0, server.port());
  }
}
