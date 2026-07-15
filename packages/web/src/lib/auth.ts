import type { ClubConn } from "@club/sdk";

const KEY = "club_key";
const SERVER = "club_server";
const RECOVER_CODE = "club_recover_code";

// Base URL of the club backend. Empty = same-origin (Vite proxies in dev;
// in prod the backend can serve the built assets). Override with VITE_API_URL.
export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

export function loadConn(): ClubConn | null {
  const key = localStorage.getItem(KEY);
  if (!key) return null;
  return { server: localStorage.getItem(SERVER) ?? API_URL, key };
}

export function saveConn(key: string) {
  localStorage.setItem(KEY, key);
  localStorage.setItem(SERVER, API_URL);
}

export function saveRecoverCode(recoverCode: string) {
  localStorage.setItem(RECOVER_CODE, recoverCode);
}

export function getRecoverCode(): string | null {
  return localStorage.getItem(RECOVER_CODE);
}

export function clearConn() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(SERVER);
  localStorage.removeItem(RECOVER_CODE);
}

// Read the current key from storage without constructing a full ClubConn.
// Used by UI that just wants to display/copy the key (it may differ from the
// in-memory conn.key briefly, but for display purposes that's fine).
export function getKey(): string | null {
  return localStorage.getItem(KEY);
}