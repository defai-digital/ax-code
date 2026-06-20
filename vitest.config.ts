import { defineConfig } from "vitest/config"

// Runs the repo-root `script/*.test.ts` suites (setup-cli, release signing,
// publish) on Node. Package suites have their own vitest configs; this one is
// scoped to the root scripts only.
export default defineConfig({
  test: {
    include: ["script/*.test.ts"],
    exclude: ["**/node_modules/**", "packages/**", "ax-internal/**", "dist/**", "crates/**"],
    testTimeout: 30000,
    pool: "forks",
  },
})
