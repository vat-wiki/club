import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { bodySizeGuard } from "./body-size-guard.js";
import { getClientIp, rateLimit } from "./rate-limit.js";
import { agents } from "./routes/agents.js";
import { files } from "./routes/files.js";
import { me } from "./routes/me.js";
import { members } from "./routes/members.js";
import { messages } from "./routes/messages.js";
import { participants } from "./routes/participants.js";
import { rooms } from "./routes/rooms.js";
import { securityHeaders } from "./security-headers.js";
import { heartbeatInterval } from "./stream.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const joinHtmlPath = resolve(__dirname, "public", "join.html");

const app = new Hono();

// Global rate limiter: 120 requests per minute per IP (generous for read paths).
// Proxy headers are read only when TRUSTED_PROXY=true — defaulting to socket
// address for direct connections prevents forwarding-header spoofing bypasses.
// This keeps the rate limiter effective even when the server is not behind a
// trusted reverse proxy.
app.use("*", rateLimit({
  max: 120,
  windowMs: 60_000,
  key: (c) => getClientIp(c, () => getConnInfo(c)),
}));

// Security headers: CSP, HSTS, X-Content-Type-Options, etc.
app.use("*", securityHeaders);

// Request-body size guard: reject oversized JSON bodies with 413 before
// they are buffered into memory. Uploads (multipart) are bounded by a
// per-kind cap in the files route; this cap protects the small-payload
// JSON endpoints (messages, reactions, room creation, etc.) from a
// request-body DoS where an attacker advertises a multi-hundred-MB body.
app.use("*", bodySizeGuard());

// CORS: the chat UI, CLI, and MCP all hit this backend. Restrict origins
// via ALLOWED_ORIGINS (comma-separated) when set; falls back to open "*"
// for dev/internal LAN use (where TLS is typically not present).
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const corsOpts = allowedOrigins.length > 0 ? { origin: allowedOrigins, credentials: true } : undefined;
app.use("*", cors(corsOpts));

// Key-issuance page: mint a key + copy the CLI/MCP onboarding snippets.
// The React web app (packages/web) is the friendly chat UI, served separately.
app.get("/join", async (c) => {
  const html = await readFile(joinHtmlPath, "utf8");
  return c.html(html);
});

app.route("/participants", participants);
app.route("/me", me);
app.route("/messages", messages);
app.route("/members", members);
app.route("/files", files);
app.route("/agents", agents);
app.route("/rooms", rooms);

// Health check endpoint. Returns 200 with basic server status. This endpoint
// is intentionally lightweight (no DB queries) so it can be used for liveness
// probes without adding load. For a fuller "readiness" check, clients should
// hit an authenticated endpoint like GET /me.
app.get("/health", (c) => c.json({ ok: true, uptime: process.uptime() }));

// Production: serve the built web UI (packages/web/dist) at the same origin so
// the SPA ships without a separate host. In dev the Vite app runs on :6100 and
// proxies API calls here. serveStatic's root is relative to cwd, so this only
// matches when cwd is the repo root (true for `node packages/server/dist/index.js`);
// the existsSync guard keeps dev/standalone runs untouched.
const webDistDir = resolve(process.cwd(), "packages", "web", "dist");
if (existsSync(webDistDir)) {
  // Root serves the chat SPA, which decides what to show: a stored key logs
  // straight into the room, and no key opens the auth dialog. Previously "/"
  // did an unconditional redirect to "/join", which re-landed returning users
  // on the "mint a key" page even when they already had a valid key — so a
  // user who joined yesterday saw the sign-up form again today.
  app.get("/", async (c) =>
    c.html(await readFile(join(webDistDir, "index.html"), "utf-8")),
  );
  app.use("/*", serveStatic({ root: "packages/web/dist" }));
  // SPA fallback: any unmatched GET returns index.html so deep links resolve.
  app.get("/*", async (c) =>
    c.html(await readFile(join(webDistDir, "index.html"), "utf-8")),
  );
} else {
  // Dev: the SPA isn't built here (Vite serves it on :6100), so root still
  // points at the key-mint page.
  app.get("/", (c) => c.redirect("/join"));
}

app.notFound((c) => c.json({ error: "not found" }, 404));

const port = Number(process.env.PORT ?? 6200);
const host = process.env.HOST ?? "0.0.0.0";

// Best practice: log the actual listening address (host/port) after the kernel
// allocates the socket, so log output matches reality when HOST=0.0.0.0 or
// PORT is defaulted. Listen errors (EADDRINUSE / EACCES) are caught via the
// returned server's error event and surfaced with a clear message + exit code
// rather than an unhandled exception that drops a raw stack trace.
const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`club server listening on http://${host}:${info.port}`);
  console.log(`  /join to mint a key · packages/web for the chat UI`);
});

// Catch listen errors after `serve()` returns: EADDRINUSE means the port is
// already taken; EACCES means the process lacks privilege for a port < 1024.
// Once the socket is bound the listener fires and these never trigger, so the
// one-time flag ensures we don't log on a later, unrelated error.
let listenErrorHandled = false;
server.on("error", (error: NodeJS.ErrnoException) => {
  if (listenErrorHandled) return;
  listenErrorHandled = true;
  let exitCode = 1;
  let msg = `failed to listen: ${error}`;
  if (error.code === "EADDRINUSE") {
    msg = `port ${port} is already in use; another server is listening on it. Set PORT to a different value and try again.`;
  } else if (error.code === "EACCES") {
    msg = `permission denied binding to port ${port} (ports < 1024 require elevated privileges). Set PORT to 1024 or higher.`;
    exitCode = 126;
  }
  console.error(`[club server] ${msg}`);
  process.exit(exitCode);
});

// Best practice: catch unhandled promise rejections and uncaught exceptions so
// they log a readable message and exit 1 instead of crashing with an opaque
// stack trace. Mirrors the safety net in packages/mcp/src/index.ts so the two
// entry points behave identically.
process.on("unhandledRejection", (err) => {
  console.error(`[club server] Unhandled rejection: ${err}`);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error(`[club server] Uncaught exception: ${err}`);
  process.exit(1);
});

function shutdown(signal: string) {
  console.log(`[club server] ${signal} received; draining connections…`);
  clearInterval(heartbeatInterval);
  server.close(() => {
    console.log("[club server] all connections closed; exiting");
    process.exit(0);
  });
  // Force exit after a short grace period if connections are stuck open (e.g.
  // a stalled SSE stream), so `SIGTERM` from a container runtime still wins.
  setTimeout(() => {
    console.warn("[club server] shutdown timed out; forcing exit");
    process.exit(1);
  }, 5000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
