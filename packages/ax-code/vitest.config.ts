import { defineConfig } from "vitest/config"
import type { Plugin } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"
import { transform as esbuildTransform } from "esbuild"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const dir = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// vitest 4 bundles vite 8, whose default Oxc transformer only partially supports
// TS namespaces — namespace-internal references (`const Y = Status` inside a
// namespace) aren't rewritten, so heavily-namespaced modules fail to load with
// `ReferenceError: <member> is not defined`. esbuild has full namespace support,
// so transform our SRC TS with it (enforce:"pre") before Oxc sees it. Scoped to
// src/ only: test files must keep vitest's own transform so vi.mock() hoisting
// (which esbuild would bypass) keeps working.
const srcDir = path.join(dir, "src") + path.sep
// Tools import their descriptions as `import D from "./x.txt"`. Bun returns the
// file contents; vite treats .txt as an asset (returns its path). Load .txt as
// raw text so descriptions are correct (matches Bun + the build's text loader).
const txtAsText: Plugin = {
  name: "txt-as-text",
  enforce: "pre",
  async load(id) {
    const file = id.split("?")[0]
    if (!file.endsWith(".txt")) return null
    const { readFile } = await import("node:fs/promises")
    const content = await readFile(file, "utf8")
    return { code: `export default ${JSON.stringify(content)}`, map: null }
  },
}

const forceEsbuildTs: Plugin = {
  name: "force-esbuild-ts",
  enforce: "pre",
  async transform(code, id) {
    const file = id.split("?")[0]
    if (!file.startsWith(srcDir) || !/\.tsx?$/.test(file)) return null
    const result = await esbuildTransform(code, {
      loader: file.endsWith(".tsx") ? "tsx" : "ts",
      format: "esm",
      target: "node22",
      sourcemap: true,
      sourcefile: file,
    })
    return { code: result.code, map: result.map }
  },
}

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
  // OpenTUI live-render test: needs node:ffi + a real terminal (createCliRenderer),
  // which a headless vitest fork can't provide. Exclude like the e2e group.
  "test/cli/tui/prompt-submit-key.test.ts",
]

export default defineConfig({
  plugins: [txtAsText, forceEsbuildTs, tsconfigPaths()],
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
    // Inline these deps so vitest transforms them and their ESM exports become
    // spyable (vi.spyOn). Bun allowed spying on frozen ESM namespaces; Node does
    // not, so tests that spy on a library's exports need the module inlined.
    server: { deps: { inline: ["@clack/prompts"] } },
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
  },
})
