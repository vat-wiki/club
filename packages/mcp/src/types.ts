// ── MCP tool argument contracts ────────────────────────────────────────
// One named interface per MCP tool, mirroring the inputSchema in index.ts.
// `dispatchTool` consumes the discriminated union so a misspelled parameter at
// the call site is caught by the compiler rather than silently falling through
// to a runtime coercion in str() / num() / clampLimit().
//
// These types are internal to the MCP package; they are NOT part of the public
// MCP schema served to clients (that is owned by TOOLS in index.ts), but they
// keep the dispatcher's switch body honest and give callers of dispatchTool
// IDE autocomplete and compile-time guarantees.

/** Arguments accepted by the `whoami` tool (none). */
export interface WhoamiArgs {
  [key: string]: never;
}

/** Arguments accepted by the `read` tool. */
export interface ReadArgs {
  /** How many recent messages to fetch. Default 50, clamped to [1, 500]. */
  limit?: number;
  /** Return only messages after this message id (forward pagination). */
  since?: string;
  /** Room slug to read from (default: CLUB_ROOM env var, or "general"). */
  room?: string;
}

/** Arguments accepted by the `send` tool. */
export interface SendArgs {
  /** Message body (optional when media is attached). */
  content?: string;
  /** Local image file paths to attach. */
  images?: string[];
  /** Local video file paths to attach. */
  videos?: string[];
  /** Local document file paths to attach. */
  files?: string[];
  /** Room slug to post into (default: CLUB_ROOM env var, or "general"). */
  room?: string;
}

/** Arguments accepted by the `rooms` tool (none). */
export interface RoomsArgs {
  [key: string]: never;
}

/** Arguments accepted by the `members` tool (none). */
export interface MembersArgs {
  [key: string]: never;
}

/** Arguments accepted by the `listen` tool. */
export interface ListenArgs {
  /** If set, only return when a message contains @<mention>. */
  mention?: string;
  /** Listen in one room only; omit to listen across all rooms. */
  room?: string;
  /** Max milliseconds to wait (default 60000). */
  timeoutMs?: number;
}

/** Arguments accepted by the `delete` tool. */
export interface DeleteArgs {
  /** The message ID to delete. */
  id: string;
}

/** Arguments accepted by the `react` tool. */
export interface ReactArgs {
  /** The message ID to react to. */
  id: string;
  /** The emoji to react with (e.g. 👍, 🎉, ❤️). */
  emoji: string;
}

/**
 * Discriminated union of all MCP tool argument shapes. Exhaustive over the
 * TOOLS catalogue. Adding a new tool requires a new member on this union
 * and a new case in the dispatcher switch — the union keeps the switch from
 * being silently incomplete.
 */
export type ToolArgs =
  | { name: "whoami"; args: WhoamiArgs }
  | { name: "read"; args: ReadArgs }
  | { name: "send"; args: SendArgs }
  | { name: "rooms"; args: RoomsArgs }
  | { name: "members"; args: MembersArgs }
  | { name: "listen"; args: ListenArgs }
  | { name: "delete"; args: DeleteArgs }
  | { name: "react"; args: ReactArgs };

/**
 * Extract the concrete Args type for a given tool name.
 *
 * @example
 * type ReadShape = ArgsFor<"read">;  // → ReadArgs
 */
export type ArgsFor<N extends ToolArgs["name"]> = Extract<ToolArgs, { name: N }>["args"];
