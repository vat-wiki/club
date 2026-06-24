// @club/sdk — a typed client for a club server. The transport layer (REST +
// SSE) is fully usable on its own via the exported functions; ClubClient is a
// stateful convenience wrapper. Domain types and zod schemas are re-exported
// from @club/shared so consumers can import everything from one package.

export * from "@club/shared";
export * from "./errors.js";
export * from "./transport.js";
export * from "./stream.js";
export * from "./format.js";
export * from "./client.js";
