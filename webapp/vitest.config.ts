import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // TipTap pulls in ProseMirror which depends on contenteditable behaviors
    // jsdom doesn't fully emulate. We scope tests to pure logic for now;
    // in-editor tests belong in a Playwright suite (future).
    css: false,
  },
});
