import { defineConfig } from "vitest/config"

// The SDK suite was `bun test`; this runs it on Node via vitest. The sources use
// no TS namespaces and no path aliases, so no esbuild pre-transform is needed.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30000,
    pool: "forks",
  },
})
