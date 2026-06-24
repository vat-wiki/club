import type {
  CreateParticipantRequest,
  CreateParticipantResponse,
  ListMessagesQuery,
  Message,
  Participant,
} from "@club/shared";
import { ClubApiError } from "./errors.js";

// ── Connection ──────────────────────────────────────────────────────
// key is optional: createParticipant() needs no auth, so a client can be
// built with just { server } to mint a key, then rebuilt with that key.
export interface ClubConn {
  server: string; // base URL, e.g. http://localhost:6200
  key?: string; // club_<kind>_<...> bearer token
}

export interface CallOpts {
  timeoutMs?: number;
  retries?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

function authHeaders(c: ClubConn): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (c.key) h.Authorization = `Bearer ${c.key}`;
  return h;
}

// ── Response handling ───────────────────────────────────────────────
async function check<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new ClubApiError(msg, res.status);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

// ── Retry / timeout policy (pure, exported for testing) ─────────────

/** Whether a response of this status on this method is worth retrying. */
export function shouldRetry(method: string, status: number): boolean {
  // Only idempotent reads are retried; POST /messages is never retried
  // (a retry could duplicate the message).
  if (method !== "GET") return false;
  return status === 429 || status >= 500;
}

/** Deterministic exponential backoff (ms) for a 0-based attempt. */
export function computeBackoff(attempt: number, base = 200, cap = 2000): number {
  return Math.min(cap, base * 2 ** attempt);
}

function jitteredBackoff(attempt: number): number {
  // Full jitter: 50–100% of the exponential value, capped at 2s.
  return computeBackoff(attempt) * (0.5 + Math.random() * 0.5);
}

function wrapErr(err: unknown): ClubApiError {
  if (err instanceof ClubApiError) return err;
  if ((err as Error)?.name === "AbortError") return new ClubApiError("request timeout", 408);
  return new ClubApiError((err as Error)?.message ?? "network error", 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface RequestOptions extends CallOpts {
  method?: string;
  body?: unknown;
}

// Core request: typed JSON over fetch, with per-request timeout and retry on
// transient failures (network errors / timeouts / 429 / 5xx) for idempotent
// GETs only.
export async function request<T>(
  c: ClubConn,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // POSTs and other non-GETs are never retried.
  const maxRetries = method === "GET" ? opts.retries ?? DEFAULT_RETRIES : 0;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(jitteredBackoff(attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${c.server}${path}`, {
        method,
        headers: authHeaders(c),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (shouldRetry(method, res.status) && attempt < maxRetries) continue;
      return await check<T>(res);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const transient =
        (err as Error)?.name === "AbortError" || err instanceof TypeError;
      if (!(method === "GET" && transient && attempt < maxRetries)) {
        throw wrapErr(err);
      }
      // transient failure on an idempotent read with retries left → loop
    }
  }
  throw wrapErr(lastErr);
}

// ── REST endpoints ──────────────────────────────────────────────────

export async function getMe(c: ClubConn, opts: CallOpts = {}): Promise<Participant> {
  return request<Participant>(c, "/me", opts);
}

export async function listMessages(
  c: ClubConn,
  opts: ListMessagesQuery & CallOpts = {},
): Promise<Message[]> {
  const params = new URLSearchParams();
  if (opts.since) params.set("since", opts.since);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const { since: _s, limit: _l, ...callOpts } = opts;
  const qs = params.toString();
  return request<Message[]>(c, `/messages${qs ? "?" + qs : ""}`, callOpts);
}

export async function sendMessage(
  c: ClubConn,
  content: string,
  opts: { timeoutMs?: number } = {},
): Promise<Message> {
  return request<Message>(c, "/messages", { method: "POST", body: { content }, ...opts });
}

export async function listMembers(c: ClubConn, opts: CallOpts = {}): Promise<Participant[]> {
  return request<Participant[]>(c, "/members", opts);
}

// Mint a participant + single-use key. Unauthenticated (POST /participants);
// accepts a connection with no key so callers can bootstrap.
export async function createParticipant(
  c: Pick<ClubConn, "server">,
  input: CreateParticipantRequest,
  opts: { timeoutMs?: number } = {},
): Promise<CreateParticipantResponse> {
  return request<CreateParticipantResponse>(c, "/participants", {
    method: "POST",
    body: input,
    ...opts,
  });
}
