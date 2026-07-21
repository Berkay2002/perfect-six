import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Full-team generation and alternatives share CPU when test files run in
    // parallel. Correctness tests get scheduling headroom; the release
    // benchmark keeps its own explicit 1.5-second assertion.
    testTimeout: 15_000,
  },
});
