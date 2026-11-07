import { readFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { verifyAttestation, verifyAssertion } from "node-app-attest";
import {
  HTTPError,
  bodyOf,
  hash,
  json,
  rateLimit,
  requireCSRF,
  requireOrigin,
  secret,
  sessionFor,
} from "../src/security.mjs";
import { ownDevice } from "../src/device-access.mjs";
import { operatorHistoryAccess } from "../src/operator-access.mjs";

const day = 86400000;
const path = "/admin/tv-update/";
const identity = {
  bundleIdentifier: "wang.chengkai.familytv",
  teamIdentifier: "C5792GBPNR",
};

export async function loadTVUpdate(directory, origin) {
  const manifest = JSON.parse(
    await readFile(join(directory, "latest.json"), "utf8"),
  );
  if (
    !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
    manifest.package !== "org.example.tvchallenge" ||
    !Number.isSafeInteger(manifest.version_code) ||
    manifest.version_code < 1 ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size < 1 ||
    manifest.size > 8388608 ||
    !/^[0-9a-f]{64}$/.test(manifest.sha256)
  )
    throw Error("Invalid private TV release");
  const filename = "family-tv-" + manifest.version + ".apk";
  const bytes = await readFile(join(directory, filename));
  if (bytes.length !== manifest.size || hash(bytes) !== manifest.sha256)
    throw Error("Private TV release integrity check failed");
  return {
    bytes,
    directory,
    filename,
    manifest: {
      version: manifest.version,
      version_code: manifest.version_code,
      package: manifest.package,
      size: manifest.size,
      sha256: manifest.sha256,
      url: origin + path + "download",
    },
  };
}

export async function cleanTVUpdates(release, now = Date.now()) {
  if (!release) return;
  for (const file of await readdir(release.directory, {
    withFileTypes: true,
  })) {
    if (
      !file.isFile() ||
      file.name === release.filename ||
      !/^family-tv-\d+\.\d+\.\d+\.apk$/.test(file.name)
    )
      continue;
    const target = join(release.directory, file.name);
    if ((await stat(target)).mtimeMs < now - 30 * day) await unlink(target);
  }
}

export async function tvUpdateRoute(request, env, release, now = Date.now()) {
  try {
    if (!release) throw new HTTPError(503, "TV update download unavailable");
    const db = env.DB;
    const url = new URL(request.url);
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    await rateLimit(db, "tv-update-ip:" + ip, 20, 60000, now);
    const session = await sessionFor(db, request, now);
    const device = await ownDevice(db, session, url);
    if (!url.searchParams.has("device") || !device.enabled)
      throw new HTTPError(404, "TV not found");
    if (url.pathname === path + "latest" && request.method === "GET")
      return json(release.manifest);
    if (request.method !== "POST")
      throw new HTTPError(405, "Method not allowed");
    requireOrigin(request, env.PUBLIC_ORIGIN);
    requireCSRF(request, session);
    if ((device.client_version_code ?? 0) >= release.manifest.version_code)
      throw new HTTPError(409, "TV already up to date");
    if (url.pathname === path + "challenge") {
      await rateLimit(
        db,
        "tv-update-challenge:" + session.household_id,
        10,
        60000,
        now,
      );
      const challenge = secret();
      await db
        .prepare("DELETE FROM update_challenges WHERE expires_ms<=?")
        .bind(now)
        .run();
      await db
        .prepare("INSERT INTO update_challenges VALUES(?,?,?,?,?)")
        .bind(
          hash(challenge),
          session.token_hash,
          device.id,
          release.manifest.version_code,
          now + 120000,
        )
        .run();
      return json({ challenge, version_code: release.manifest.version_code });
    }
    if (url.pathname !== path + "download")
      throw new HTTPError(404, "Not found");
    const body = await bodyOf(request);
    if (
      typeof body.challenge !== "string" ||
      !/^[A-Za-z0-9_-]{40,64}$/.test(body.challenge) ||
      typeof body.key_id !== "string" ||
      !/^[A-Za-z0-9+/=]{40,96}$/.test(body.key_id) ||
      typeof body.proof !== "string" ||
      body.proof.length > 16000 ||
      !["attestation", "assertion"].includes(body.kind)
    )
      throw new HTTPError(400, "Invalid app proof");
    const consumed = await db
      .prepare(
        "DELETE FROM update_challenges WHERE digest=? AND session_hash=? AND device_id=? AND version_code=? AND expires_ms>? RETURNING digest",
      )
      .bind(
        hash(body.challenge),
        session.token_hash,
        device.id,
        release.manifest.version_code,
        now,
      )
      .first();
    if (!consumed)
      throw new HTTPError(403, "Download challenge expired or used");
    await verifyPhone(db, env, session, body, now);
    await rateLimit(db, "tv-update-device:" + device.id, 5, day, now);
    await rateLimit(
      db,
      "tv-update-household:" + session.household_id,
      10,
      day,
      now,
    );
    // Service-wide budget bounds paid traffic even across many accounts and IPs.
    const budget = await db
      .prepare(
        `INSERT INTO rate_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET
       count=CASE WHEN reset_ms<=? THEN excluded.count ELSE count+excluded.count END,
       reset_ms=CASE WHEN reset_ms<=? THEN excluded.reset_ms ELSE reset_ms END
       WHERE reset_ms<=? OR count+excluded.count<=67108864 RETURNING count`,
      )
      .bind(
        hash("tv-update-global"),
        release.bytes.length,
        now + day,
        now,
        now,
        now,
      )
      .first();
    if (!budget) throw new HTTPError(429, "Daily update traffic limit reached");
    return new Response(release.bytes, {
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Length": String(release.bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (!(error instanceof HTTPError)) throw error;
    return json({ error: error.message }, error.status);
  }
}

async function verifyPhone(db, env, session, body, now) {
  const proof = Buffer.from(body.proof, "base64");
  const lookup = await db
    .prepare(
      "SELECT public_key,counter,development FROM update_attest_keys WHERE household_id=? AND key_id=?",
    )
    .bind(session.household_id, body.key_id)
    .first();
  const allowDevelopmentEnvironment =
    env.TV_UPDATE_DEVELOPMENT === "true" &&
    !!(await operatorHistoryAccess(db, session.household_id, now));
  try {
    if (body.kind === "attestation" && !lookup) {
      const { publicKey, environment } = verifyAttestation({
        ...identity,
        attestation: proof,
        challenge: body.challenge,
        keyId: body.key_id,
        allowDevelopmentEnvironment,
      });
      await db
        .prepare("INSERT INTO update_attest_keys VALUES(?,?,?,0,?)")
        .bind(
          session.household_id,
          body.key_id,
          publicKey,
          environment === "development" ? 1 : 0,
        )
        .run();
      return;
    }
    if (
      body.kind === "assertion" &&
      lookup &&
      (!lookup.development || allowDevelopmentEnvironment)
    ) {
      const { signCount } = verifyAssertion({
        ...identity,
        assertion: proof,
        payload: body.challenge,
        publicKey: lookup.public_key,
        signCount: lookup.counter,
      });
      const result = await db
        .prepare(
          "UPDATE update_attest_keys SET counter=? WHERE household_id=? AND key_id=? AND counter<?",
        )
        .bind(signCount, session.household_id, body.key_id, signCount)
        .run();
      if (result.meta.changes === 1) return;
    }
  } catch {
    throw new HTTPError(403, "Installed iOS app verification failed");
  }
  throw new HTTPError(403, "Installed iOS app verification failed");
}
