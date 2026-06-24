import type { ClubConn } from "@club/sdk";

const KEY = "club_key";
const SERVER = "club_server";

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

export function clearConn() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(SERVER);
}