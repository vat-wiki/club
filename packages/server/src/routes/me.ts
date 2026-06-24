import { Hono } from "hono";
import { requireAuth } from "../auth.js";

export const me = new Hono();
me.use("*", requireAuth);

// GET /me -> current participant
me.get("/", (c) => c.json(c.get("participant")));