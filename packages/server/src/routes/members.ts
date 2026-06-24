import { Hono } from "hono";
import { getAllParticipants } from "../db.js";
import { requireAuth } from "../auth.js";

export const members = new Hono();
members.use("*", requireAuth);

// GET /members -> [{ id, name, kind, createdAt }]
members.get("/", (c) => c.json(getAllParticipants()));