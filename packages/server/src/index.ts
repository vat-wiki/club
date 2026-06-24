import { serve } from "@hono/node-server";
import { Hono } from "hono";
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

// Key-issuance page. Served from disk so it stays editable without a build.
app.get("/", async (c) => {
  const html = await readFile(joinHtmlPath, "utf8");
  return c.html(html);
});

app.route("/participants", participants);
app.route("/me", me);
app.route("/messages", messages);
app.route("/members", members);

app.notFound((c) => c.json({ error: "not found" }, 404));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`club server listening on http://${host}:${info.port}`);
  console.log(`  open / to issue a key`);
});