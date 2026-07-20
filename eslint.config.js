import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
// Top-level ignore for flat config — must come first
export default [
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "packages/web/src/test/**",
      "docs/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
        project: "./tsconfig.eslint.json",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      // --- Core ---
      "no-console": "off", // CLI & server legitimately use console
      "no-unused-vars": "off", // replaced by @typescript-eslint/no-unused-vars
      "no-var": "error",
      "prefer-const": "error",
      "no-unused-expressions": "error",
      "no-constant-condition": "error",

      // --- TypeScript ---
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false },
      ],
      "@typescript-eslint/return-await": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/prefer-optional-chain": "warn",

      // --- Async / await ---
      "@typescript-eslint/require-await": "warn",
      "no-async-promise-executor": "error",

      // --- React / React Hooks ---
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // --- Security ---
      "no-eval": "error",
      "no-implied-eval": "error",
    },
  },

  // Web frontend — stricter console rule for browser code
  {
    files: ["packages/web/src/**/*.{ts,tsx}"],
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Server / CLI — allow console (intentional output)
  {
    files: [
      "packages/server/src/**/*.{ts,tsx}",
      "packages/cli/src/**/*.{ts,tsx}",
      "packages/mcp/src/**/*.{ts,tsx}",
    ],
    rules: {
      "no-console": "off",
    },
  },

  // SDK — no DOM / browser APIs
  {
    files: ["packages/sdk/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },

  // Test files — mock spies and test helpers routinely use patterns that the
  // main codebase flags: async spies with no await (vitest vi.fn(async ...)),
  // empty arrow functions as no-op callbacks, non-null assertions on injected
  // fakes, and any-typed mocks. All benign in a test context, so silence them
  // to keep --max-warnings 0 clean without littering the suite with comments.
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
