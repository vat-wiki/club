import { createMiddleware } from "hono/factory";

// Content-type guard: reject non-JSON POST bodies to prevent content-type
// spoofing (e.g. sending form-data that a route might still try to parse).
// Accepts empty Content-Type (common in test harnesses that JSON.stringify
// the body without an explicit header).
//
// Shared across all routes that accept JSON; defined once to keep the error
// message and 415 status consistent server-wide.
export const requireJson = createMiddleware(async (c, next) => {
  const ct = c.req.header("content-type");
  if (ct && !ct.toLowerCase().startsWith("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 415);
  }
  await next();
});
