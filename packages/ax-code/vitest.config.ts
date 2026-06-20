import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const dir = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Tests that don't run in the default (unit) group: integration/flaky/isolation
// tests, mirroring script/test-group.ts (e2e ∪ live ∪ recovery). They spawn real
// subprocesses, need process isolation, or depend on native TUI FFI not present
// under Node — run them in dedicated groups, not the default suite.
const EXCLUDE_GROUPS = [
  "test/session/structured-output-integration.test.ts",
  "test/cli/smoke.test.ts",
  "test/control-plane/session-proxy-middleware.test.ts",
  "test/control-plane/workspace-sync.test.ts",
  "test/control-plane/workspace-server-sse.test.ts",
  "test/tool/bash.test.ts",
  "test/lsp/client.test.ts",
  "test/code-intelligence/query-native-dispatch.test.ts",
  "test/mcp/headers.test.ts",
  "test/mcp/oauth-callback.test.ts",
  "test/mcp/oauth-browser.test.ts",
  "test/script/update-models.test.ts",
  "test/server/global-session-list.test.ts",
  "test/server/project-init-git.test.ts",
  "test/server/session-list.test.ts",
  "test/server/session-messages.test.ts",
  "test/server/session-select.test.ts",
  "test/account/repo.test.ts",
  "test/auth/auth.test.ts",
  "test/control-plane/workspace-recovery.test.ts",
  "test/isolation/isolation.test.ts",
  "test/project/project.test.ts",
  "test/provider/models.test.ts",
  "test/session/diff-recovery.test.ts",
  "test/session/message-recovery.test.ts",
  "test/session/prompt-flow.test.ts",
  "test/session/prompt-resume.test.ts",
  "test/session/session-recovery.test.ts",
  // LSP / heavy-I/O integration tests: spawn real language-server subprocesses
  // whose stdio handshake times out under the Node runner (a node-vs-bun
  // subprocess timing difference). Run as a dedicated integration group.
  "test/lsp/call-hierarchy.test.ts",
  "test/lsp/envelope-coverage.test.ts",
  "test/lsp/lsp-cache-integration.test.ts",
  "test/lsp/perf-sampler.test.ts",
  "test/lsp/prewarm.test.ts",
  "test/lsp/request-collapse.test.ts",
  "test/lsp/workspace-symbol.test.ts",
  "test/code-intelligence/builder.test.ts",
  "test/control-plane/sse.test.ts",
]

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // Vite doesn't apply the "node" import condition by default, so pin #db
      // to the node-sqlite backend explicitly (otherwise it falls to db.bun.ts).
      "#db": path.join(dir, "src/storage/db.node.ts"),
      // json-migration.ts imports drizzle's bun-sqlite driver (→ bun:sqlite);
      // use the node-sqlite driver, matching the Node build. (Tests apply
      // migrations via src/storage/migrate-journal, the runtime-agnostic array
      // migrator, not the dialect-specific bun-sqlite/migrator.)
      "drizzle-orm/bun-sqlite": require.resolve("drizzle-orm/node-sqlite"),
      // Tests that import bun:sqlite's Database directly → node:sqlite shim.
      "bun:sqlite": path.join(dir, "test/support/bun-sqlite.ts"),
      bun: path.join(dir, "test/support/bun-shell.ts"),
      "bun-pty": path.join(dir, "src/pty/bun-pty-node-stub.ts"),
    },
  },
  test: {
    globals: false,
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "test-vitest/**", ...EXCLUDE_GROUPS],
    // Order matters: vitest.setup installs the Bun compat shim first; preload
    // then sets per-process (pid) XDG/home isolation so parallel forks don't
    // collide on the shared global SQLite db, and clears provider env vars.
    setupFiles: [path.join(dir, "test/support/vitest.setup.ts"), path.join(dir, "test/preload.ts")],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
  },
})
