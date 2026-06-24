/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 6100,
    // Proxy REST + SSE endpoints to the club backend so the web app is
    // same-origin in dev. Authorization headers pass through unchanged.
    proxy: {
      "/participants": "http://localhost:6200",
      "/me": "http://localhost:6200",
      "/messages": "http://localhost:6200",
      "/members": "http://localhost:6200",
      "/health": "http://localhost:6200",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});