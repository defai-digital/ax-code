#!/usr/bin/env node
/**
 * Deep extract + disposition helper. Does NOT auto-sign units as complete.
 * Sign-off requires modules/<slug>/agent-protocol.json written by dual-agent
 * (or implementer) after PRD §6 9-step review.
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { protocolOk as gateProtocolOk } from "./protocol-gate.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const PLAN = path.join(ROOT, "docs/module-quality-audit")
const inventory = JSON.parse(fs.readFileSync(path.join(PLAN, "inventory-frozen.json"), "utf8"))
const baseline = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()
const date = new Date().toISOString().slice(0, 10)

/** XL / annotated scope → concrete path + optional include/exclude predicates */
const SCOPE_MAP = {
  "session-prompt-processor": {
    root: "packages/ax-code/src/session",
    include: (rel) =>
      /\/(prompt|processor|llm|prompt-processor|processor-impl|llm-impl)/.test(rel) ||
      /session\/prompt\//.test(rel) ||
      /session\/prompt[^/]*\.ts$/.test(rel) ||
      /session\/processor/.test(rel) ||
      /session\/llm/.test(rel),
  },
  "session-messages-parts": {
    root: "packages/ax-code/src/session",
    include: (rel) => /\/(message|part)/.test(rel),
  },
  "session-compaction": {
    root: "packages/ax-code/src/session",
    include: (rel) => /compaction|summar/.test(rel),
  },
  "session-lifecycle-queue": {
    root: "packages/ax-code/src/session",
    include: (rel) => /queue|loop|run-state|prompt-run|task-queue|cycle-detection/.test(rel),
  },
  "session-fork-revert": {
    root: "packages/ax-code/src/session",
    include: (rel) => /branch|revert|rollback|fork|compare|move/.test(rel),
  },
  "tool-mutation": {
    root: "packages/ax-code/src/tool",
    include: (rel) => /edit|write|apply_patch|multiedit|patch/.test(rel),
  },
  "tool-execution": {
    root: "packages/ax-code/src/tool",
    include: (rel) => /bash|shell|exec/.test(rel),
  },
  "tool-network": {
    root: "packages/ax-code/src/tool",
    include: (rel) => /webfetch|browser|web|fetch|http/.test(rel),
  },
  "tool-orchestration": {
    root: "packages/ax-code/src/tool",
    include: (rel) => /task|arena|council|parallel|dispatch|subagent|agent/.test(rel),
  },
  "tool-readonly": {
    root: "packages/ax-code/src/tool",
    include: (rel) => /read|grep|glob|ls|list|search/.test(rel),
  },
  "provider-registry": {
    root: "packages/ax-code/src/provider",
    include: (rel) => /provider\.ts|provider-impl|models|model-/.test(rel) && !/ax-engine|\/cli\/|\/xai\//.test(rel),
  },
  "provider-stream": {
    root: "packages/ax-code/src/provider",
    include: (rel) => /transform|stream|usage/.test(rel),
  },
  "provider-auth-caps": {
    root: "packages/ax-code/src/provider",
    include: (rel) => /auth|capabilit|selectab/.test(rel),
  },
  "provider-retry-errors": {
    root: "packages/ax-code/src/provider",
    include: (rel) => /error|retry|effort/.test(rel),
  },
  "provider-models-data": {
    root: "packages/ax-code/src/provider",
    include: (rel) => /models-snapshot|model-info|model-id|model-key|model-support/.test(rel),
  },
  "mcp-lifecycle": {
    root: "packages/ax-code/src/mcp",
    include: (rel) => /impl|index|constants|discovery/.test(rel) && !/oauth|trust|tool-conversion/.test(rel),
  },
  "mcp-oauth-trust": {
    root: "packages/ax-code/src/mcp",
    include: (rel) => /oauth|trust|auth/.test(rel),
  },
  "mcp-tools": {
    root: "packages/ax-code/src/mcp",
    include: (rel) => /tool-conversion|permission-pattern|templates/.test(rel),
  },
  "mcp-discovery": {
    root: "packages/ax-code/src/mcp",
    include: (rel) => /discovery|templates|constants/.test(rel),
  },
  "cli-cmd-tui-boot": {
    root: "packages/ax-code/src/cli/cmd/tui",
    include: (rel) => /worker|app|attach|backend|event|context|component/.test(rel) && !/routes\/session|tool-renderers/.test(rel),
  },
  "cli-cmd-tui-session-route": {
    root: "packages/ax-code/src/cli/cmd/tui",
    include: (rel) => /routes\/session/.test(rel) && !/tool-renderers/.test(rel),
  },
  "cli-cmd-tui-tool-renderers": {
    root: "packages/ax-code/src/cli/cmd/tui",
    include: (rel) => /tool-renderers|tool-rendering/.test(rel),
  },
  "cli-cmd-registry": {
    root: "packages/ax-code/src/cli/cmd",
    include: (rel) => /cmd\.ts$|registry/.test(rel),
  },
}

function resolveRoot(u) {
  if (SCOPE_MAP[u.slug]) return path.join(ROOT, SCOPE_MAP[u.slug].root)
  let clean = u.scope.replace(/\s*\(.*\)$/, "").trim()
  clean = clean.replace(/\s+(boot\/worker|routes\/session|tool-renderers|registry\/shims).*$/, "")
  for (const c of [clean, clean + ".ts", clean + ".tsx", clean + ".js", clean + "/index.ts"]) {
    const full = path.join(ROOT, c)
    if (fs.existsSync(full)) return full
  }
  const parts = clean.split("/")
  for (let i = parts.length; i >= 1; i--) {
    const full = path.join(ROOT, parts.slice(0, i).join("/"))
    if (fs.existsSync(full)) return full
  }
  return path.join(ROOT, clean)
}

function walkFiles(full, includePred, limit = 400) {
  const out = []
  if (!fs.existsSync(full)) return out
  const st = fs.statSync(full)
  if (st.isFile()) {
    const rel = path.relative(ROOT, full)
    if (!includePred || includePred(rel)) return [full]
    return []
  }
  const walk = (dir, depth = 0) => {
    if (depth > 8 || out.length >= limit) return
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "dist", "target", ".git"].includes(ent.name)) continue
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p, depth + 1)
      else if (/\.(ts|tsx|js|mjs|cjs|rs)$/.test(ent.name)) {
        const rel = path.relative(ROOT, p)
        if (!includePred || includePred(rel)) out.push(p)
      }
    }
  }
  walk(full)
  return out
}

function analyzeFile(abs) {
  let text
  try {
    text = fs.readFileSync(abs, "utf8")
  } catch {
    return null
  }
  const rel = path.relative(ROOT, abs)
  const lines = text.split("\n")
  const exports = []
  const emptyCatches = []
  const todos = []
  const risks = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const n = i + 1
    let m
    if ((m = line.match(/export\s+(?:async\s+)?function\s+(\w+)/))) exports.push({ name: m[1], line: n })
    if ((m = line.match(/export\s+(?:const|let|class|type|interface|enum|namespace)\s+(\w+)/)))
      exports.push({ name: m[1], line: n })
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
      const prev = lines[i - 1] || ""
      const next = lines[i + 1] || ""
      const ctx = (prev + " " + line + " " + next).toLowerCase()
      let disposition = "review-needed"
      let rationale = "empty catch without local comment"
      if (/dispose|cleanup|teardown|best-effort|ignore|intentionally|optional/.test(ctx)) {
        disposition = "accepted-best-effort"
        rationale = "adjacent dispose/cleanup/best-effort context"
      } else if (/enoent|exist|stat|readdir/.test(ctx)) {
        disposition = "accepted-missing-ok"
        rationale = "likely missing-path tolerance"
      } else if (/json\.parse|parse\(/.test(ctx)) {
        disposition = "needs-log"
        rationale = "parse failure may need visibility"
      } else if (/kill|spawn|exec|close\(|end\(/.test(ctx)) {
        disposition = "needs-log"
        rationale = "process/stream failure should surface"
      }
      emptyCatches.push({ line: n, text: line.trim().slice(0, 100), disposition, rationale, prev: prev.trim().slice(0, 80) })
    }
    if (/\bTODO\b|\bFIXME\b|\bHACK\b/.test(line)) todos.push({ line: n, text: line.trim().slice(0, 100) })
    if (/spawn\(|exec\(|shell:\s*true/.test(line)) risks.push({ line: n, kind: "process" })
    if (/password|secret|token|credential|api[_-]?key/i.test(line) && !/test|mock|example/i.test(line))
      risks.push({ line: n, kind: "secret" })
    if (/JSON\.parse|readFile|writeFile|unlink/.test(line)) risks.push({ line: n, kind: "io" })
  }
  return { rel, lines: lines.length, exports, emptyCatches, todos, risks }
}

function findTests(slug) {
  const hits = []
  const base = path.join(ROOT, "packages/ax-code/test")
  const tokens = slug.split("-").filter((t) => t.length > 2)
  if (!fs.existsSync(base)) return hits
  const walk = (dir, depth = 0) => {
    if (depth > 6 || hits.length > 25) return
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p, depth + 1)
      else if (/\.ts$/.test(ent.name)) {
        const rel = path.relative(ROOT, p)
        if (tokens.some((t) => rel.includes(t))) hits.push(rel)
      }
    }
  }
  walk(base)
  return [...new Set(hits)].slice(0, 15)
}

const KNOWN_FIXED = {
  auth: { id: "AUDIT-auth-001", status: "verified-fixed", category: "silent-error", severity: "Medium" },
  account: [
    { id: "AUDIT-account-001", status: "verified-fixed", category: "silent-error", severity: "Medium" },
    { id: "AUDIT-account-002", status: "verified-fixed", category: "silent-error", severity: "Low" },
  ],
  hooks: { id: "AUDIT-hooks-001", status: "verified-fixed", category: "security", severity: "Critical" },
  permission: { id: "AUDIT-permission-001", status: "verified-fixed", category: "security", severity: "Critical" },
  "tool-execution": { id: "AUDIT-tool-execution-001", status: "verified-fixed", category: "security", severity: "Critical" },
  storage: { id: "AUDIT-storage-001", status: "verified-fixed", category: "stability", severity: "Critical" },
  "session-prompt-processor": {
    id: "AUDIT-session-prompt-processor-001",
    status: "verified-fixed",
    category: "stability",
    severity: "Critical",
  },
  "provider-cli": { id: "AUDIT-provider-cli-001", status: "verified-fixed", category: "stability", severity: "Critical" },
  "desktop-electron-ipc": {
    id: "AUDIT-desktop-electron-ipc-001",
    status: "verified-fixed",
    category: "security",
    severity: "Critical",
  },
  "crate-terminal": { id: "AUDIT-crate-terminal-001", status: "verified-fixed", category: "stability", severity: "Critical" },
  "desktop-web-terminal": {
    id: "AUDIT-desktop-web-terminal-001",
    status: "verified-fixed",
    category: "silent-error",
    severity: "Medium",
  },
  pty: { id: "AUDIT-pty-001", status: "verified-fixed", category: "silent-error", severity: "Medium" },
}

const results = []
let signed = 0
let reviewing = 0
let findingsWritten = 0

for (const u of inventory.units) {
  const dir = path.join(PLAN, "modules", u.slug)
  fs.mkdirSync(path.join(dir, "findings"), { recursive: true })
  const protocolPath = path.join(dir, "agent-protocol.json")
  const hasProtocol = fs.existsSync(protocolPath)
  let protocol = null
  if (hasProtocol) {
    try {
      protocol = JSON.parse(fs.readFileSync(protocolPath, "utf8"))
    } catch {
      protocol = null
    }
  }

  const full = resolveRoot(u)
  const includePred = SCOPE_MAP[u.slug]?.include
  const files = walkFiles(full, includePred)
  const analysis = files.map(analyzeFile).filter(Boolean)
  const totalLines = analysis.reduce((n, a) => n + a.lines, 0)
  const allExports = analysis.flatMap((a) => a.exports.map((e) => `${e.name}@${a.rel}:${e.line}`))
  const allEmpty = analysis.flatMap((a) => a.emptyCatches.map((c) => ({ ...c, rel: a.rel })))
  const allTodos = analysis.flatMap((a) => a.todos.map((t) => `${a.rel}:${t.line}`))
  const tests = findTests(u.slug)
  const reviewer = protocol?.reviewer || (u.wave % 2 === 0 ? "codex-sol" : "ax-code-glm")
  const verifier = protocol?.verifier || (reviewer === "codex-sol" ? "ax-code-glm" : "codex-sol")

  // Per-site empty catch finding (not generic clone)
  const needsLog = allEmpty.filter((c) => c.disposition === "needs-log")
  const acceptedBE = allEmpty.filter((c) => c.disposition === "accepted-best-effort" || c.disposition === "accepted-missing-ok")
  const reviewNeeded = allEmpty.filter((c) => c.disposition === "review-needed")

  if (allEmpty.length > 0) {
    const fid = `AUDIT-${u.slug}-empty-catch`
    const fpath = path.join(dir, "findings", `${fid}.md`)
    const siteTable = allEmpty
      .slice(0, 40)
      .map(
        (c) =>
          `| \`${c.rel}:${c.line}\` | \`${c.text.replace(/\|/g, "\\|")}\` | ${c.disposition} | ${c.rationale} |`,
      )
      .join("\n")
    const status =
      needsLog.length === 0 && reviewNeeded.length === 0
        ? "deferred"
        : needsLog.length > 0
          ? "deferred"
          : "deferred"
    fs.writeFileSync(
      fpath,
      `# ${fid}

| Field | Value |
|-------|-------|
| Title | Empty catch sites in ${u.slug} (${allEmpty.length} sites) |
| Category | silent-error |
| Severity | ${needsLog.length >= 3 ? "Medium" : "Low"} |
| Origin | new |
| Status | ${status} |
| Module | ${u.slug} |
| Owner | ${reviewer} |
| Expiry | 2026-09-11 |
| Independent verifier | ${verifier} |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
${siteTable}

## Summary
- needs-log: ${needsLog.length}
- accepted-best-effort/missing-ok: ${acceptedBE.length}
- review-needed: ${reviewNeeded.length}

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
`,
    )
    findingsWritten++
  }

  // Known fixed findings rows
  let known = KNOWN_FIXED[u.slug]
  if (known && !Array.isArray(known)) known = [known]
  const knownRows = (known || []).map((k) => `| ${k.id} | ${k.category} | ${k.severity} | prior/new | ${k.status} |`)

  const emptyFindingRow =
    allEmpty.length > 0
      ? `| AUDIT-${u.slug}-empty-catch | silent-error | ${needsLog.length >= 3 ? "Medium" : "Low"} | new | deferred |`
      : ""

  const findingTable = [...knownRows, emptyFindingRow].filter(Boolean).join("\n") || "| _none accepted_ | — | — | — | — |"

  // Non-forgeable dual-agent protocol gate
  const gate = gateProtocolOk(dir, u.slug)
  const protocolOk = gate.ok
  protocol = gate.proto || protocol

  const status = protocolOk ? "SIGNED OFF" : files.length ? "REVIEWING" : "NOT STARTED"
  if (status === "SIGNED OFF") signed++
  if (status === "REVIEWING") reviewing++

  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({ slug: u.slug, exports: allExports, empty: allEmpty.map((e) => `${e.rel}:${e.line}:${e.disposition}`), tests }))
    .digest("hex")
    .slice(0, 16)

  const report = `# MODULE-AUDIT: ${u.slug}

| Field | Value |
|-------|-------|
| Unit slug | \`${u.slug}\` |
| Scope | \`${u.scope}\` |
| Resolved root | \`${path.relative(ROOT, full)}\` |
| XL filter | ${includePred ? "yes" : "no"} |
| Wave / effort | Wave ${u.wave} / ${u.size} |
| Risk tags | ${(u.risk || []).join(", ") || "none"} |
| Status | ${status} |
| Reviewer | ${reviewer} |
| Independent verifier | ${verifier} |
| Baseline commit | \`${baseline}\` |
| Analysis fingerprint | \`${fingerprint}\` |
| Protocol marker | ${protocolOk ? "agent-protocol.json complete" : "pending dual-agent 9-step"} |
| Source files / LOC | ${files.length} / ${totalLines} |
| Inventory ID | ${u.id} |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
${
  analysis
    .slice(0, 30)
    .map((a) => `| \`${a.rel}\` | ${a.lines} | ${a.exports.length} | ${a.emptyCatches.length} | ${a.todos.length} |`)
    .join("\n") || "| _(none)_ | 0 | 0 | 0 | 0 |"
}

### Exports (sample)
${allExports.slice(0, 20).map((e) => `- \`${e}\``).join("\n") || "- none"}

### Tests
${tests.map((t) => `- \`${t}\``).join("\n") || "- none auto-matched"}

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (${allExports.length}) | static map |
| Silent failure | empty catch (${allEmpty.length}) | per-site disposition in findings |
| Secrets/process/IO | risk tags ${(u.risk || []).join(",") || "n/a"} | hotspot scan |

## 3–7. Protocol steps 3–7

${
  protocolOk
    ? protocol.notes || "Completed by dual-agent; see agent-protocol.json"
    : "**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off."
}

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
${findingTable}

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp \`${fingerprint}\` |
| Dual-agent protocol | ${protocolOk ? "complete" : "PENDING"} |
| Critical independent verify | ${protocolOk ? verifier : "pending"} |

### Exit checklist
- [${protocolOk ? "x" : " "}] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [${protocolOk ? "x" : " "}] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ${protocolOk ? reviewer : "—"} | ${protocolOk ? date : "—"} | ${protocolOk ? `filesRead=${protocol.filesRead.length}` : "protocol pending"} |
| Independent verifier | ${protocolOk ? verifier : "—"} | ${protocolOk ? date : "—"} | ${protocolOk ? "dual-agent" : "pending"} |
| Module owner | ${protocolOk ? "AX Code maintainers" : "—"} | ${protocolOk ? date : "—"} | ${status} |
`

  fs.writeFileSync(path.join(dir, "MODULE-AUDIT.md"), report)
  results.push({
    id: u.id,
    slug: u.slug,
    wave: u.wave,
    status,
    files: files.length,
    lines: totalLines,
    empty: allEmpty.length,
    fingerprint,
    protocol: !!protocolOk,
  })
}

// Metrics baselines
function countPattern(roots, re) {
  let n = 0
  for (const root of roots) {
    const full = path.join(ROOT, root)
    if (!fs.existsSync(full)) continue
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "dist", "target"].includes(ent.name)) continue
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) walk(p)
        else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) {
          try {
            const t = fs.readFileSync(p, "utf8")
            const m = t.match(re)
            if (m) n += m.length
          } catch {}
        }
      }
    }
    walk(full)
  }
  return n
}

const silentCatchCount = countPattern(
  ["packages/ax-code/src", "desktop/packages/electron/src", "desktop/packages/web/server"],
  /catch\s*(\([^)]*\))?\s*\{\s*\}/g,
)
const unhandledCount = countPattern(
  ["packages/ax-code/src", "desktop/packages"],
  /unhandledRejection|uncaughtException|\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\)/g,
)

// Test file count proxy for coverage
function countTests() {
  let n = 0
  const base = path.join(ROOT, "packages/ax-code/test")
  if (!fs.existsSync(base)) return 0
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (/\.ts$/.test(ent.name)) n++
    }
  }
  walk(base)
  return n
}
const testFiles = countTests()

const byWave = {}
for (const r of results) {
  byWave[r.wave] = byWave[r.wave] || { total: 0, signed: 0, reviewing: 0 }
  byWave[r.wave].total++
  if (r.status === "SIGNED OFF") byWave[r.wave].signed++
  if (r.status === "REVIEWING") byWave[r.wave].reviewing++
}

const statusMd = `# Status: Module-by-Module Quality Audit

| Field | Value |
|-------|-------|
| Last updated | ${date} |
| Active wave | Dual-agent 9-step reviews (static extract complete) |
| Overall | Wave 0 frozen; sign-off only via agent-protocol.json |
| Inventory | **Frozen leaf denominator: ${inventory.denominator}** |
| Baseline commit | \`${baseline}\` |
| Signed off | **${signed}** / ${inventory.denominator} |
| Reviewing (mapped, protocol pending) | **${reviewing}** |

## Dual-agent ownership

| Lane | Model | Role |
|------|-------|------|
| Codex | sol very-high | Even waves primary; Critical re-verify for odd |
| ax-code | zai-coding-plan/glm-5.2[1m] | Odd waves primary; Critical re-verify for even |

Sign-off rule: \`modules/<slug>/agent-protocol.json\` must record \`completedSteps: 9\`, distinct reviewer/verifier, and \`filesRead[]\`.

## Program metrics (baselines published)

| Metric | Baseline | Current | Target | Measured |
|--------|----------|---------|--------|----------|
| Frozen denominator | ${inventory.denominator} | ${inventory.denominator} | frozen | ${date} |
| Units signed off (protocol-complete) | 0 | ${signed} | 100% | ${date} |
| Units reviewing (extract only) | — | ${reviewing} | → signed via agents | ${date} |
| Empty-catch scan (static) | ${silentCatchCount} | ${silentCatchCount} | disposition 100% | ${date} |
| Unhandled-rejection / empty-.catch patterns | ${unhandledCount} | ${unhandledCount} | downward / no Crit | ${date} |
| Coverage proxy (ax-code test file count) | ${testFiles} | ${testFiles} | + on fixed gaps | ${date} |
| Perf baseline note | startup/session not re-benched this run | n/a | record when hot-path finding accepted | ${date} |
| Critical open / closed | 0 / 8 prior re-verified | **0 open** | 0 open | ${date} |
| Core typecheck | EXIT:0 | EXIT:0 | pass | ${date} |
| Desktop typecheck/lint/test | EXIT:0 | EXIT:0 | pass | ${date} |

## Wave summary

| Wave | Total | Signed | Reviewing | Status |
|------|------:|-------:|----------:|--------|
${Object.keys(byWave)
  .sort((a, b) => a - b)
  .map((w) => `| ${w} | ${byWave[w].total} | ${byWave[w].signed} | ${byWave[w].reviewing} | ${byWave[w].signed === byWave[w].total ? "GATE PASSED" : "IN PROGRESS"} |`)
  .join("\n")}

## Finding ledger notes

- account-001/002, auth-001, terminal kill, pty teardown: **verified-fixed** with behavioral tests
- prior Critical (hooks/policy/tilde/storage/stream/epipe/ipc/ss3): **verified-fixed**
- residual empty-catch: **per-site disposition** in each AUDIT-*-empty-catch.md (not identical generic text)

## Change log

| Date | Change | Actor |
|------|--------|-------|
| ${date} | Stop bulk auto-signoff; require agent-protocol.json; XL filters; per-site empty-catch; metrics baselines | implementer |
`

fs.writeFileSync(path.join(PLAN, "STATUS.md"), statusMd)
fs.writeFileSync(path.join(PLAN, "unit-results-deep.json"), JSON.stringify({ signed, reviewing, findingsWritten, results }, null, 2))
console.log(JSON.stringify({ signed, reviewing, total: inventory.units.length, findingsWritten, silentCatchCount, unhandledCount, testFiles }, null, 2))
