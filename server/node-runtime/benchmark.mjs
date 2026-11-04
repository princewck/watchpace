// Synthetic handler + on-disk SQLite measurement; never opens the production DB.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { SQLiteD1 } from "./database.mjs";
import { createHandler } from "../src/handler.mjs";
import { hash } from "../src/security.mjs";
import { DEFAULT_POLICY } from "../src/policy.mjs";
const dir = mkdtempSync(join(tmpdir(), "familytv-capacity-")),
  db = new SQLiteD1(join(dir, "bench.sqlite"));
let now = Date.now();
try {
  for (const name of readdirSync(new URL("../migrations/", import.meta.url))
    .filter((x) => x.endsWith(".sql"))
    .sort())
    db.db.exec(
      readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
  const household = randomUUID();
  db.db
    .prepare("INSERT INTO households VALUES(?,?,?,?,?,?)")
    .run(
      household,
      "benchmark",
      "unused",
      "unused",
      JSON.stringify(DEFAULT_POLICY),
      now,
    );
  const clients = 100,
    samples = 1000;
  for (let i = 0; i < clients; i++)
    db.db
      .prepare(
        "INSERT INTO devices(id,household_id,label,token_hash,created_ms) VALUES(?,?,?,?,?)",
      )
      .run("bench_" + i, household, "Bench", hash("temporary-token-" + i), now);
  const handle = createHandler({ clock: () => now }),
    times = [],
    start = performance.now();
  let failures = 0;
  for (let i = 0; i < samples; i++) {
    const client = i % clients;
    now += 100;
    const before = performance.now();
    const r = await handle(
      new Request("https://benchmark.invalid/heartbeat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "bench-" + client,
          Authorization: "Bearer temporary-token-" + client,
        },
        body: JSON.stringify({
          device: "bench_" + client,
          event_id: randomUUID(),
          app: "com.ktcp.video",
          is_playing: true,
          boot_count: 1,
          adb_enabled: 0,
          permissions_ok: true,
        }),
      }),
      { DB: db, PUBLIC_ORIGIN: "https://benchmark.invalid" },
    );
    if (r.status !== 200) failures++;
    times.push(performance.now() - before);
  }
  const elapsed = performance.now() - start;
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      measurement:
        "synthetic sequential handler and disk SQLite; excludes HTTP/TLS/network",
      virtual_devices: clients,
      requests: samples,
      failures,
      elapsed_ms: Math.round(elapsed),
      requests_per_second: Math.round((samples * 1000) / elapsed),
      p50_ms: +times[Math.floor(samples * 0.5)].toFixed(2),
      p95_ms: +times[Math.floor(samples * 0.95)].toFixed(2),
      rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    }),
  );
  if (failures) process.exitCode = 1;
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
