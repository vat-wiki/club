/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "packages/web/src/test/**",
      "docs/**",
    ],
    languageOptions: {
      parser: "@typescript-eslint/parser",
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
      "react-hooks": require("eslint-plugin-react-hooks"),
    },
    rules: {
      // --- Core ---
      "no-console": "off", // CLI & server legitimately use console
      "no-unused-vars": "off", // replaced by @typescript-eslint/no-unused-vars
      "no-var": "error",
      "prefer-const": "error",
      "no-unused-expressions": "error",
      "no-constant-condition": ["error", { checkExhaustiveness: false }],

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
      "@typescript-eslint/no-empty-function": "error",
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
];
