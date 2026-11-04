package org.example.tvchallenge;

import android.content.Context;
import android.net.nsd.*;
import android.security.keystore.*;
import java.io.*;
import java.math.BigInteger;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.*;
import javax.security.auth.x500.X500Principal;
import org.json.*;

/** TLS 1.2+ framed JSON, advertised only after an authenticated parent enrolls a key. */
final class LanServer {

  private static final String ALIAS = "familytv.lan.identity.v2";
  private final Context context;
  private final SSLContext tls;
  private final String fingerprint;
  private SSLServerSocket listener;
  private volatile boolean stopped = true;
  private NsdManager.RegistrationListener registration;
  private final ThreadPoolExecutor clients = new ThreadPoolExecutor(
    0,
    4,
    15,
    TimeUnit.SECONDS,
    new SynchronousQueue<>(),
    new ThreadPoolExecutor.AbortPolicy()
  );
  private long lastAccepted;
  private int bursts;

  LanServer(Context c) throws Exception {
    context = c.getApplicationContext();
    KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
    keys.load(null);
    if (!keys.containsAlias(ALIAS)) {
      KeyPairGenerator generator = KeyPairGenerator.getInstance(
        "EC",
        "AndroidKeyStore"
      );
      generator.initialize(
        new KeyGenParameterSpec.Builder(
          ALIAS,
          KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY
        )
          .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
          .setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256)
          .setCertificateSubject(new X500Principal("CN=FamilyTV Local Device"))
          .setCertificateSerialNumber(new BigInteger(120, new SecureRandom()))
          .setCertificateNotBefore(
            new Date(System.currentTimeMillis() - 86400000L)
          )
          .setCertificateNotAfter(
            new Date(System.currentTimeMillis() + 10L * 365 * 86400000)
          )
          .build()
      );
      generator.generateKeyPair();
    }
    X509Certificate certificate = (X509Certificate) keys.getCertificate(ALIAS);
    fingerprint = LanControl.hex(
      MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded())
    );
    PrivateKey privateKey = (PrivateKey) keys.getKey(ALIAS, null);
    X509ExtendedKeyManager manager = new X509ExtendedKeyManager() {
      public String[] getClientAliases(String t, java.security.Principal[] i) {
        return null;
      }

      public String chooseClientAlias(
        String[] t,
        java.security.Principal[] i,
        Socket s
      ) {
        return null;
      }

      public String[] getServerAliases(String t, java.security.Principal[] i) {
        return t.equals("EC") ? new String[] { ALIAS } : null;
      }

      public String chooseServerAlias(
        String t,
        java.security.Principal[] i,
        Socket s
      ) {
        return t.equals("EC") ? ALIAS : null;
      }

      public X509Certificate[] getCertificateChain(String a) {
        return ALIAS.equals(a) ? new X509Certificate[] { certificate } : null;
      }

      public PrivateKey getPrivateKey(String a) {
        return ALIAS.equals(a) ? privateKey : null;
      }
    };
    tls = SSLContext.getInstance("TLS");
    tls.init(new KeyManager[] { manager }, null, new SecureRandom());
  }

  String fingerprint() {
    return fingerprint;
  }

  synchronized int port() {
    return listener == null ? 0 : listener.getLocalPort();
  }

  synchronized void update(JSONArray keys) throws Exception {
    boolean authorized = false;
    long now = new OfflineState(context).now();
    if (keys != null) for (int i = 0; i < keys.length(); i++) authorized |=
      keys.getJSONObject(i).getLong("expires_ms") > now;
    if (!authorized || !NativeState.enabled(context)) {
      stopListening();
      return;
    }
    if (listener != null && !listener.isClosed()) return;
    listener = (SSLServerSocket) tls
      .getServerSocketFactory()
      .createServerSocket(0, 4, InetAddress.getByName("0.0.0.0"));
    List<String> protocols = new ArrayList<>();
    for (String p : listener.getSupportedProtocols())
      if (p.equals("TLSv1.2") || p.equals("TLSv1.3")) protocols.add(p);
    listener.setEnabledProtocols(protocols.toArray(new String[0]));
    listener.setSoTimeout(1000);
    stopped = false;
    final SSLServerSocket socket = listener;
    new Thread(() -> serve(socket), "tv-lan-listener").start();
    NsdServiceInfo info = new NsdServiceInfo();
    String device = NativeState.prefs(context).getString("device", "");
    info.setServiceName(
      "FamilyTV-" + device.substring(Math.max(0, device.length() - 12))
    );
    info.setServiceType("_familytv._tcp.");
    info.setPort(socket.getLocalPort());
    info.setAttribute("v", "1");
    registration = new NsdManager.RegistrationListener() {
      public void onRegistrationFailed(NsdServiceInfo i, int e) {
        NativeState.log(context, "LAN_DISCOVERY_UNAVAILABLE");
      }

      public void onUnregistrationFailed(NsdServiceInfo i, int e) {}

      public void onServiceRegistered(NsdServiceInfo i) {}

      public void onServiceUnregistered(NsdServiceInfo i) {}
    };
    try {
      context
        .getSystemService(NsdManager.class)
        .registerService(info, NsdManager.PROTOCOL_DNS_SD, registration);
    } catch (RuntimeException error) {
      stopListening();
      throw error;
    }
  }

  private void serve(SSLServerSocket server) {
    while (!stopped && !server.isClosed())
      try {
        SSLSocket client = (SSLSocket) server.accept();
        client.setSoTimeout(4000);
        InetAddress peer = client.getInetAddress();
        if (
          !peer.isSiteLocalAddress() &&
          !peer.isLoopbackAddress() &&
          !peer.isLinkLocalAddress()
        ) {
          client.close();
          continue;
        }
        synchronized (this) {
          long now = android.os.SystemClock.elapsedRealtime();
          if (now - lastAccepted > 1000) {
            lastAccepted = now;
            bursts = 0;
          }
          if (++bursts > 8) {
            client.close();
            continue;
          }
        }
        try {
          clients.execute(() -> handle(client));
        } catch (RejectedExecutionException busy) {
          client.close();
        }
      } catch (SocketTimeoutException idle) {
      } catch (IOException error) {
        if (!stopped) NativeState.log(context, "LAN_LISTENER_CLOSED");
        break;
      }
  }

  private void handle(SSLSocket client) {
    try (SSLSocket socket = client) {
      socket.startHandshake();
      DataInputStream in = new DataInputStream(socket.getInputStream());
      int length = in.readInt();
      if (length < 2 || length > 32768) return;
      byte[] data = new byte[length];
      in.readFully(data);
      JSONObject response;
      try {
        response = LanControl.handle(
          context,
          new JSONObject(new String(data, StandardCharsets.UTF_8))
        );
      } catch (Exception rejected) {
        response = new JSONObject()
          .put("accepted", false)
          .put(
            "error",
            rejected instanceof SecurityException
              ? "unauthorized_or_stale"
              : "unavailable"
          );
      }
      byte[] bytes = response.toString().getBytes(StandardCharsets.UTF_8);
      if (bytes.length > 65536) return;
      DataOutputStream out = new DataOutputStream(socket.getOutputStream());
      out.writeInt(bytes.length);
      out.write(bytes);
      out.flush();
    } catch (Exception ignored) {
      /* No keys, credentials, IP addresses or payloads in logs. */
    }
  }

  private synchronized void stopListening() {
    stopped = true;
    if (listener != null) {
      try {
        listener.close();
      } catch (IOException ignored) {}
      listener = null;
    }
    if (registration != null) {
      try {
        context
          .getSystemService(NsdManager.class)
          .unregisterService(registration);
      } catch (RuntimeException ignored) {}
      registration = null;
    }
  }

  synchronized void close() {
    stopListening();
    clients.shutdownNow();
  }
}
