import { defineConfig } from "vitest/config"

// The extension unit suite was `bun test`; this runs it on Node via vitest. The
// `vscode` host module is stubbed per-test with vi.doMock (not hoisted), so the
// src under test resolves the stub on its dynamic import.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/out/**"],
    testTimeout: 30000,
    pool: "forks",
  },
})
