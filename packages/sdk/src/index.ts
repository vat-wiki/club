// @club/sdk — a typed client for a club server. The transport layer (REST +
// SSE) is fully usable on its own via the exported functions; ClubClient is a
// stateful convenience wrapper. Domain types and zod schemas are re-exported
// from @club/shared so consumers can import everything from one package.
//
// This main entry is BROWSER-SAFE: it has no Node-only imports (no node:fs,
// no image-size), so the web app can bundle `ClubClient`/`request`/types from
// here. The Node image-upload helper (uploadImageFile / assertAttachmentCount) is
// kept off this entry to avoid pulling fs into the browser bundle — Node
// consumers (cli, mcp) import it from the `@club/sdk/node` subpath instead.

export * from "./client.js";
export * from "./errors.js";
export * from "./format.js";
export * from "./stream.js";
export * from "./transport.js";
export * from "@club/shared";
