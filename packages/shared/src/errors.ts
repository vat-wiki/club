// Shared error types and utilities for the club platform.
// Used by @club/sdk transport layer and any other package that needs
// consistent error handling across the HTTP/SSE boundary.

/**
 * Closed union of valid HTTP status codes (100-511), minus the few reserved
 * codes the platform should never emit. Keeps status branching exhaustive.
 */
export type HttpStatusCode =
  | 100 | 101 | 102 | 103
  | 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226
  | 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308
  | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410
  | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418
  | 421 | 422 | 423 | 424 | 425 | 426
  | 428 | 429 | 431
  | 451
  | 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511;

/**
 * Sentinel used when no HTTP response was received (timeout, DNS failure,
 * TCP reset, etc.). Kept outside `HttpStatusCode` so consumers can tell
 * "real HTTP code" from "network failure" at the type level.
 */
export const NETWORK_ERROR_STATUS = 0 as const;
export type NetworkFailureStatus = typeof NETWORK_ERROR_STATUS;

/**
 * The only values that may flow through a `ClubApiError`. Closing this union
 * turns `ClubApiError.status` into a type-level assertion: callers can't
 * accidentally construct `new ClubApiError(msg, 9999)` — the compiler
 * catches it before it reaches retry/backoff/toast branching code.
 *
 * Runtime narrowing of raw `res.status` into this union is handled by
 * `parseHttpErrorStatus()` so exotic codes from reverse proxies surface
 * as TypeErrors during construction rather than poisoning downstream branches.
 */
export type ClubApiErrorStatus = HttpStatusCode | NetworkFailureStatus;

/**
 * Closed set of status codes that `ClubApiError` may carry at runtime.
 * Mirrors {@link HttpStatusCode} exactly, plus the network-failure sentinel.
 * Enumerated so the runtime guard can reject exotic codes (419, 452, 509,
 * etc.) that fall inside the raw 100-511 HTTP range but are excluded from
 * the type-level union. Any code not listed here throws a TypeError, keeping
 * the runtime contract in sync with the type contract.
 */
const ALLOWED_CLUB_API_ERROR_STATUSES = new Set<ClubApiErrorStatus>([
  NETWORK_ERROR_STATUS,
  100, 101, 102, 103,
  200, 201, 202, 203, 204, 205, 206, 207, 208, 226,
  300, 301, 302, 303, 304, 305, 306, 307, 308,
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410,
  411, 412, 413, 414, 415, 416, 417, 418,
  421, 422, 423, 424, 425, 426,
  428, 429, 431,
  451,
  500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
]);

/**
 * Type guard: is a numeric status the network-failure sentinel?
 *
 * Enables clean discriminated-union branching on `ClubApiErrorStatus`
 * without manual `err.status === 0` comparisons scattered across callers:
 *
 * ```ts
 * if (isNetworkFailure(err.status)) {
 *   // DNS/timeout branch
 * }
 * ```
 *
 * @param status - A `ClubApiErrorStatus` value.
 * @returns `true` if `status` is `NETWORK_ERROR_STATUS` (0).
 */
export function isNetworkFailure(
  status: ClubApiErrorStatus,
): status is NetworkFailureStatus {
  return status === NETWORK_ERROR_STATUS;
}

/**
 * Safely narrow a raw HTTP response status into `ClubApiErrorStatus`.
 *
 * Raw `res.status` is typed `number`; blindly casting `as ClubApiErrorStatus`
 * lets exotic codes (e.g. reverse-proxy 418, 452, 509) slip past type
 * checking and poison downstream branching. This helper validates against the
 * closed set of allowed codes, so unrecognised statuses surface as TypeErrors
 * during construction rather than leaking into retry/backoff/toast branches.
 *
 * @param status - A raw HTTP status code from a Response.
 * @returns The narrowed status.
 * @throws {TypeError} With the code when `status` is not in `HttpStatusCode`
 * and is not the network-failure sentinel.
 */
export function parseHttpErrorStatus(status: number): ClubApiErrorStatus {
  // Network sentinel — not an HTTP code but always valid in our union.
  if (status === NETWORK_ERROR_STATUS) return status;
  // Validate against the closed set of allowed codes. A bare 100-511 range
  // check would accept exotic codes excluded from HttpStatusCode (e.g. 419,
  // 452, 509); reject those so the runtime contract matches the type contract.
  if (
    typeof status === "number" &&
    Number.isInteger(status) &&
    ALLOWED_CLUB_API_ERROR_STATUSES.has(status as ClubApiErrorStatus)
  ) {
    return status as ClubApiErrorStatus;
  }
  throw new TypeError(`unexpected HTTP status for ClubApiError: ${status}`);
}

/**
 * Error thrown by the SDK transport layer. Carries the HTTP status when
 * one was received; synthetic errors (timeout, network) use the canonical
 * sentinel `NETWORK_ERROR_STATUS` so callers can branch uniformly.
 *
 * `status` is narrowed to `ClubApiErrorStatus` — only real HTTP codes
 * (100-511) or the network-failure sentinel (0) — so every consumer gets
 * a compile-time guarantee that exotic numeric statuses can't slip in.
 *
 * Use `isClubApiError()` to narrow from `unknown` instead of casting:
 *
 * ```ts
 * try { await client.getMe() } catch (err) {
 *   if (isClubApiError(err) && err.status === 429) { /* back off *\/ }
 * }
 * ```
 */
export class ClubApiError extends Error {
  constructor(message: string, public status: ClubApiErrorStatus) {
    super(message);
    this.name = "ClubApiError";
  }
}

/**
 * Type guard for `ClubApiError`. Replaces `(err as ClubApiError)` assertions
 * scattered across consumers with a single, reusable, compiler-checked
 * predicate.
 *
 * Stricter than `err instanceof ClubApiError` alone: also verifies that
 * `status` is a non-negative integer, so a manually-forged object (e.g. a
 * JSON-deserialized payload that happens to have `.name === "ClubApiError"`)
 * won't be accepted.
 *
 * @returns `true` if `err` is a genuine `ClubApiError` instance with a valid status.
 */
export function isClubApiError(err: unknown): err is ClubApiError {
  return (
    err instanceof ClubApiError &&
    typeof err.status === "number" &&
    Number.isInteger(err.status) &&
    err.status >= 0
  );
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
