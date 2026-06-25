import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ClubClient } from "@club/sdk";
import { dispatchTool } from "./helpers.js";

// ── Connection config ────────────────────────────────────────────────
// Resolve from env (preferred for `claude mcp add ... -e CLUB_KEY=...`)
// with fallbacks to mirror how a human would `club login` first.
function resolveConn(): { server: string; key: string } {
  const key = process.env.CLUB_KEY;
  if (!key) {
    console.error("[club-mcp] CLUB_KEY env var not set. Get a key at the /participants page;");
    console.error("[club-mcp] then start with CLUB_KEY=club_... CLUB_SERVER=http://localhost:6200 club-mcp");
    process.exit(1);
  }
  const server = (process.env.CLUB_SERVER ?? "http://localhost:6200").replace(/\/$/, "");
  return { server, key };
}

const client = new ClubClient(resolveConn());

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
// dispatchTool() lives in ./helpers.ts (pure + unit-tested, with the client
// injected). The handler shuttles the MCP request into it and wraps either the
// returned text or a thrown error as a tool text response.
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    return text(await dispatchTool(name, (args ?? {}) as Record<string, unknown>, client));
  } catch (err) {
    return text(`error: ${(err as Error).message}`);
  }
});

// ── listen impl: stream until a @mention match (or timeout) ───────────
// listenForMatch() lives in ./helpers.ts (pure + unit-tested, with the stream
// injected). MCP tool calls are synchronous request/response — we can't keep a
// stream open across calls — so `listen` holds the connection for ONE call,
// completes on the first match, and returns. A dispatcher agent loops it.

// ── helpers ────────────────────────────────────────────────────────────
function text(s: string) {
  return { content: [{ type: "text", text: s }] };
}
// str / num / clampLimit live in ./helpers.ts (pure + unit-tested).

// ── wire up stdio transport ────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);