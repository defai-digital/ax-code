#!/usr/bin/env node
/**
 * Wave 0 freeze + scaffold MODULE-AUDIT reports for every audit unit.
 * Uses source inventory to populate map section; remaining protocol steps filled by reviewers.
 */
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
const PLAN = path.join(ROOT, ".internal/reports/planning/module-quality-audit")
const MODULES = path.join(PLAN, "modules")
const baseline = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()
const date = new Date().toISOString().slice(0, 10)

/** @typedef {{ id: string, slug: string, scope: string, wave: number, size: string, risk: string[], owner: string }} Unit */

/** @type {Unit[]} */
const units = []

function add(id, slug, scope, wave, size, risk = [], owner = "codex-sol+ax-code-glm") {
  units.push({ id, slug, scope, wave, size, risk, owner })
}

// Wave 1
const w1 = [
  ["W1-01","auth","packages/ax-code/src/auth","L",["security","credentials"]],
  ["W1-02","account","packages/ax-code/src/account","M",["security","persistence"]],
  ["W1-03","config","packages/ax-code/src/config","L",["security","config"]],
  ["W1-04","hooks","packages/ax-code/src/hooks","M",["security","trust"]],
  ["W1-05","env","packages/ax-code/src/env","S",["security","secrets"]],
  ["W1-06","plugin","packages/ax-code/src/plugin","L",["security","extensibility"]],
  ["W1-07","audit","packages/ax-code/src/audit","M",["security","persistence"]],
  ["W1-08","risk","packages/ax-code/src/risk","M",["security"]],
  ["W1-09","control-plane","packages/ax-code/src/control-plane","L",["security","concurrency"]],
  ["W1-10","installation","packages/ax-code/src/installation","M",["security","release"]],
  ["W1-11","desktop-bridge","packages/ax-code/src/desktop","S",["desktop"]],
  ["W1-12","desktop-electron-security","desktop/packages/electron/src (security policies)","L",["security","desktop"]],
  ["W1-13","desktop-electron-ipc","desktop/packages/electron/src (IPC policy/handlers)","L",["security","desktop"]],
  ["W1-14","desktop-electron-preload","desktop/packages/electron/src/preload.js","M",["security","desktop"]],
  ["W1-15","desktop-web-security","desktop/packages/web/server/lib/security","M",["security","desktop"]],
  ["W1-16","desktop-web-ui-auth","desktop/packages/web/server/lib/ui-auth","M",["security","desktop"]],
]
for (const [id, slug, scope, size, risk] of w1) add(id, slug, scope, 1, size, risk)

// Wave 2 — XL session split
const w2 = [
  ["W2-01a","session-prompt-processor","packages/ax-code/src/session (prompt/processor)","L",["hot-path","correctness"]],
  ["W2-01b","session-messages-parts","packages/ax-code/src/session (messages/parts)","L",["hot-path","persistence"]],
  ["W2-01c","session-compaction","packages/ax-code/src/session (compaction)","M",["hot-path","correctness"]],
  ["W2-01d","session-lifecycle-queue","packages/ax-code/src/session (lifecycle/queue)","L",["concurrency","hot-path"]],
  ["W2-01e","session-fork-revert","packages/ax-code/src/session (fork/revert/rollback)","M",["correctness","persistence"]],
  ["W2-02","runtime","packages/ax-code/src/runtime","L",["hot-path"]],
  ["W2-03","runtime-headless","packages/ax-code/src/runtime/headless","M",["hot-path"]],
  ["W2-04","agent","packages/ax-code/src/agent","L",["hot-path","security"]],
  ["W2-05","planner","packages/ax-code/src/planner","M",["correctness"]],
  ["W2-06","dispatch","packages/ax-code/src/dispatch","M",["concurrency"]],
  ["W2-07","workflow","packages/ax-code/src/workflow","L",["concurrency","persistence"]],
  ["W2-08","context","packages/ax-code/src/context","M",["performance"]],
  ["W2-09","prompt-history","packages/ax-code/src/prompt-history","S",["persistence"]],
  ["W2-10","memory","packages/ax-code/src/memory","M",["correctness"]],
  ["W2-11","replay","packages/ax-code/src/replay","M",["persistence","correctness"]],
  ["W2-12","snapshot","packages/ax-code/src/snapshot","M",["persistence"]],
  ["W2-13","bus","packages/ax-code/src/bus","M",["concurrency"]],
]
for (const [id, slug, scope, size, risk] of w2) add(id, slug, scope, 2, size, risk)

// Wave 3 — XL tool split
const w3 = [
  ["W3-01","permission","packages/ax-code/src/permission","L",["security","trust"]],
  ["W3-02","isolation","packages/ax-code/src/isolation","L",["security","sandbox"]],
  ["W3-03a","tool-mutation","packages/ax-code/src/tool (edit/write/apply_patch/mutation)","L",["security","correctness"]],
  ["W3-03b","tool-execution","packages/ax-code/src/tool (bash/shell execution)","L",["security","hot-path"]],
  ["W3-03c","tool-network","packages/ax-code/src/tool (webfetch/browser/network)","M",["security","network"]],
  ["W3-03d","tool-orchestration","packages/ax-code/src/tool (task/arena/council/orchestration)","L",["concurrency"]],
  ["W3-03e","tool-readonly","packages/ax-code/src/tool (read/grep/glob/ls)","M",["correctness"]],
  ["W3-04","shell","packages/ax-code/src/shell","L",["security"]],
  ["W3-05","pty","packages/ax-code/src/pty","L",["security","resource"]],
  ["W3-06","file","packages/ax-code/src/file","L",["security","performance"]],
  ["W3-07","patch","packages/ax-code/src/patch","M",["correctness"]],
  ["W3-08","worktree","packages/ax-code/src/worktree","M",["correctness"]],
  ["W3-09","command","packages/ax-code/src/command","M",["security"]],
  ["W3-10","question","packages/ax-code/src/question","M",["correctness"]],
  ["W3-11","bun","packages/ax-code/src/bun","S",["quality"]],
  ["W3-12","native","packages/ax-code/src/native","M",["native","stability"]],
  ["W3-13","image","packages/ax-code/src/image","M",["security"]],
  ["W3-14","import","packages/ax-code/src/import","M",["correctness"]],
]
for (const [id, slug, scope, size, risk] of w3) add(id, slug, scope, 3, size, risk)

// Wave 4 — XL server routes split by families present
const routeDir = path.join(ROOT, "packages/ax-code/src/server/routes")
let routeFamilies = []
if (fs.existsSync(routeDir)) {
  routeFamilies = fs.readdirSync(routeDir).filter(f => f.endsWith(".ts")).map(f => f.replace(/\.ts$/, ""))
}
const w4 = [
  ["W4-01","storage","packages/ax-code/src/storage","L",["persistence","stability"]],
  ["W4-02","server","packages/ax-code/src/server","L",["security","network"]],
]
for (const [id, slug, scope, size, risk] of w4) add(id, slug, scope, 4, size, risk)
routeFamilies.forEach((name, i) => {
  add(`W4-03-${String(i+1).padStart(2,"0")}`, `server-routes-${name}`, `packages/ax-code/src/server/routes/${name}.ts`, 4, "S", ["network","api"])
})
const w4rest = [
  ["W4-04","project","packages/ax-code/src/project","M",["persistence"]],
  ["W4-05","id","packages/ax-code/src/id","S",["correctness"]],
  ["W4-06","global","packages/ax-code/src/global","S",["config"]],
  ["W4-07","share","packages/ax-code/src/share","M",["security"]],
  ["W4-08","stats","packages/ax-code/src/stats","M",["quality"]],
  ["W4-09","telemetry","packages/ax-code/src/telemetry","M",["quality"]],
  ["W4-10","notification","packages/ax-code/src/notification","M",["quality"]],
  ["W4-11","sdk","packages/ax-code/src/sdk","M",["api"]],
]
for (const [id, slug, scope, size, risk] of w4rest) add(id, slug, scope, 4, size, risk)

// Wave 5
const w5 = [
  ["W5-01a","provider-registry","packages/ax-code/src/provider (registry/routing)","L",["hot-path","correctness"]],
  ["W5-01b","provider-stream","packages/ax-code/src/provider (stream transforms)","L",["hot-path","stability"]],
  ["W5-01c","provider-auth-caps","packages/ax-code/src/provider (auth/capabilities)","M",["security"]],
  ["W5-01d","provider-retry-errors","packages/ax-code/src/provider (retry/error translation)","M",["stability"]],
  ["W5-01e","provider-models-data","packages/ax-code/src/provider (models-snapshot/model data)","M",["correctness"]],
  ["W5-02","provider-ax-engine","packages/ax-code/src/provider/ax-engine","L",["hot-path"]],
  ["W5-03","provider-cli","packages/ax-code/src/provider/cli","L",["stability","process"]],
  ["W5-04","provider-xai","packages/ax-code/src/provider/xai","M",["security"]],
  ["W5-05a","mcp-lifecycle","packages/ax-code/src/mcp (lifecycle/transport)","L",["security","process"]],
  ["W5-05b","mcp-oauth-trust","packages/ax-code/src/mcp (OAuth/trust)","L",["security"]],
  ["W5-05c","mcp-tools","packages/ax-code/src/mcp (tool conversion)","M",["security"]],
  ["W5-05d","mcp-discovery","packages/ax-code/src/mcp (discovery/config/disposal)","M",["security"]],
  ["W5-06","lsp","packages/ax-code/src/lsp","L",["performance","process"]],
  ["W5-07","code-intelligence","packages/ax-code/src/code-intelligence","L",["performance","persistence"]],
  ["W5-08","graph","packages/ax-code/src/graph","L",["performance"]],
  ["W5-09","capability","packages/ax-code/src/capability","M",["quality"]],
  ["W5-10","acp","packages/ax-code/src/acp","M",["api"]],
  ["W5-11","ide","packages/ax-code/src/ide","M",["api"]],
  ["W5-12","skill","packages/ax-code/src/skill","L",["security"]],
  ["W5-13","mode","packages/ax-code/src/mode","M",["correctness"]],
  ["W5-14","quality","packages/ax-code/src/quality","M",["quality"]],
  ["W5-15","design-check","packages/ax-code/src/design-check","M",["quality"]],
  ["W5-16","debug-engine","packages/ax-code/src/debug-engine","M",["correctness"]],
  ["W5-17","debug","packages/ax-code/src/debug","S",["quality"]],
  ["W5-18","perf","packages/ax-code/src/perf","M",["performance"]],
  ["W5-19","wiki","packages/ax-code/src/wiki","M",["quality"]],
]
for (const [id, slug, scope, size, risk] of w5) add(id, slug, scope, 5, size, risk)

// Wave 6 CLI
const cliCmds = [
  ["W6-00","cli-parent","packages/ax-code/src/cli","L"],
  ["W6-01","cli-cmd-registry","packages/ax-code/src/cli/cmd registry/shims","M"],
  ["W6-02","cli-cmd-session","cli/cmd/session","M"],
  ["W6-03","cli-cmd-run","cli/cmd/run","M"],
  ["W6-04","cli-cmd-headless-run","cli/cmd/headless-run","S"],
  ["W6-05","cli-cmd-serve","cli/cmd/serve","M"],
  ["W6-06","cli-cmd-workspace-serve","cli/cmd/workspace-serve","M"],
  ["W6-07","cli-cmd-runtime","cli/cmd/runtime","M"],
  ["W6-08a","cli-cmd-tui-boot","cli/cmd/tui boot/worker","L"],
  ["W6-08b","cli-cmd-tui-session-route","cli/cmd/tui routes/session","L"],
  ["W6-08c","cli-cmd-tui-tool-renderers","cli/cmd/tui tool-renderers","M"],
  ["W6-09","cli-cmd-mcp","cli/cmd/mcp","M"],
  ["W6-10","cli-cmd-providers","cli/cmd/providers","M"],
  ["W6-11","cli-cmd-models","cli/cmd/models","S"],
  ["W6-12","cli-cmd-skill","cli/cmd/skill","S"],
  ["W6-13","cli-cmd-workflow","cli/cmd/workflow","L"],
  ["W6-14","cli-cmd-doctor","cli/cmd/doctor","M"],
  ["W6-15","cli-cmd-github-agent","cli/cmd/github-agent","L"],
  ["W6-16","cli-cmd-storage","cli/cmd/storage","M"],
  ["W6-17","cli-cmd-debug","cli/cmd/debug","L"],
  ["W6-18","cli-cmd-release","cli/cmd/release","M"],
  ["W6-19","cli-cmd-webui","cli/cmd/webui","S"],
  ["W6-20","cli-cmd-wiki","cli/cmd/wiki","M"],
  ["W6-21","cli-cmd-pr","cli/cmd/pr","M"],
  ["W6-22","cli-cmd-export","cli/cmd/export","M"],
  ["W6-23","cli-cmd-import","cli/cmd/import","M"],
  ["W6-24","cli-cmd-upgrade","cli/cmd/upgrade","M"],
  ["W6-25","cli-cmd-account","cli/cmd/account","S"],
  ["W6-26","cli-cmd-acp","cli/cmd/acp","S"],
  ["W6-27","cli-cmd-agent","cli/cmd/agent","S"],
  ["W6-28","cli-cmd-audit","cli/cmd/audit","S"],
  ["W6-29","cli-cmd-branch","cli/cmd/branch","S"],
  ["W6-30","cli-cmd-capability","cli/cmd/capability","S"],
  ["W6-31","cli-cmd-compare","cli/cmd/compare","S"],
  ["W6-32","cli-cmd-context","cli/cmd/context","S"],
  ["W6-33","cli-cmd-db","cli/cmd/db","S"],
  ["W6-34","cli-cmd-design-check","cli/cmd/design-check","S"],
  ["W6-35","cli-cmd-dre-graph","cli/cmd/dre-graph","M"],
  ["W6-36","cli-cmd-generate","cli/cmd/generate","S"],
  ["W6-37","cli-cmd-github","cli/cmd/github","S"],
  ["W6-38","cli-cmd-graph","cli/cmd/graph","M"],
  ["W6-39","cli-cmd-index-graph","cli/cmd/index-graph","S"],
  ["W6-40","cli-cmd-init","cli/cmd/init","S"],
  ["W6-41","cli-cmd-memory","cli/cmd/memory","S"],
  ["W6-42","cli-cmd-replay","cli/cmd/replay","S"],
  ["W6-43","cli-cmd-restart","cli/cmd/restart","S"],
  ["W6-44","cli-cmd-risk","cli/cmd/risk","S"],
  ["W6-45","cli-cmd-rollback","cli/cmd/rollback","S"],
  ["W6-46","cli-cmd-stats","cli/cmd/stats","S"],
  ["W6-47","cli-cmd-trace","cli/cmd/trace","S"],
  ["W6-48","cli-cmd-uninstall","cli/cmd/uninstall","S"],
]
for (const [id, slug, scope, size] of cliCmds) add(id, slug, scope.startsWith("packages/") ? scope : `packages/ax-code/src/${scope}`, 6, size, ["cli"])

// Wave 7
const w7 = [
  ["W7-01","desktop-electron-shell","desktop/packages/electron/src (shell/window)","L",["desktop"]],
  ["W7-02","desktop-electron-server-process","desktop/packages/electron/src/server-process.js","L",["desktop","stability"]],
  ["W7-03","desktop-electron-tray","desktop/packages/electron/src/tray.mjs","S",["desktop"]],
  ["W7-04","desktop-electron-updates","desktop/packages/electron/src (update)","M",["desktop","security"]],
  ["W7-05","desktop-web-server","desktop/packages/web/server","L",["desktop","network"]],
  ["W7-06","desktop-web-ax-code","desktop/packages/web/server/lib/ax-code","L",["desktop"]],
  ["W7-07","desktop-web-desktop","desktop/packages/web/server/lib/desktop","M",["desktop"]],
  ["W7-08","desktop-web-event-stream","desktop/packages/web/server/lib/event-stream","L",["desktop","performance"]],
  ["W7-09","desktop-web-fs","desktop/packages/web/server/lib/fs","M",["desktop","security"]],
  ["W7-10","desktop-web-git","desktop/packages/web/server/lib/git","L",["desktop"]],
  ["W7-11","desktop-web-github","desktop/packages/web/server/lib/github","L",["desktop","security"]],
  ["W7-12","desktop-web-magic-prompts","desktop/packages/web/server/lib/magic-prompts","S",["desktop"]],
  ["W7-13","desktop-web-notifications","desktop/packages/web/server/lib/notifications","M",["desktop"]],
  ["W7-14","desktop-web-preview","desktop/packages/web/server/lib/preview","M",["desktop","security"]],
  ["W7-15","desktop-web-projects","desktop/packages/web/server/lib/projects","L",["desktop"]],
  ["W7-16","desktop-web-quota","desktop/packages/web/server/lib/quota","L",["desktop"]],
  ["W7-17","desktop-web-scheduled-tasks","desktop/packages/web/server/lib/scheduled-tasks","L",["desktop"]],
  ["W7-18","desktop-web-session-folders","desktop/packages/web/server/lib/session-folders","M",["desktop"]],
  ["W7-19","desktop-web-skills-catalog","desktop/packages/web/server/lib/skills-catalog","M",["desktop"]],
  ["W7-20","desktop-web-terminal","desktop/packages/web/server/lib/terminal","L",["desktop","security"]],
  ["W7-21","desktop-web-text","desktop/packages/web/server/lib/text","S",["desktop"]],
  ["W7-22","desktop-web-src","desktop/packages/web/src","M",["desktop"]],
]
for (const [id, slug, scope, size, risk] of w7) add(id, slug, scope, 7, size, risk)

// Wave 8 UI — split components
const uiComponents = path.join(ROOT, "desktop/packages/ui/src/components")
let componentKids = []
if (fs.existsSync(uiComponents)) {
  componentKids = fs.readdirSync(uiComponents, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
}
const w8base = [
  ["W8-01","ui-api","desktop/packages/ui/src/api","L",["desktop","api"]],
  ["W8-02","ui-apps","desktop/packages/ui/src/apps","M",["desktop"]],
]
for (const [id, slug, scope, size, risk] of w8base) add(id, slug, scope, 8, size, risk)
if (componentKids.length === 0) {
  add("W8-03","ui-components","desktop/packages/ui/src/components","L",["desktop","ui"])
} else {
  componentKids.forEach((name, i) => {
    add(`W8-03-${String(i+1).padStart(2,"0")}`, `ui-components-${name}`, `desktop/packages/ui/src/components/${name}`, 8, "S", ["desktop","ui"])
  })
}
const w8rest = [
  ["W8-04","ui-contexts","desktop/packages/ui/src/contexts","M",["desktop"]],
  ["W8-05","ui-hooks","desktop/packages/ui/src/hooks","L",["desktop"]],
  ["W8-06","ui-lib","desktop/packages/ui/src/lib","L",["desktop"]],
  ["W8-07","ui-stores","desktop/packages/ui/src/stores","L",["desktop"]],
  ["W8-08","ui-sync","desktop/packages/ui/src/sync","L",["desktop"]],
  ["W8-09","ui-types","desktop/packages/ui/src/types","S",["desktop"]],
]
for (const [id, slug, scope, size, risk] of w8rest) add(id, slug, scope, 8, size, risk)

// Wave 9
const w9 = [
  ["W9-01","pkg-sdk-js","packages/sdk/js","L",["api"]],
  ["W9-02","pkg-plugin","packages/plugin","M",["api"]],
  ["W9-03","pkg-util","packages/util","M",["quality"]],
  ["W9-04","pkg-script","packages/script","L",["quality"]],
  ["W9-05","pkg-opentui-core","packages/opentui-core","L",["ui"]],
  ["W9-06","pkg-opentui-solid","packages/opentui-solid","L",["ui"]],
  ["W9-07","pkg-opentui-spinner","packages/opentui-spinner","S",["ui"]],
  ["W9-08","pkg-ax-wiki","packages/ax-wiki","L",["quality"]],
  ["W9-09","pkg-ax-code-index-core","packages/ax-code-index-core","M",["native"]],
  ["W9-10","pkg-ax-code-fs-native","packages/ax-code-fs-native","M",["native"]],
  ["W9-11","pkg-ax-code-diff-native","packages/ax-code-diff-native","M",["native"]],
  ["W9-12","pkg-ax-code-parser-native","packages/ax-code-parser-native","M",["native"]],
  ["W9-13","pkg-ax-code-terminal-native","packages/ax-code-terminal-native","M",["native"]],
  ["W9-14","pkg-ax-code-daemon","packages/ax-code-daemon","M",["native"]],
  ["W9-15","crate-index","crates/ax-code-index","L",["native","performance"]],
  ["W9-16","crate-fs","crates/ax-code-fs","L",["native","performance"]],
  ["W9-17","crate-diff","crates/ax-code-diff","L",["native"]],
  ["W9-18","crate-parser","crates/ax-code-parser","L",["native"]],
  ["W9-19","crate-terminal","crates/ax-code-terminal","L",["native","stability"]],
  ["W9-20","crate-daemon","crates/ax-code-daemon","L",["native"]],
  ["W9-21","crate-bench","crates/ax-code-bench","S",["quality"]],
  ["W9-22","desktop-docs","desktop/packages/docs","S",["docs"]],
]
for (const [id, slug, scope, size, risk] of w9) add(id, slug, scope, 9, size, risk)

// Wave 10
const w10 = [
  ["W10-01","constants","packages/ax-code/src/constants","S",["quality"]],
  ["W10-02","flag","packages/ax-code/src/flag","S",["quality"]],
  ["W10-03","format","packages/ax-code/src/format","S",["quality"]],
  ["W10-04","util","packages/ax-code/src/util","L",["quality"]],
  ["W10-05","visual","packages/ax-code/src/visual","M",["quality"]],
]
for (const [id, slug, scope, size, risk] of w10) add(id, slug, scope, 10, size, risk)

// Write frozen inventory JSON
fs.mkdirSync(MODULES, { recursive: true })
const inventoryPath = path.join(PLAN, "inventory-frozen.json")
fs.writeFileSync(inventoryPath, JSON.stringify({ baseline, date, denominator: units.length, units }, null, 2))
console.log(`Frozen denominator=${units.length} baseline=${baseline}`)

function resolveSourcePath(scope) {
  // strip parenthetical notes
  const clean = scope.replace(/\s*\(.*\)$/, "").trim()
  const full = path.join(ROOT, clean)
  return full
}

function listFiles(scope) {
  const full = resolveSourcePath(scope)
  const files = []
  if (!fs.existsSync(full)) return files
  const st = fs.statSync(full)
  if (st.isFile()) return [path.relative(ROOT, full)]
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === "target") continue
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (/\.(ts|tsx|js|mjs|rs|json|txt|md)$/.test(ent.name)) files.push(path.relative(ROOT, p))
    }
  }
  walk(full)
  return files.slice(0, 200)
}

function findTests(slug, scope) {
  const candidates = []
  const base = path.join(ROOT, "packages/ax-code/test")
  const simple = slug.replace(/^cli-cmd-/, "").replace(/^pkg-/, "").replace(/^crate-/, "").replace(/^desktop-/, "").replace(/^ui-/, "").replace(/^server-routes-/, "server/")
  if (fs.existsSync(base)) {
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) walk(p)
        else if (ent.name.includes(simple.split("-")[0]) && ent.name.endsWith(".ts")) {
          candidates.push(path.relative(ROOT, p))
        }
      }
    }
    walk(base)
  }
  return candidates.slice(0, 20)
}

function scanIssues(files) {
  const issues = { emptyCatch: 0, todo: 0, any: 0 }
  for (const rel of files) {
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) continue
    let text
    try { text = fs.readFileSync(p, "utf8") } catch { continue }
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(text)) issues.emptyCatch++
    if (/TODO|FIXME|HACK/.test(text)) issues.todo++
    if (/\bas any\b/.test(text)) issues.any++
  }
  return issues
}

// Scaffold MODULE-AUDIT for each unit (mapping complete; full protocol filled later by deep review)
for (const u of units) {
  const dir = path.join(MODULES, u.slug)
  fs.mkdirSync(path.join(dir, "findings"), { recursive: true })
  const files = listFiles(u.scope)
  const tests = findTests(u.slug, u.scope)
  const issues = scanIssues(files)
  const report = `# MODULE-AUDIT: ${u.slug}

| Field | Value |
|-------|-------|
| Unit slug | \`${u.slug}\` |
| Scope | \`${u.scope}\` |
| Wave / effort | Wave ${u.wave} / ${u.size} |
| Risk tags | ${u.risk.join(", ") || "none"} |
| Status | MAPPING |
| Reviewer | ${u.owner} |
| Fix owner | ${u.owner} |
| Independent verifier | dual-agent alternate |
| Baseline commit | \`${baseline}\` |
| Started / last updated | ${date} / ${date} |
| Parent / child reports | none |
| Inventory ID | ${u.id} |

> Auto-scaffolded in Wave 0 from inventory freeze. Deep protocol steps completed during wave execution.

## 1. Scope and map

### Purpose and ownership

Audit unit for \`${u.scope}\` as defined by PRD module-by-module quality audit inventory.

### Source, tests, and artifacts

| Kind | Paths / links | Notes |
|------|---------------|-------|
| Source | ${files.slice(0, 15).map(f => `\`${f}\``).join(", ") || "(path not present at freeze)"} | ${files.length} files discovered |
| Tests | ${tests.slice(0, 10).map(f => `\`${f}\``).join(", ") || "(none auto-matched)"} | ${tests.length} matched |
| Config/schema | see source tree | Zod/schemas where present |
| Persistence/migrations | see unit if storage-related | — |
| Generated/build artifacts | excluded from hand audit | generators/contracts in scope |
| Documentation/prior art | \`.internal/reports/reviews/2026-07-19-code-quality-stability-review.md\` | prior art |

### Public API and registrations

Mapped from exports/registration during wave review. File count: ${files.length}.

### Callers, callees, and data flow

Deferred detail tables filled during REVIEWING. Wave 0 establishes source map only.

### Resources and lifecycle

Scanned for process/timer/listener patterns during deep review.

### Boundaries

- Ownership/import boundaries: per ARCHITECTURE.md / PROJECT_BOUNDARIES.md
- Trust boundaries: per risk tags (${u.risk.join(", ") || "general"})
- Config/env/CLI surface: mapped in deep review
- Filesystem/network/process scope: mapped in deep review

## 2. Threat and failure model

| Asset/invariant | Boundary or trigger | Failure/abuse path | User/system impact | Existing defense | Evidence/test gap |
|-----------------|---------------------|--------------------|--------------------|------------------|-------------------|
| Module integrity | untrusted input / lifecycle | silent failure, crash, privilege | depends on unit | TBD deep review | TBD |

Required cases considered:

- [ ] malformed, empty, extreme-size, and adversarial inputs
- [ ] untrusted repository/plugin/skill/hook/model/renderer/network input as applicable
- [ ] cancellation, timeout, retry exhaustion, and partial completion
- [ ] concurrent invocation, duplicate delivery, stale callback, and teardown races
- [ ] process/network/native failure and restart/recovery
- [ ] data loss/corruption, secret exposure, privilege expansion, and silent degradation

Wave 0 static signals: emptyCatchFiles=${issues.emptyCatch}, todoHits=${issues.todo}, asAnyFiles=${issues.any}

## 3. Correctness review

### Invariants

1. Public API maintains documented contracts
2. Errors are visible (no silent swallow of security/stability failures)

### Path analysis

Completed during wave REVIEWING with evidence.

## 4. Performance review

Hot paths assessed when risk tags include performance/hot-path.

## 5. Design and boundary review

Checked against ARCHITECTURE.md and desktop PROJECT_BOUNDARIES.md during wave review.

## 6. Dead code and hygiene

Wave 0 static signals recorded above; dead-code disposition during deep review.

## 7. Test coverage map

| Invariant/risk path | Existing test | Test level | Gap | Added/changed test |
|---------------------|---------------|------------|-----|--------------------|
| Unit smoke/path coverage | ${tests[0] ? "`"+tests[0]+"`" : "none auto-matched"} | unit/integration | TBD | TBD |

## 8. Finding register and fix plan

| Finding | Category | Severity | Origin | Status | Fix owner | Target/expiry |
|---------|----------|----------|--------|--------|-----------|---------------|
| _none yet_ | — | — | — | — | — | — |

## 9. Verification and exit

### Commands actually run

| Command | Date/environment | Result | Evidence/notes |
|---------|------------------|--------|----------------|
| inventory freeze | ${date} | ok | inventory-frozen.json |
| core typecheck baseline | ${date} | see STATUS | gates/baseline-typecheck.txt |

### Exit checklist

- [ ] Map is complete
- [ ] Threat/failure model complete
- [ ] Correctness/performance/design/dead-code/tests reviewed
- [ ] Findings disposition complete
- [ ] Accepted findings verified-fixed or deferred
- [ ] Regression tests landed
- [ ] Verification commands passed
- [ ] Critical independent verification
- [ ] Metrics/STATUS updated
- [ ] Delta review complete

### Sign-off

| Role | Name | Date | Evidence/statement |
|------|------|------|--------------------|
| Reviewer | | | pending |
| Fix owner | | | pending |
| Independent verifier | | | pending |
| Module owner | | | pending |
`
  fs.writeFileSync(path.join(dir, "MODULE-AUDIT.md"), report)
}

// Write inventory summary for STATUS
const byWave = {}
for (const u of units) {
  byWave[u.wave] = (byWave[u.wave] || 0) + 1
}
fs.writeFileSync(path.join(PLAN, "inventory-wave-counts.json"), JSON.stringify(byWave, null, 2))
console.log("Wave counts:", byWave)
console.log("Scaffolded", units.length, "module reports")
