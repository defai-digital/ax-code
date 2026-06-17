/**
 * ax-internal-context.ts
 *
 * Status-filtered context feed for cleanup/improvement skills (e.g. improve-overall).
 *
 * Reads ax-internal/adr/INDEX.md and ax-internal/arch/*-policy.md and emits ONLY the
 * authoritative tier as cleanup targets:
 *   - ADRs with status starting "Acc" (accepted, possibly implemented) — these are decided
 *     boundaries code should align to.
 *   - Living arch policies — hard constraints any cleanup must not violate.
 *
 * Explicitly EXCLUDES:
 *   - "Prop" ADRs (undecided proposals) — refactoring toward these would silently implement a
 *     decision never made.
 *   - "Part" ADRs (in-progress) — flagged as in-progress, not cleanup targets.
 *   - "Abs"/"Def" (absorbed/deferred) — historical only.
 *   - PRD roadmap and maturity snapshots — directional/advisory, not mandates.
 *
 * Usage:
 *   bun script/ax-internal-context.ts              # print context block to stdout
 *   bun script/ax-internal-context.ts --json        # emit machine-readable JSON
 *
 * This is the safety guardrail that lets a cleanup skill consume ax-internal/ safely.
 */
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

const ROOT = path.resolve(import.meta.dirname, "..")
const ADR_INDEX = path.join(ROOT, "ax-internal/adr/INDEX.md")
const ARCH_DIR = path.join(ROOT, "ax-internal/arch")

interface AdrRow {
  id: string
  title: string
  status: string
  href: string
  authoritative: boolean
}

interface PolicyFile {
  name: string
  path: string
}

/**
 * Parse all markdown table rows from the ADR INDEX. Columns: link, title, status.
 * Status values seen: "Acc", "Acc — Impl", "Part; ...", "Prop — ...", "Prop — Def", etc.
 */
function parseAdrIndex(markdown: string): AdrRow[] {
  const rows: AdrRow[] = []
  const tableRowRe = /^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/
  for (const line of markdown.split("\n")) {
    const m = line.match(tableRowRe)
    if (!m) continue
    const [, id, href, title, status] = m
    // Skip header separator rows and non-ADR rows
    if (id.startsWith("---") || id.toLowerCase().includes("title")) continue
    const authoritative = /^Acc\b/.test(status.trim())
    rows.push({ id, title: title.trim(), status: status.trim(), href, authoritative })
  }
  return rows
}

async function listPolicies(): Promise<PolicyFile[]> {
  const entries = await readdir(ARCH_DIR).catch(() => [])
  return entries
    .filter((f) => f.endsWith("-policy.md") || f === "repo-structure.md")
    .map((name) => ({ name, path: `ax-internal/arch/${name}` }))
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      json: { type: "boolean", default: false },
    },
  })

  const [indexMd, policies] = await Promise.all([readFile(ADR_INDEX, "utf8"), listPolicies()])
  const allRows = parseAdrIndex(indexMd)
  const authoritative = allRows.filter((r) => r.authoritative)
  const excluded = allRows.filter((r) => !r.authoritative)

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          authoritativeAdrs: authoritative.map(({ id, title, status, href }) => ({
            id,
            title,
            status,
            file: `ax-internal/adr/${href}`,
          })),
          excludedAdrs: excluded.map((r) => ({ id: r.id, status: r.status })),
          policies,
        },
        null,
        2,
      ),
    )
    return
  }

  // Human-readable context block for a cleanup skill
  console.log("# ax-internal authoritative context for cleanup\n")
  console.log("## Authoritative ADRs (status: Acc / Acc — Impl) — code should align to these boundaries\n")
  for (const r of authoritative) {
    console.log(`- **${r.id}** (${r.status}): ${r.title} → ax-internal/adr/${r.href}`)
  }
  console.log("\n## Living policies — hard constraints; any cleanup must not violate these\n")
  for (const p of policies) {
    console.log(`- ${p.name} → ${p.path}`)
  }
  console.log("\n## EXCLUDED (do NOT refactor toward these — undecided/in-progress/historical)\n")
  for (const r of excluded) {
    console.log(`- ${r.id} [${r.status}]`)
  }
  console.log("\n## Also excluded (advisory, not mandates): prd/PRD.md roadmap, arch/product-maturity-assessment-*.md")
}

main().catch((err) => {
  console.error("ax-internal-context failed:", err)
  process.exit(1)
})
