import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { participants } from "./routes/participants.js";
import { messages } from "./routes/messages.js";
import { members } from "./routes/members.js";
import { me } from "./routes/me.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const joinHtmlPath = resolve(__dirname, "public", "join.html");

const app = new Hono();

// CORS: the chat UI, CLI, and MCP all hit this backend. The web client runs on
// a different origin in dev (Vite), and agents call from anywhere.
app.use("*", cors());

// Key-issuance page: mint a key + copy the CLI/MCP onboarding snippets.
// The React web app (packages/web) is the friendly chat UI, served separately.
app.get("/", (c) => c.redirect("/join"));
app.get("/join", async (c) => {
  const html = await readFile(joinHtmlPath, "utf8");
  return c.html(html);
});

app.route("/participants", participants);
app.route("/me", me);
app.route("/messages", messages);
app.route("/members", members);

app.get("/health", (c) => c.json({ ok: true }));

app.notFound((c) => c.json({ error: "not found" }, 404));

const port = Number(process.env.PORT ?? 6200);
const host = process.env.HOST ?? "0.0.0.0";

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`club server listening on http://${host}:${info.port}`);
  console.log(`  /join to mint a key · packages/web for the chat UI`);
});