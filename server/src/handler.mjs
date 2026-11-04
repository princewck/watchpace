import { configRoute } from "./config-routes.mjs";
import { sharingRoutes } from "./sharing.mjs";
import { devicePolicy, requireOwner } from "./device-access.mjs";
import { restPage } from "./rest-page.mjs";
import { pairLan, localState, syncLan } from "./lan.mjs";
import { randomUUID } from "node:crypto";
import {
  HTTPError,
  secret,
  hash,
  passwordRecord,
  passwordMatches,
  bodyOf,
  rateLimit,
  sessionFor,
  requireOrigin,
  requireCSRF,
  cookie,
  json,
} from "./security.mjs";
import { DEFAULT_POLICY, dayOf, stateFor } from "./policy.mjs";
import {
  subscriptionStatus,
  saveTransaction,
  subscriptionOwner,
} from "./subscriptions.mjs";
import {
  UUID,
  sessionTTL,
  identity,
  healthFor,
  ownDevice,
  newSession,
  operation,
} from "./context.mjs";
import { heartbeat } from "./heartbeat.mjs";
import { installationRoutes } from "./installation-routes.mjs";
export { cleanup } from "./cleanup.mjs";
export function createHandler({
  verifyTransaction,
  verifyNotification,
  verifyAppTransaction,
  clock = Date.now,
}) {
  return async function handle(request, env) {
    const db = env.DB,
      url = new URL(request.url),
      path = url.pathname,
      now = clock();
    try {
      if (!db) throw new HTTPError(503, "Service storage unavailable");
      if (path === "/tv-rest" && request.method === "GET") return restPage();
      const post = request.method === "POST";
      if (!["GET", "POST"].includes(request.method))
        throw new HTTPError(405, "Method not allowed");
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      await rateLimit(db, "api:" + ip, 180, 60000, now);
      const body = post ? await bodyOf(request) : null;
      if (path === "/healthz" && !post) {
        await db.prepare("SELECT 1").first();
        return json({ status: "ok", service: "familytv-cloud", version: 1 });
      }
      if (path === "/heartbeat" && post)
        return json(await heartbeat(db, request, body, now, env));
      if (path === "/device/status" && !post) {
        const bearer = request.headers.get("authorization");
        if (!bearer?.startsWith("Bearer ") || bearer.length > 140)
          throw new HTTPError(401, "Device authentication required");
        const d = await db
          .prepare(
            "SELECT d.*,h.policy_json AS household_policy_json FROM devices d JOIN households h ON h.id=d.household_id WHERE token_hash=? AND enabled=1",
          )
          .bind(hash(bearer.slice(7)))
          .first();
        if (!d) throw new HTTPError(401, "Invalid device token");
        return json({
          ...healthFor(d, now),
          protocol_version: 2,
          last_heartbeat_ms: d.last_heartbeat_ms,
          permissions_ok: d.permissions_ok === 1,
          boot_count: d.boot_count,
          adb_enabled: d.adb_enabled,
          state: await stateFor(db, d, devicePolicy(d), now),
        });
      }
      if (path === "/admin/register" && post) {
        requireOrigin(request, env.PUBLIC_ORIGIN);
        await rateLimit(db, "register:" + ip, 3, 3600000, now);
        const { username, password } = body;
        if (
          typeof username !== "string" ||
          !/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username) ||
          ["admin", "root"].includes(username)
        )
          throw new HTTPError(400, "Choose a 3..32 character username");
        const credential = await passwordRecord(password),
          id = randomUUID(),
          recovery = secret();
        try {
          await db
            .prepare("INSERT INTO households VALUES(?,?,?,?,?,?)")
            .bind(
              id,
              username,
              credential,
              hash(recovery),
              JSON.stringify(DEFAULT_POLICY),
              now,
            )
            .run();
        } catch (e) {
          if (String(e).includes("UNIQUE"))
            throw new HTTPError(409, "Username unavailable");
          throw e;
        }
        const session = await newSession(db, id, username, now);
        return json({ ...session.value, recovery_code: recovery }, 201, {
          "Set-Cookie": cookie(session.token, sessionTTL / 1000),
        });
      }
      if (path === "/admin/login" && post) {
        requireOrigin(request, env.PUBLIC_ORIGIN);
        await rateLimit(db, "login:" + ip, 6, 15 * 60000, now);
        const user =
          typeof body.username === "string"
            ? await db
                .prepare("SELECT * FROM households WHERE username=?")
                .bind(body.username)
                .first()
            : null;
        const valid = await passwordMatches(
          body.password,
          user?.password_json ||
            JSON.stringify({ salt: "00".repeat(16), digest: "00".repeat(64) }),
        );
        if (!user || !valid)
          throw new HTTPError(401, "Invalid username or password");
        const session = await newSession(db, user.id, user.username, now);
        return json(session.value, 200, {
          "Set-Cookie": cookie(session.token, sessionTTL / 1000),
        });
      }
      if (path === "/admin/recover" && post) {
        requireOrigin(request, env.PUBLIC_ORIGIN);
        await rateLimit(db, "recover:" + ip, 3, 3600000, now);
        const user = await db
          .prepare(
            "SELECT * FROM households WHERE username=? AND recovery_hash=?",
          )
          .bind(
            typeof body.username === "string" ? body.username : "",
            hash(
              typeof body.recovery_code === "string" ? body.recovery_code : "",
            ),
          )
          .first();
        if (!user) throw new HTTPError(401, "Invalid recovery information");
        const credential = await passwordRecord(body.password),
          recovery = secret();
        const changed = await db
          .prepare(
            "UPDATE households SET password_json=?,recovery_hash=? WHERE id=? AND recovery_hash=? RETURNING id",
          )
          .bind(credential, hash(recovery), user.id, hash(body.recovery_code))
          .first();
        if (!changed) throw new HTTPError(401, "Recovery code already used");
        return json({ success: true, recovery_code: recovery });
      }
      if (path === "/installation/redeem" && post) {
        await rateLimit(db, "redeem:" + ip, 10, 60000, now);
        const code =
          typeof body.code === "string"
            ? body.code.replace(/[-\s]/g, "").toUpperCase()
            : "";
        if (!/^[0-9A-F]{16}$/.test(code))
          throw new HTTPError(400, "Invalid installation code");
        const token = secret();
        // Updating the token and marking the ticket share a SQLite trigger transaction. The
        // conditional UPDATE...RETURNING ensures two agents cannot both redeem it.
        const ticket = await db
          .prepare(
            "UPDATE installation_tickets SET redeemed_ms=?,redeem_token_hash=? WHERE code_hash=? AND redeemed_ms IS NULL AND expires_ms>? AND EXISTS(SELECT 1 FROM devices WHERE id=device_id AND enabled=1) RETURNING device_id",
          )
          .bind(now, hash(token), hash(code), now)
          .first();
        if (!ticket)
          throw new HTTPError(410, "Installation code expired or used");
        return json({
          device: ticket.device_id,
          token,
          origin: env.PUBLIC_ORIGIN,
        });
      }
      if (path === "/apple/notifications" && post) {
        const notification = await verifyNotification(body.signedPayload, env);
        const jws = notification.data?.signedTransactionInfo;
        if (jws) {
          const transaction = await verifyTransaction(jws, env),
            bound = await subscriptionOwner(
              db,
              transaction.originalTransactionId,
            ),
            household = bound?.household_id ?? transaction.appAccountToken;
          if (
            typeof household === "string" &&
            (await db
              .prepare("SELECT 1 FROM households WHERE id=?")
              .bind(household)
              .first())
          )
            await saveTransaction(db, transaction, household, env, now);
        }
        return json({ success: true });
      }
      if (!path.startsWith("/admin/")) throw new HTTPError(404, "Not found");
      const s = await sessionFor(db, request, now);
      if (post) {
        requireOrigin(request, env.PUBLIC_ORIGIN);
        requireCSRF(request, s);
      }
      if (path === "/admin/session" && !post)
        return json({
          ...identity(s),
          identity: identity(s),
          csrf: s.csrf,
          expires_ms: s.expires_ms,
        });
      if (path === "/admin/logout" && post) {
        await db
          .prepare("DELETE FROM sessions WHERE token_hash=?")
          .bind(s.token_hash)
          .run();
        return json({ success: true }, 200, { "Set-Cookie": cookie("", 0) });
      }
      if (path === "/admin/mobile_capabilities" && !post)
        return json({
          version: 2,
          pause: true,
          daily_limit: true,
          execution_receipts: true,
          household_delete: true,
          staged_rules: false,
          registration: true,
          paid_history: env.OFFICIAL_CLOUD !== "false",
          lan: true,
        });
      const shared = await sharingRoutes({
        db,
        s,
        url,
        path,
        post,
        body,
        now,
        env,
      });
      if (shared) return shared;
      const config = await configRoute({ db, s, url, path, post, body });
      if (config) return config;
      const installed = await installationRoutes({
        db,
        s,
        url,
        path,
        now,
        post,
        body,
        env,
      });
      if (installed) return installed;
      if (path === "/admin/subscription") {
        if (env.OFFICIAL_CLOUD === "false")
          return json({
            active: true,
            expires_ms: 253402300799000,
            original_ids: [],
            self_hosted: true,
          });
        if (!post)
          return json(await subscriptionStatus(db, s.household_id, now));
        const transaction = await verifyTransaction(
          body.signed_transaction,
          env,
        );
        const appTransaction = body.signed_app_transaction
          ? await verifyAppTransaction(body.signed_app_transaction, env)
          : undefined;
        return json(
          await saveTransaction(db, transaction, s.household_id, env, now, {
            appTransaction,
          }),
        );
      }
      if (path === "/admin/delete_household" && post) {
        await rateLimit(db, "delete:" + s.household_id, 5, 3600000, now);
        const user = await db
          .prepare("SELECT password_json FROM households WHERE id=?")
          .bind(s.household_id)
          .first();
        if (
          body.confirmation !== "DELETE" ||
          !(await passwordMatches(body.password, user.password_json))
        )
          throw new HTTPError(403, "Password confirmation required");
        await db
          .prepare("DELETE FROM households WHERE id=?")
          .bind(s.household_id)
          .run();
        return json({ success: true }, 200, { "Set-Cookie": cookie("", 0) });
      }
      if (path === "/admin/lan/revoke_all" && post) {
        if (
          !Array.isArray(body.key_ids) ||
          body.key_ids.length > 10 ||
          body.key_ids.some((id) => !UUID.test(id))
        )
          throw new HTTPError(400, "Invalid local key IDs");
        if (body.key_ids.length)
          await db.batch(
            body.key_ids.map((id) =>
              db
                .prepare(
                  "DELETE FROM lan_pairings WHERE id=? AND household_id=?",
                )
                .bind(id, s.household_id),
            ),
          );
        return json({ success: true });
      }
      const d = await ownDevice(db, s, url),
        policy = devicePolicy(d);
      if (path === "/admin/lan/pair" && post) {
        await rateLimit(db, "lan-pair:" + s.household_id, 15, 60000, now);
        return json(await pairLan(db, s.household_id, d, body, now));
      }
      if (path === "/admin/lan/pairings" && !post)
        return json({
          pairings: (
            await db
              .prepare(
                "SELECT id key_id,created_ms,expires_ms FROM lan_pairings WHERE household_id=? AND device_id=? AND expires_ms>?",
              )
              .bind(s.household_id, d.id, now)
              .all()
          ).results,
        });
      if (path === "/admin/lan/revoke" && post) {
        await db
          .prepare(
            "DELETE FROM lan_pairings WHERE id=? AND household_id=? AND device_id=?",
          )
          .bind(
            typeof body.key_id === "string" ? body.key_id : "",
            s.household_id,
            d.id,
          )
          .run();
        return json({ success: true });
      }
      if (path === "/admin/lan/command" && post) {
        const results = await syncLan(
          db,
          s.household_id,
          d,
          [body.envelope],
          now,
        );
        if (results[0]?.status !== "accepted")
          throw new HTTPError(
            results[0]?.status === "conflict" ? 409 : 403,
            "Local command rejected; refresh television state",
          );
        return json({
          ...(await localState(db, d, now)),
          lan_sync_results: results,
        });
      }
      if (path === "/admin/stats" && !post) {
        const premium =
            env.OFFICIAL_CLOUD === "false"
              ? { active: true }
              : await subscriptionStatus(db, s.household_id, now),
          today = dayOf(now),
          start = premium.active ? dayOf(now - 29 * 86400000) : today;
        const daily = await db
          .prepare(
            "SELECT day,app_package,seconds FROM daily_usage WHERE device_id=? AND day>=? ORDER BY day,app_package",
          )
          .bind(d.id, start)
          .all();
        return json({
          today,
          daily: daily.results,
          state: await stateFor(db, d, policy, now),
          server_now_ms: now,
          premium: premium.active,
        });
      }
      if (path === "/admin/control") {
        if (!post) return json(await stateFor(db, d, policy, now));
        if (typeof body.paused !== "boolean")
          throw new HTTPError(400, "Boolean paused required");
        const result = await operation(
          db,
          s,
          d,
          "pause",
          { paused: body.paused ? 1 : 0 },
          body.request_id,
          now,
        );
        return json({
          ...(await stateFor(db, result.device, policy, now)),
          duplicate: result.duplicate,
        });
      }
      if (path === "/admin/grant" && post) {
        if (
          !Number.isInteger(body.seconds) ||
          body.seconds < 60 ||
          body.seconds > 7200
        )
          throw new HTTPError(400, "Grant must be 1..120 minutes");
        const result = await operation(
          db,
          s,
          d,
          "grant",
          { seconds: body.seconds },
          body.request_id,
          now,
        );
        return json({
          ...(await stateFor(db, result.device, policy, now)),
          duplicate: result.duplicate,
        });
      }
      if (path === "/admin/installation_status" && !post) {
        return json(healthFor(d, now));
      }
      if (path === "/admin/device_update" && post) {
        requireOwner(d, s);
        const statements = [];
        if (body.label !== undefined) {
          if (
            typeof body.label !== "string" ||
            !body.label.trim() ||
            body.label.length > 64
          )
            throw new HTTPError(400, "Invalid name");
          statements.push(
            db
              .prepare("UPDATE devices SET label=? WHERE id=?")
              .bind(body.label.trim(), d.id),
          );
        }
        if (body.enabled !== undefined) {
          if (typeof body.enabled !== "boolean")
            throw new HTTPError(400, "Invalid enabled");
          statements.push(
            db
              .prepare(
                "UPDATE devices SET enabled=?,revision=revision+1 WHERE id=?",
              )
              .bind(Number(body.enabled), d.id),
          );
        }
        if (!statements.length) throw new HTTPError(400, "No change");
        await db.batch(statements);
        return json({ success: true });
      }
      if (path === "/admin/delete_device" && post) {
        requireOwner(d, s);
        await db
          .prepare("DELETE FROM devices WHERE id=? AND household_id=?")
          .bind(d.id, s.household_id)
          .run();
        return json({ success: true });
      }
      throw new HTTPError(404, "Not found");
    } catch (e) {
      return json(
        {
          error:
            e instanceof HTTPError
              ? e.message
              : "Service temporarily unavailable",
        },
        e instanceof HTTPError ? e.status : 500,
      );
    }
  };
}
