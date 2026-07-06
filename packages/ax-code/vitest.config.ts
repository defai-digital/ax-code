import { defineConfig } from "vitest/config"
import type { Plugin } from "vitest/config"
import { transform as esbuildTransform } from "esbuild"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defaultExcludedTests } from "./script/test-group"

const dir = path.dirname(fileURLToPath(import.meta.url))
const normalizeVitePath = (input: string) => input.replaceAll("\\", "/")

// vitest 4 bundles vite 8, whose default Oxc transformer only partially supports
// TS namespaces — namespace-internal references (`const Y = Status` inside a
// namespace) aren't rewritten, so heavily-namespaced modules fail to load with
// `ReferenceError: <member> is not defined`. esbuild has full namespace support,
// so transform our SRC TS with it (enforce:"pre") before Oxc sees it. Scoped to
// src/ only: test files must keep vitest's own transform so vi.mock() hoisting
// (which esbuild would bypass) keeps working.
const srcDir = normalizeVitePath(path.join(dir, "src")) + "/"
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
    const file = normalizeVitePath(id.split("?")[0])
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

// Exact file list from the group runners (test-groups.ts / test-ci.ts), if any.
const includeFiles = process.env.AX_TEST_FILES
  ? process.env.AX_TEST_FILES.split(",")
      .map((file) => file.trim())
      .filter(Boolean)
  : undefined

export default defineConfig({
  plugins: [txtAsText, forceEsbuildTs],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Vite doesn't apply the "node" import condition by default, so pin #db
      // to the node-sqlite backend explicitly.
      "#db": path.join(dir, "src/storage/db.node.ts"),
      bun: path.join(dir, "test/support/bun-shell.ts"),
    },
  },
  test: {
    globals: false,
    // The group runners (test-groups.ts / test-ci.ts) pass an exact file list via
    // AX_TEST_FILES instead of vitest positional filters — vitest 4's positional
    // filter matches path segments opaquely and can't reliably target an exact
    // set. An explicit `include` list is unambiguous. defaultExcludedTests
    // contains the non-default groups (e2e/recovery/live) as well as quarantined
    // files, so when a group explicitly requests files we drop those exact paths
    // from the exclude — otherwise the recovery/e2e/live groups would self-
    // exclude and run nothing.
    include: includeFiles ?? ["test/**/*.test.{ts,tsx}"],
    exclude: includeFiles
      ? ["**/node_modules/**", "test-vitest/**", ...defaultExcludedTests.filter((file) => !includeFiles.includes(file))]
      : ["**/node_modules/**", "test-vitest/**", ...defaultExcludedTests],
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
    // Cap concurrent forks well below the core count (18 here). Many tests spawn
    // git subprocesses and file watchers whose event delivery has its own short
    // internal deadlines (e.g. the 5s `.git/HEAD` watcher wait); at full
    // core-count parallelism those subprocesses starve for CPU and miss the
    // deadline, producing flaky timeouts. Bun's test runner used a single
    // process; this restores comparable contention behaviour on Node.
    maxWorkers: 6,
    // A cluster of git/watcher/scheduler tests is timing-sensitive: each passes
    // deterministically in isolation but can miss a subprocess/event deadline
    // under full-suite load. Bun's runner happened to schedule them serially.
    // Retry rather than mask: a genuine logic failure fails all attempts, while
    // a load-induced timeout clears on a re-run with a warmer, quieter process.
    retry: 2,
  },
})
