#!/usr/bin/env node
/**
 * SCAFFOLD ONLY — must not claim dual-agent protocol completion.
 * Writes modules/<slug>/scaffold.json with file lists and static counts.
 * Never writes completedSteps:9 or agent-protocol.json sign-off.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const PLAN = path.join(ROOT, "docs/module-quality-audit")
const inventory = JSON.parse(fs.readFileSync(path.join(PLAN, "inventory-frozen.json"), "utf8"))
const slugs = process.argv.slice(2)
if (slugs.length === 0) {
  console.error("usage: implementer-protocol.mjs <slug>...")
  process.exit(2)
}

for (const slug of slugs) {
  const unit = inventory.units.find((u) => u.slug === slug)
  if (!unit) {
    console.error("unknown", slug)
    continue
  }
  const modDir = path.join(PLAN, "modules", slug)
  fs.mkdirSync(path.join(modDir, "protocol"), { recursive: true })
  const audit = fs.existsSync(path.join(modDir, "MODULE-AUDIT.md"))
    ? fs.readFileSync(path.join(modDir, "MODULE-AUDIT.md"), "utf8")
    : ""
  const files = []
  for (const line of audit.split("\n")) {
    const m = line.match(/^\| `([^`]+)` \| (\d+) \|/)
    if (m) files.push(m[1])
  }
  const scaffold = {
    status: "SCAFFOLD",
    completedSteps: 0,
    slug,
    candidateFiles: files.slice(0, 40),
    note: "Scaffold only — dual-agent must author protocol/steps.md + reviewer-run.json",
  }
  fs.writeFileSync(path.join(modDir, "scaffold.json"), JSON.stringify(scaffold, null, 2))
  // Explicitly refuse to write sign-off markers
  const forbidden = path.join(modDir, "agent-protocol.json")
  if (fs.existsSync(forbidden)) {
    try {
      const p = JSON.parse(fs.readFileSync(forbidden, "utf8"))
      if (p.reviewer === "implementer" || p.completedSteps === 9 && !p.reviewerRunId) {
        // leave for integrity wipe; do not refresh
      }
    } catch {}
  }
  console.log(`scaffold ${slug} files=${files.length}`)
}
