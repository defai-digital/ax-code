#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { protocolOk } from "./protocol-gate.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const PLAN = path.join(ROOT, "docs/module-quality-audit")
const inventory = JSON.parse(fs.readFileSync(path.join(PLAN, "inventory-frozen.json"), "utf8"))

let signedClaimed = 0
let signedPass = 0
const failures = []

for (const u of inventory.units) {
  const dir = path.join(PLAN, "modules", u.slug)
  const auditPath = path.join(dir, "MODULE-AUDIT.md")
  if (!fs.existsSync(auditPath)) {
    failures.push(`${u.slug}: missing MODULE-AUDIT.md`)
    continue
  }
  const audit = fs.readFileSync(auditPath, "utf8")
  const claimsSigned = /\| Status \| SIGNED OFF \|/.test(audit)
  const gate = protocolOk(dir, u.slug)
  if (claimsSigned) {
    signedClaimed++
    if (!gate.ok) failures.push(`${u.slug}: SIGNED OFF but gate failed: ${gate.reasons.join("; ")}`)
    else signedPass++
  } else if (gate.ok) {
    failures.push(`${u.slug}: gate passes but MODULE-AUDIT not SIGNED OFF`)
  }
}

const status = fs.readFileSync(path.join(PLAN, "STATUS.md"), "utf8")
// Prefer "Signed off | **N** / DENOM" table field
const m =
  /\| Signed off \| \*\*(\d+)\*\* \/ \d+ \|/.exec(status) ||
  /Units signed off \(protocol-complete\) \| [^|]+ \| (\d+) \|/.exec(status)
const statusCount = m ? Number(m[1]) : null

console.log(JSON.stringify({ signedClaimed, signedPass, statusCount, failures: failures.length, denom: inventory.denominator }, null, 2))
if (failures.length) {
  console.error(failures.slice(0, 40).join("\n"))
  if (failures.length > 40) console.error(`... +${failures.length - 40} more`)
  process.exit(1)
}
if (statusCount !== null && statusCount !== signedPass) {
  console.error(`STATUS signed count ${statusCount} != integrity pass ${signedPass}`)
  process.exit(1)
}
console.log("PASS protocol integrity")
