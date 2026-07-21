import { defineConfig } from "vitest/config";

/**
 * Shared Vitest base config reused by every `@club/*` package.
 *
 * Coverage uses the V8 provider (no extra babel/istanbul dependency) and
 * emits text + json + html reporters. Tests, dist and node_modules are
 * excluded from coverage so the dashboard reflects only production code.
 */
export const vitestBase = defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["**/*.test.*", "**/test/**", "dist/**", "node_modules/**"],
      thresholds: {
        global: {
          branches: 70,
          functions: 80,
          lines: 85,
          statements: 85,
        },
      },
    },
  },
});

// Default export is used by per-package vitest.config.ts (e.g. server, sdk).
export default vitestBase;
