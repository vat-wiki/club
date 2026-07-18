// Shared error types and utilities for the club platform.
// Used by @club/sdk transport layer and any other package that needs
// consistent error handling across the HTTP/SSE boundary.

/**
 * Error thrown by the SDK transport layer. Carries the HTTP status when
 * one was received; synthetic errors (timeout, network) use conventional
 * non-2xx codes so callers can branch uniformly. A status of 0 denotes
 * a network failure with no HTTP response.
 */
export class ClubApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ClubApiError";
  }
}

/**
 * Safe extraction of a human-readable message from any thrown value.
 * `catch` blocks in JS may receive strings, plain objects, or Error instances;
 * the common `(err as Error).message` pattern yields `undefined` for strings
 * and non-Error objects, silently masking real failures. This helper covers
 * all three cases.
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
