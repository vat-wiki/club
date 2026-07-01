import { defineConfig } from "tsup";

// Bundle the CLI into a single self-contained ESM file for npm publishing.
// The @club/* workspace packages (shared, sdk) are inlined so the published
// package has zero @club/* runtime deps; only real npm packages stay external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  // Inline workspace packages (not on npm):
  noExternal: [/^@club\//],
  // Keep real npm runtime deps external (declared in dependencies):
  external: ["react", "ink", "commander", "zod"],
});
