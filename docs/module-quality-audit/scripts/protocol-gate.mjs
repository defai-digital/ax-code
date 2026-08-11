/** Shared non-forgeable protocol gate for sign-off. */
import fs from "node:fs"
import path from "node:path"

export const ALLOWED_REVIEWERS = new Set(["codex-sol", "ax-code-glm"])

export const TEMPLATE_PREFIXES = [
  "Mapped ",
  "Threat: secrets=",
  "Correctness: read control flow",
  "Performance: not hot-path",
  "Performance: hot-path unit",
  "Design: ownership vs ARCHITECTURE",
  "Hygiene: empty=",
  "Tests: see MODULE-AUDIT",
  "Findings disposition complete",
  "Verification commands recorded in STATUS",
]

export function isTemplateStepNotes(stepNotes) {
  if (!stepNotes || typeof stepNotes !== "object") return true
  const values = Object.values(stepNotes).map(String)
  if (values.length === 0) return true
  let hits = 0
  for (const v of values) {
    if (TEMPLATE_PREFIXES.some((p) => v.startsWith(p))) hits++
  }
  return hits >= Math.min(3, values.length)
}

export function protocolOk(modDir, slug) {
  const reasons = []
  const protoPath = path.join(modDir, "agent-protocol.json")
  if (!fs.existsSync(protoPath)) return { ok: false, reasons: ["missing agent-protocol.json"] }
  let proto
  try {
    proto = JSON.parse(fs.readFileSync(protoPath, "utf8"))
  } catch (e) {
    return { ok: false, reasons: ["invalid agent-protocol.json"] }
  }

  if (proto.completedSteps !== 9) reasons.push(`completedSteps=${proto.completedSteps}`)
  if (!ALLOWED_REVIEWERS.has(proto.reviewer)) reasons.push(`reviewer=${proto.reviewer}`)
  if (!ALLOWED_REVIEWERS.has(proto.verifier)) reasons.push(`verifier=${proto.verifier}`)
  if (proto.reviewer === proto.verifier) reasons.push("reviewer===verifier")
  if (!Array.isArray(proto.filesRead) || proto.filesRead.length === 0) reasons.push("filesRead empty")
  if (isTemplateStepNotes(proto.stepNotes)) reasons.push("template stepNotes")

  const stepsPath = path.join(modDir, "protocol", "steps.md")
  const runPath = path.join(modDir, "protocol", "reviewer-run.json")
  if (!fs.existsSync(stepsPath)) reasons.push("missing protocol/steps.md")
  else {
    const steps = fs.readFileSync(stepsPath, "utf8")
    if (steps.length < 400) reasons.push("steps.md too short")
    // must mention unit slug or concrete paths
    if (!steps.includes(slug) && !proto.filesRead.some((f) => steps.includes(f))) {
      reasons.push("steps.md lacks unit-specific paths")
    }
  }
  if (!fs.existsSync(runPath)) reasons.push("missing protocol/reviewer-run.json")
  else {
    try {
      const run = JSON.parse(fs.readFileSync(runPath, "utf8"))
      if (!run.agentId || !run.model || !run.startedAt || !run.finishedAt) {
        reasons.push("reviewer-run.json incomplete fields")
      }
      if (run.reviewer && run.reviewer !== proto.reviewer) reasons.push("reviewer-run mismatch")
      if (!run.filesRead || run.filesRead.length === 0) reasons.push("reviewer-run filesRead empty")
    } catch {
      reasons.push("invalid reviewer-run.json")
    }
  }

  // Critical findings need reverify.md from other lane
  const findingsDir = path.join(modDir, "findings")
  if (fs.existsSync(findingsDir)) {
    for (const name of fs.readdirSync(findingsDir)) {
      if (!name.endsWith(".md")) continue
      const t = fs.readFileSync(path.join(findingsDir, name), "utf8")
      const sev = /\| Severity \| ([^|]+) \|/.exec(t)?.[1]?.trim()
      const st = /\| Status \| ([^|]+) \|/.exec(t)?.[1]?.trim()
      if (sev === "Critical" && (st === "verified-fixed" || st === "accepted" || st === "fixing")) {
        const rev = path.join(modDir, "protocol", "reverify.md")
        if (!fs.existsSync(rev)) reasons.push(`Critical ${name} missing protocol/reverify.md`)
        else {
          const r = fs.readFileSync(rev, "utf8")
          if (r.length < 120) reasons.push("reverify.md too short")
          if (!r.includes(proto.verifier) && !r.includes("Verifier")) reasons.push("reverify.md missing verifier identity")
        }
      }
    }
  }

  return { ok: reasons.length === 0, reasons, proto }
}
