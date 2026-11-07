// Loopback HTTP only. Nginx owns public TLS, client IP and body/rate limits.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createHandler, cleanup } from "../src/handler.mjs";
import {
  verifyTransaction,
  verifyNotification,
  verifyAppTransaction,
} from "../src/apple.mjs";
import { cleanTVUpdates, loadTVUpdate, tvUpdateRoute } from "./tv-updates.mjs";
import { SQLiteD1 } from "./database.mjs";
const origin = process.env.PUBLIC_ORIGIN;
if (
  !origin ||
  new URL(origin).origin !== origin ||
  !origin.startsWith("https://")
)
  throw Error("Set PUBLIC_ORIGIN to your exact HTTPS service origin");
const allowed = new Set([
  origin,
  ...(process.env.COMPATIBLE_ORIGINS || "").split(",").filter(Boolean),
]);
const root = resolve(process.env.STATIC_ROOT || "public");
const db = new SQLiteD1(process.env.SQLITE_PATH || "runtime/familytv.sqlite");
const env = {
  ...process.env,
  OFFICIAL_CLOUD: process.env.OFFICIAL_CLOUD || "false",
  DB: db,
  PUBLIC_ORIGIN: origin,
};
const tvUpdate = process.env.TV_UPDATE_ROOT
  ? await loadTVUpdate(resolve(process.env.TV_UPDATE_ROOT), origin)
  : null;
const handle = createHandler({
  verifyTransaction,
  verifyNotification,
  verifyAppTransaction,
});
const types = {
  ".zip": "application/zip",
  ".apk": "application/vnd.android.package-archive",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (
      req.method === "GET" &&
      (url.pathname.startsWith("/downloads/") ||
        ["/privacy.html", "/support.html"].includes(url.pathname))
    ) {
      const path = resolve(root, "." + decodeURIComponent(url.pathname));
      if (!path.startsWith(root + "/")) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const info = await stat(path);
        if (!info.isFile()) throw Error("not file");
        const data = await readFile(path);
        res.writeHead(200, {
          "Content-Type": types[extname(path)] || "application/octet-stream",
          "Content-Length": data.length,
          "Cache-Control": url.pathname.startsWith("/downloads/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(data);
        return;
      } catch {
        res.writeHead(404);
        res.end();
        return;
      }
    }
    let size = 0;
    const chunks = [];
    for await (const part of req) {
      size += part.length;
      if (size > 32768) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(part);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined)
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    // Only loopback Nginx is trusted to supply this header; never trust incoming CF headers.
    headers.set(
      "CF-Connecting-IP",
      req.headers["x-real-ip"] || req.socket.remoteAddress,
    );
    const caller = headers.get("origin");
    if (allowed.has(caller)) headers.set("origin", origin);
    const request = new Request(url, {
      method: req.method,
      headers,
      ...(!["GET", "HEAD"].includes(req.method)
        ? { body: Buffer.concat(chunks) }
        : {}),
    });
    const response = await (url.pathname.startsWith("/admin/tv-update/")
      ? tvUpdateRoute(request, env, tvUpdate)
      : handle(request, env));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(
      JSON.stringify({ event: "request_failed", type: error.name }),
    );
    if (!res.headersSent)
      res.writeHead(500, { "Content-Type": "application/json" });
    res.end('{"error":"Service unavailable"}');
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.listen(Number(process.env.PORT || 3001), "127.0.0.1", () =>
  console.log("familytv gateway ready"),
);
const timer = setInterval(
  () =>
    Promise.all([cleanup(env), cleanTVUpdates(tvUpdate)]).catch((error) =>
      console.error(
        JSON.stringify({ event: "cleanup_failed", type: error.name }),
      ),
    ),
  3600000,
);
timer.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      clearInterval(timer);
      db.close();
      process.exit(0);
    }),
  );
