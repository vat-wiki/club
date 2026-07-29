import { defineConfig } from "tsup";

// Bundle the server into a single self-contained ESM file for npm publishing
// as the unscoped `club-serve` package (mirrors club-cli). @club/* workspace
// packages (shared) are inlined so the published package has zero @club/*
// runtime deps; real npm packages stay external and resolve from node_modules
// at runtime — crucially better-sqlite3, whose native addon (.node binding)
// cannot be bundled and must be installed by the consumer.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  // Inline workspace packages (not published to npm):
  noExternal: [/^@club\//],
  // Keep real npm runtime deps external (declared in dependencies). hono and
  // @hono/node-server are imported with subpaths (hono/cors, @hono/node-server/
  // serve-static …) so match by prefix.
  external: [
    "better-sqlite3",
    "image-size",
    "ulid",
    "zod",
    /^hono(\/|$)/,
    /^@hono\//,
  ],
});
