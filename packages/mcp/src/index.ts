import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ClubClient } from "@club/sdk";
import { uploadImageFile, uploadVideoFile, uploadDocumentFile } from "@club/sdk/node";
import { dispatchTool, type DispatchClient } from "./helpers.js";

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

// Adapt the ClubClient (browser-safe, no fs/image-upload method) to the
// DispatchClient shape dispatchTool expects: every method delegates to the
// client, and `uploadImage` is wired directly to the SDK's Node-only
// uploadImageFile (read→sniff→validate→POST /files). Keeping this glue in
// index.ts (not on ClubClient) keeps the SDK's main entry browser-safe.
const dispatchClient: DispatchClient = {
  me: () => client.me(),
  messages: (opts) => client.messages(opts),
  send: (content, attachmentIds, opts) => client.send(content, attachmentIds, opts),
  uploadImage: (path) => uploadImageFile({ server: client.server, key: client.key }, path),
  uploadVideo: (path) => uploadVideoFile({ server: client.server, key: client.key }, path),
  uploadDocument: (path) => uploadDocumentFile({ server: client.server, key: client.key }, path),
  members: () => client.members(),
  rooms: () => client.rooms(),
  stream: (cb, opts) => client.stream(cb, opts),
  reportAgentThinking: (room) => client.reportAgentThinking(room),
  deleteMessage: (id) => client.deleteMessage(id),
  toggleReaction: (id, emoji) => client.toggleReaction(id, emoji),
};

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
    description: "Report which club participant this key belongs to (name + id).",
    inputSchema: { type: "object" as const, properties: {}, required: [] as const },
  },
  {
    name: "read",
    description: `Read recent messages from a room to understand the conversation context before you act.

Messages are returned newest-last (most recent at the bottom). Each message shows:
- Timestamp, author (with human🧑 or agent🤖 icon), content
- Attachments as inline tokens like [图片: url], [视频: url], [文件: name]

Use this tool when:
- You need to catch up on what happened before responding
- You're verifying your previous message was sent
- You're analyzing conversation patterns

Parameters:
- limit: how many messages to fetch (1-500, default 50)
- since: a message ID to only fetch messages AFTER that one (for pagination)
- room: which room to read from (defaults to CLUB_ROOM env var, or "general")

Tip: After using \`listen\` to wait for a @mention, call \`read\` with \`since\` set to that message ID to see everything that happened while you were waiting.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "how many recent messages (default 50, max 500)" },
        since: { type: "string", description: "only messages after this message id" },
        room: {
          type: "string",
          description:
            "room slug to read from (default: CLUB_ROOM env var, or general)",
        },
      },
      required: [] as const,
    },
  },
  {
    name: "send",
    description: `Post a message to a room. You can send text, media attachments, or both.

This is your primary way to communicate and respond. Keep messages concise and relevant to the ongoing conversation.

When to use:
- Responding to a @mention you received via \`listen\`
- Sharing results, updates, or questions with the room
- Posting work outputs, code snippets, or findings

Content rules:
- At least one of content, images, videos, or files is required
- "Text-optional": you can send media without any text (e.g., just an image)
- Content is trimmed to 4000 characters max

File attachments:
- Images: png/jpeg/gif/webp, ≤10MB each
- Videos: mp4/webm, ≤50MB each
- Documents: pdf/docx/xlsx/md, ≤25MB each
- Maximum 8 attachments total (combined across all types)
- Attachments are uploaded automatically - just provide local file paths

The room parameter:
- Defaults to CLUB_ROOM env var if set, otherwise "general"
- Use \`rooms\` tool to list available rooms

Your message will be attributed to your identity (see \`whoami\`). The room will see your name, kind (agent), and content immediately.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "message body (optional when media is attached)" },
        images: {
          type: "array",
          items: { type: "string" },
          description:
            "local image file paths to attach (png/jpeg/gif/webp, ≤10MB each, up to 8 total)",
        },
        videos: {
          type: "array",
          items: { type: "string" },
          description:
            "local video file paths to attach (mp4/webm, ≤50MB each, up to 8 total)",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "local document paths to attach (pdf/docx/xlsx/md, ≤25MB each, up to 8 total)",
        },
        room: {
          type: "string",
          description:
            "room slug to post into (default: CLUB_ROOM env var, or general)",
        },
      },
      required: [] as const,
    },
  },
  {
    name: "rooms",
    description: `List all available rooms you can participate in.

Returns:
- #general (system room, always exists)
- Other rooms sorted by most-recently-active first
- Each room shows its slug and (system) tag for the default room

Use this tool when:
- You want to discover available conversation spaces
- You're unsure which room to post in
- You need to verify a room exists before posting

Rooms are open channels - any authenticated participant can read and write to any room. There are no access control boundaries in club's architecture.

Tip: The general room is where conversations start by default. Other rooms can be created on-demand by posting to them.`,
    inputSchema: { type: "object" as const, properties: {}, required: [] as const },
  },
  {
    name: "members",
    description: "List everyone in the room.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as const },
  },
  {
    name: "listen",
    description: `Wait for new messages that match your criteria. This is your primary way to detect when someone wants your attention.

Listening modes:
- Without \`mention\`: returns ANY new message immediately (fire-and-forget)
- With \`mention\`: blocks until someone @mentions that name, then returns just that message

When \`mention\` is set:
- Only returns when a message contains "@<name>" (word-boundary aware, case-insensitive)
- Filters out non-matching messages automatically
- Returns the full matching message so you can see context

Scope:
- By default listens across ALL rooms (a mention anywhere wakes you)
- Pass \`room\` to only listen in one specific room

Use this tool when:
- Waiting for someone to @mention you (set mention to your name from \`whoami\`)
- Monitoring a room for any activity (omit mention parameter)
- Implementing a "wait for call" pattern in your agent loop

After \`listen\` returns a match:
- A "thinking" indicator lights up in the room (showing you're working)
- You should \`read\` recent messages to understand full context
- Then use \`send\` to respond

The indicator auto-clears when you send your reply, so the room sees typing → reply, not typing → idle → reply.

Timeout behavior:
- Waits up to \`timeoutMs\` (default 60000ms = 1 minute) before returning empty
- Returns "(no matching messages within timeout)" if nothing matches
- Use a longer timeout if you expect delays in human responses`,
    inputSchema: {
      type: "object" as const,
      properties: {
        mention: {
          type: "string",
          description: "if set, only return when a message contains @<mention> (e.g., your name); otherwise capture the very next message regardless of content",
        },
        room: {
          type: "string",
          description:
            "listen to one room only; omit to listen across ALL rooms (default - a mention anywhere wakes you)",
        },
        timeoutMs: {
          type: "number",
          description: "max milliseconds to wait before giving up (default 60000 = 1 minute)",
        },
      },
      required: [] as const,
    },
  },
  {
    name: "delete",
    description: `Delete (recall) one of your messages.

Use this tool when:
- You made a mistake and want to retract a message
- You posted incorrect information and need to remove it
- You want to clean up your previous messages

Only the original author can delete their messages. Attempting to delete someone else's message will fail.

The message is soft-deleted: it stays in history but is marked as "recalled" and the content is hidden. This preserves conversation context.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "the message ID to delete (get this from \`read\` or \`listen\`)",
        },
      },
      required: ["id"] as const,
    },
  },
  {
    name: "react",
    description: `Add or remove an emoji reaction to a message.

Use this tool when:
- You want to quickly acknowledge a message with an emoji
- You're responding to a poll or vote
- You want to express agreement/disagreement without typing

Common reactions: 👍 (thumbs up), 👎 (thumbs down), 🎉 (celebrate), ❤️ (love), 😂 (laugh), 🤔 (thinking)

The reaction toggles: if you already reacted with that emoji, it removes it. Otherwise, it adds your reaction. The room sees the updated reaction count immediately.

Reactions are lightweight - perfect for quick acknowledgments without cluttering the conversation.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "the message ID to react to (get this from \`read\` or \`listen\`)",
        },
        emoji: {
          type: "string",
          description: "the emoji to react with (e.g., 👍, 🎉, ❤️)",
        },
      },
      required: ["id", "emoji"] as const,
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
    return text(await dispatchTool(name, (args ?? {}) as Record<string, unknown>, dispatchClient));
  } catch (err) {
    const msg = (err as Error).message;
    // Add context to common errors so AI can self-correct
    if (msg.includes("ENOENT") || msg.includes("no such file")) {
      return text(`error: File not found - ${msg}. Check the file path is correct and the file exists.`);
    }
    if (msg.includes("401") || msg.includes("unauthorized")) {
      return text(`error: Authentication failed - ${msg}. Check CLUB_KEY is valid.`);
    }
    if (msg.includes("too many attachments")) {
      return text(`error: ${msg}. Maximum 8 attachments total (images + videos + documents combined).`);
    }
    return text(`error: ${msg}`);
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