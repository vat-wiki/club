import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { participants } from "./routes/participants.js";
import { messages } from "./routes/messages.js";
import { members } from "./routes/members.js";
import { me } from "./routes/me.js";
import { files } from "./routes/files.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const joinHtmlPath = resolve(__dirname, "public", "join.html");

const app = new Hono();

// CORS: the chat UI, CLI, and MCP all hit this backend. The web client runs on
// a different origin in dev (Vite), and agents call from anywhere.
app.use("*", cors());

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

app.get("/health", (c) => c.json({ ok: true }));

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

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`club server listening on http://${host}:${info.port}`);
  console.log(`  /join to mint a key · packages/web for the chat UI`);
});