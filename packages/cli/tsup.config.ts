import { defineConfig } from "tsup";

// Bundle the CLI into a single self-contained ESM file for npm publishing.
// The @vatwiki/* workspace packages (shared, sdk) are inlined so the published
// package has zero @vatwiki/* runtime deps; only real npm packages stay external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  // Inline workspace packages (not on npm):
  noExternal: [/^@vatwiki\//],
  // Keep real npm runtime deps external (declared in dependencies):
  // node-pty ships a native addon (.node binding), so it must stay external
  // and be installed at runtime — it cannot be bundled.
  external: ["react", "ink", "commander", "zod", "node-pty"],
});
