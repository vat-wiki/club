import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getMe,
  listMessages,
  sendMessage,
  listMembers,
  streamMessages,
  formatMessage,
  type ClubConn,
} from "@club/sdk";
import type { Message } from "@club/shared";
import { clampLimit, num, str } from "./helpers.js";

// ── Connection config ────────────────────────────────────────────────
// Resolve from env (preferred for `claude mcp add ... -e CLUB_KEY=...`)
// with fallbacks to mirror how a human would `club login` first.
function resolveConn(): ClubConn {
  const key = process.env.CLUB_KEY;
  if (!key) {
    console.error("[club-mcp] CLUB_KEY env var not set. Get a key at the /participants page;");
    console.error("[club-mcp] then start with CLUB_KEY=club_... CLUB_SERVER=http://localhost:6200 club-mcp");
    process.exit(1);
  }
  const server = (process.env.CLUB_SERVER ?? "http://localhost:6200").replace(/\/$/, "");
  return { server, key };
}

const conn = resolveConn();

const server = new Server(
  { name: "club", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ── Tool catalogue ────────────────────────────────────────────────────
// Deliberately tiny: this server is meant for an autonomous dispatch/relay
// agent. The CLI is what humans + their coding assistants use; the MCP
// surface is the minimal set a dispatcher bot needs.
const TOOLS = [
  {
    name: "whoami",
    description: "Report which club participant this key belongs to (name + kind).",
    inputSchema: { type: "object" as const, properties: {}, required: [] as const },
  },
  {
    name: "read",
    description:
      "Read recent chat-room messages. Newest last. Use to catch up on the conversation before acting. Pass --since (a message id) to get only messages after that one.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "how many recent messages (default 50, max 500)" },
        since: { type: "string", description: "only messages after this message id" },
      },
      required: [] as const,
    },
  },
  {
    name: "send",
    description: "Post a message to the room as this participant. Keep it relevant.",
    inputSchema: {
      type: "object" as const,
      properties: { content: { type: "string", description: "message body" } },
      required: ["content"] as const,
    },
  },
  {
    name: "members",
    description: "List everyone in the room (humans and agents).",
    inputSchema: { type: "object" as const, properties: {}, required: [] as const },
  },
  {
    name: "listen",
    description:
      "Wait for new messages. Optionally block until someone @mentions a given name, then return just that message and stop. Returns one or more matched messages. Use this to detect when the room is calling on you.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mention: {
          type: "string",
          description: "if set, only return when a message contains @<mention>; otherwise capture the next message(s)",
        },
        timeoutMs: {
          type: "number",
          description: "max milliseconds to wait before giving up (default 60000)",
        },
      },
      required: [] as const,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// ── Tool dispatcher ────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "whoami": {
        const me = await getMe(conn);
        return text(`You are ${me.name} (${me.kind}). id=${me.id}`);
      }
      case "read": {
        const limit = clampLimit(a.limit);
        const msgs = await listMessages(conn, { since: str(a.since), limit });
        if (msgs.length === 0) return text("(no messages)");
        return text(msgs.map(formatMessage).join("\n"));
      }
      case "send": {
        const content = str(a.content);
        if (!content) return text("error: missing content");
        const m = await sendMessage(conn, content);
        return text(`sent: ${formatMessage(m)}`);
      }
      case "members": {
        const list = await listMembers(conn);
        if (list.length === 0) return text("(no members)");
        return text(list.map((p) => `${p.kind === "agent" ? "🤖" : "🧑"}${p.name}`).join("\n"));
      }
      case "listen": {
        const mention = str(a.mention) || undefined;
        const timeoutMs = num(a.timeoutMs) ?? 60000;
        return await runListen(mention, timeoutMs);
      }
      default:
        return text(`error: unknown tool "${name}"`);
    }
  } catch (err) {
    return text(`error: ${(err as Error).message}`);
  }
});

// ── listen impl: stream until a @mention match (or timeout) ───────────
// MCP tool calls are synchronous request/response — we can't keep a stream
// open across calls. So `listen` holds the connection for the duration of
// ONE tool call, completes on the first match, and returns. A dispatcher
// agent loops `listen` in its run loop to stay "present".
function runListen(mention: string | undefined, timeoutMs: number): Promise<{ content: any[] }> {
  return new Promise((resolve) => {
    const matched: Message[] = [];
    const token = mention ? "@" + mention.toLowerCase() : null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      sub.stop();
      clearTimeout(timer);
      if (matched.length > 0) {
        resolve(text(matched.map(formatMessage).join("\n")));
      } else {
        resolve(text("(no matching messages within timeout)"));
      }
    };

    const sub = streamMessages(conn, (m) => {
      if (token && !m.content.toLowerCase().includes(token)) return;
      matched.push(m);
      finish(); // first match → return (mirrors `listen --once`)
    });

    const timer = setTimeout(finish, timeoutMs);
  });
}

// ── helpers ────────────────────────────────────────────────────────────
function text(s: string) {
  return { content: [{ type: "text", text: s }] };
}
// str / num / clampLimit live in ./helpers.ts (pure + unit-tested).

// ── wire up stdio transport ────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);