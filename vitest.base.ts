import { defineConfig } from "vitest/config";

// Vitest (unlike Jest) does not auto-set NODE_ENV=test. Several server
// middleware gate defensive rate limits behind `NODE_ENV === "test"` so that
// test suites firing dozens of authenticated requests per second don't trip
// the production ceilings (per-IP 120/min, per-write 15/min, per-key 30/min).
// Set it here, before any package code is imported, so those gates take effect.
process.env.NODE_ENV ??= "test";

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
