import { Hono } from "hono";
import type { Participant } from "@club/shared";
import { getAllParticipants } from "../db.js";
import { requireAuth } from "../auth.js";

export const members = new Hono();
members.use("*", requireAuth);

// DB rows are snake_case; the API must return the shared Participant contract
// (camelCase). Mirrors toMessage() in routes/messages.ts. Without this the
// endpoint leaked `created_at`, silently breaking the Participant shape that
// every client (and sdk's members(): Promise<Participant[]>) depends on — TS
// can't catch it because fetch results are untyped at runtime.
function toParticipant(r: {
  id: string;
  name: string;
  kind: "human" | "agent";
  created_at: number;
}): Participant {
  return { id: r.id, name: r.name, kind: r.kind, createdAt: r.created_at };
}

// GET /members -> Participant[] (ordered by createdAt asc)
members.get("/", (c) => c.json(getAllParticipants().map(toParticipant)));