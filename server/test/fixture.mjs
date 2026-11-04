import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHandler, cleanup } from "../src/handler.mjs";
import { HTTPError } from "../src/security.mjs";
import { D1 } from "./d1.mjs";
export function fixture(t) {
  let now = Date.parse("2030-01-02T12:00:00+08:00");
  const db = new D1(),
    claims = new Map();
  const env = {
    DB: db,
    PUBLIC_ORIGIN: "https://familytv.invalid",
    BUNDLE_ID: "wang.chengkai.familytv",
    PRODUCT_ID: "wang.chengkai.familytv.plus.monthly",
  };
  const handle = createHandler({
    clock: () => now,
    verifyTransaction: async (jws) => {
      if (!claims.has(jws))
        throw new HTTPError(403, "Apple signature verification failed");
      return claims.get(jws);
    },
    verifyAppTransaction: async (jws) => {
      if (!claims.has(jws))
        throw new HTTPError(403, "Apple app signature verification failed");
      return claims.get(jws);
    },
    verifyNotification: async (jws) => {
      if (!claims.has(jws)) throw new HTTPError(403, "Invalid notification");
      return claims.get(jws);
    },
  });
  t.after(() => db.close());
  const call = async (path, body, auth, extra = {}) =>
    handle(
      new Request(env.PUBLIC_ORIGIN + path, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: env.PUBLIC_ORIGIN,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}),
          ...extra,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
  const register = async (name) => {
    const r = await call("/admin/register", {
      username: name,
      password: "test-private-password-123",
    });
    assert.equal(r.status, 201, await r.clone().text());
    const value = await r.json();
    return { ...value, cookie: r.headers.get("set-cookie").split(";")[0] };
  };
  const install = async (auth) => {
    const r = await call("/admin/installation_ticket", { label: "TV" }, auth);
    assert.equal(r.status, 201);
    const ticket = await r.json();
    const provision = await (
      await call("/installation/redeem", { code: ticket.code })
    ).json();
    return { ...provision, code: ticket.code };
  };
  const beat = async (device, body = {}) => {
    now += 10000;
    return call(
      "/heartbeat",
      {
        device: device.device,
        event_id: randomUUID(),
        app: "com.ktcp.video",
        is_playing: true,
        ...body,
      },
      null,
      { Authorization: "Bearer " + device.token },
    );
  };
  const premium = async (auth) => {
    const jws = randomUUID();
    claims.set(jws, {
      bundleId: env.BUNDLE_ID,
      productId: env.PRODUCT_ID,
      type: "Auto-Renewable Subscription",
      appAccountToken: auth.identity.tenant_id,
      originalTransactionId: randomUUID(),
      transactionId: randomUUID(),
      environment: "Sandbox",
      signedDate: now,
      expiresDate: now + 86400000,
    });
    const response = await call(
      "/admin/subscription",
      { signed_transaction: jws },
      auth,
    );
    assert.equal(response.status, 200, await response.clone().text());
    return { jws, transaction: claims.get(jws) };
  };
  return {
    db,
    env,
    call,
    register,
    install,
    beat,
    premium,
    claims,
    advance: (ms) => (now += ms),
    now: () => now,
  };
}
