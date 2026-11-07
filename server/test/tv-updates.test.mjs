import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./fixture.mjs";
import { tvUpdateRoute } from "../node-runtime/tv-updates.mjs";

test("TV downloads require a fresh challenge from the same authorized session and valid App Attest proof", async (t) => {
  const f = fixture(t);
  const owner = await f.register("update_owner");
  const other = await f.register("update_other");
  const tv = await f.install(owner);
  const release = {
    manifest: { version_code: 19 },
    bytes: Buffer.from("test"),
  };
  const request = (action, auth, body) =>
    tvUpdateRoute(
      new Request(
        f.env.PUBLIC_ORIGIN +
          "/admin/tv-update/" +
          action +
          "?device=" +
          tv.device,
        {
          method: body ? "POST" : "GET",
          headers: {
            Origin: f.env.PUBLIC_ORIGIN,
            "Content-Type": "application/json",
            ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        },
      ),
      f.env,
      release,
      f.now(),
    );

  assert.equal((await request("latest")).status, 401);
  assert.equal((await request("latest", other)).status, 404);
  assert.equal((await request("latest", owner)).status, 200);
  const issued = await request("challenge", owner, {});
  assert.equal(issued.status, 200);
  const { challenge } = await issued.json();
  const proof = {
    challenge,
    key_id: Buffer.alloc(32).toString("base64"),
    proof: "AA==",
    kind: "attestation",
  };
  const denied = await request("download", owner, proof);
  assert.equal(denied.status, 403);
  assert.equal(
    (await denied.json()).error,
    "Installed iOS app verification failed",
  );
  const replay = await request("download", owner, proof);
  assert.equal(replay.status, 403);
  assert.equal(
    (await replay.json()).error,
    "Download challenge expired or used",
  );
});
