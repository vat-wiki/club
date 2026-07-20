import type { ClubConn } from "@club/sdk";

const KEY = "club_key";
const SERVER = "club_server";
const RECOVER_CODE = "club_recover_code";

/**
 * Base URL of the club backend. Empty = same-origin (Vite proxies in dev;
 * in prod the backend can serve the built assets). Override with `VITE_API_URL`.
 *
 * When empty, `ClubClient` treats it as same-origin so no CORS issue occurs.
 */
export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

/**
 * Load the current `ClubConn` from `localStorage`.
 *
 * Reads the stored key (`club_key`) and server URL (`club_server`). If no
 * key is stored, the user is considered unauthenticated and `null` is
 * returned so callers can drive login flow.
 *
 * The server value falls back to `API_URL` (build-time default) when `club_server`
 * is missing, which covers the first-login path where the UI has not yet
 * observed the configured backend URL.
 *
 * @returns A `ClubConn` if a key is stored, `null` otherwise.
 * @example
 * const conn = loadConn();
 * if (conn) client = new ClubClient(conn);
 */
export function loadConn(): ClubConn | null {
  const key = localStorage.getItem(KEY);
  if (!key) return null;
  return { server: localStorage.getItem(SERVER) ?? API_URL, key };
}

/**
 * Persist a newly acquired auth key and the current server URL to `localStorage`.
 *
 * Called once the server returned a participant key (login / recovery / account
 * creation). `SERVER` is written so that `loadConn()` reconstructs the
 * correct `ClubConn` after a page reload even when `API_URL` (build-time env)
 * differs from the runtime URL the user landed on.
 *
 * @param key - The participant key returned by the backend.
 */
export function saveConn(key: string) {
  localStorage.setItem(KEY, key);
  localStorage.setItem(SERVER, API_URL);
}

/**
 * Persist the recovery code for the current participant.
 *
 * The recovery code is shown once at account creation and may be re-displayed
 * via the "View Key" dialog. Callers that need to re-display it should use
 * `getRecoverCode()` rather than storing it again.
 *
 * @param recoverCode - The one-time recovery code returned by
 *   `POST /participants/recover` or account creation.
 */
export function saveRecoverCode(recoverCode: string) {
  localStorage.setItem(RECOVER_CODE, recoverCode);
}

/**
 * Read the stored recovery code, if any.
 *
 * @returns The recovery code string, or `null` when it was never stored or
 *   has been cleared (e.g. via `clearConn()`).
 */
export function getRecoverCode(): string | null {
  return localStorage.getItem(RECOVER_CODE);
}

/**
 * Clear all persisted auth state — key, server URL, and recovery code.
 *
 * Called on explicit sign-out so the user is returned to the login screen on
 * the next page load. Does **not** delete server-side data (the participant
 * still exists and may be recovered via the stored recovery code before it
 * was cleared).
 */
export function clearConn() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(SERVER);
  localStorage.removeItem(RECOVER_CODE);
}

/**
 * Read the stored participant key without constructing a full `ClubConn`.
 *
 * Used by UI that just wants to display or copy the raw key (e.g. the
 * "View Key" dialog). The returned value may briefly differ from an
 * in-memory `conn.key`, but for display purposes that is acceptable.
 *
 * @returns The participant key, or `null` when no key is stored.
 */
export function getKey(): string | null {
  return localStorage.getItem(KEY);
}