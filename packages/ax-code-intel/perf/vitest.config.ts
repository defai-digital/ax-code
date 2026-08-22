import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// The perf harness has its own config so `pnpm --dir packages/ax-code-intel
// exec vitest run --config perf/vitest.config.ts` targets exactly these
// tests. The package's own vitest.config.ts only includes test/** at the
// package root, so the perf suite stays out of `pnpm run test` and CI.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    pool: "forks",
  },
})
