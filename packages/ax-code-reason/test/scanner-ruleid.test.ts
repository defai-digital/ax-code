import { afterEach, describe, expect, test } from "vitest"
import { DebugEngine } from "../src/index"
import { installTestHost, resetTestHost } from "./fixture/host"
import { RULE_ID_PATTERN } from "../src/quality/finding"

// Phase 4-prep (U4) — ruleId + audit-caveat on scanner outputs.
//
// Scope:
//   - Every finding produced by the five JS/TS scanners
//     (detect-duplicates, detect-hardcodes, detect-races,
//     detect-lifecycle, detect-security) carries a ruleId that conforms
//     to RULE_ID_PATTERN.
//   - Every scanner report (regardless of outcome: empty, scope=none,
//     or populated) carries an auditCaveat string reminding callers
//     that "clean scan != full language audit".
//
// Both fields are additive (Phase 4-prep U4): optional on the types
// and populated at the scanner's finding/report construction sites.

const PROJECT_ID = "test-scanner-ruleid"

function assertConformingRuleId(value: string | undefined, where: string): void {
  if (value === undefined) {
    throw new Error(`${where}: ruleId is undefined`)
  }
  if (typeof value !== "string") {
    throw new Error(`${where}: ruleId is not a string (got ${typeof value})`)
  }
  if (!RULE_ID_PATTERN.test(value)) {
    throw new Error(`${where}: ruleId ${JSON.stringify(value)} does not match ${RULE_ID_PATTERN}`)
  }
}

function assertAuditCaveatPresent(report: { auditCaveat?: string }, where: string): void {
  if (typeof report.auditCaveat !== "string" || report.auditCaveat.length === 0) {
    throw new Error(`${where}: auditCaveat is missing or empty`)
  }
  if (!/audit|full|clean/i.test(report.auditCaveat)) {
    throw new Error(`${where}: auditCaveat does not read like an audit-scope caveat: ${report.auditCaveat}`)
  }
}

describe("Phase 4-prep (U4) scanner ruleId + auditCaveat", () => {
  afterEach(() => {
    resetTestHost()
  })

  test("detectHardcodes: report carries auditCaveat; every finding carries a conforming ruleId", async () => {
    const host = installTestHost()
    const report = await DebugEngine.detectHardcodes(PROJECT_ID as never, { scope: "none" })
    assertAuditCaveatPresent(report, "detectHardcodes(report)")
    expect(report.findings).toEqual([])

    const populated = await DebugEngine.detectHardcodes(PROJECT_ID as never, {
      scope: "none",
      files: ["/repo/.scratch/never-scanned.ts"],
    })
    assertAuditCaveatPresent(populated, "detectHardcodes(populated)")
    for (const finding of populated.findings) {
      assertConformingRuleId(finding.ruleId, `detectHardcodes(${finding.kind})`)
      expect(finding.ruleId).toBe(`axcode:detect-hardcodes-${finding.kind.replace(/_/g, "-")}`)
    }
    void host
  })

  test("detectRaces: report carries auditCaveat; every finding carries a conforming ruleId", async () => {
    installTestHost()
    const report = await DebugEngine.detectRaces(PROJECT_ID as never, { scope: "none" })
    assertAuditCaveatPresent(report, "detectRaces(report)")
    expect(report.findings).toEqual([])

    const populated = await DebugEngine.detectRaces(PROJECT_ID as never, {
      scope: "none",
      files: ["/repo/.scratch/never-scanned.ts"],
    })
    assertAuditCaveatPresent(populated, "detectRaces(populated)")
    for (const finding of populated.findings) {
      assertConformingRuleId(finding.ruleId, `detectRaces(${finding.pattern})`)
      expect(finding.ruleId).toBe(`axcode:detect-races-${finding.pattern.replace(/_/g, "-")}`)
    }
  })

  test("detectLifecycle: report carries auditCaveat; every finding carries a conforming ruleId", async () => {
    installTestHost()
    const report = await DebugEngine.detectLifecycle(PROJECT_ID as never, { scope: "none" })
    assertAuditCaveatPresent(report, "detectLifecycle(report)")
    expect(report.findings).toEqual([])

    const populated = await DebugEngine.detectLifecycle(PROJECT_ID as never, {
      scope: "none",
      files: ["/repo/.scratch/never-scanned.ts"],
    })
    assertAuditCaveatPresent(populated, "detectLifecycle(populated)")
    for (const finding of populated.findings) {
      assertConformingRuleId(finding.ruleId, `detectLifecycle(${finding.resourceType}/${finding.pattern})`)
      expect(finding.ruleId).toBe(
        `axcode:detect-lifecycle-${finding.resourceType.replace(/_/g, "-")}-${finding.pattern.replace(/_/g, "-")}`,
      )
    }
  })

  test("detectSecurity: report carries auditCaveat; every finding carries a conforming ruleId", async () => {
    installTestHost()
    const report = await DebugEngine.detectSecurity(PROJECT_ID as never, { scope: "none" })
    assertAuditCaveatPresent(report, "detectSecurity(report)")
    expect(report.findings).toEqual([])

    const populated = await DebugEngine.detectSecurity(PROJECT_ID as never, {
      scope: "none",
      files: ["/repo/.scratch/never-scanned.ts"],
    })
    assertAuditCaveatPresent(populated, "detectSecurity(populated)")
    for (const finding of populated.findings) {
      assertConformingRuleId(finding.ruleId, `detectSecurity(${finding.pattern})`)
      expect(finding.ruleId).toBe(`axcode:detect-security-${finding.pattern.replace(/_/g, "-")}`)
    }
  })

  test("detectDuplicates: report carries auditCaveat; every cluster carries a conforming ruleId", async () => {
    installTestHost()
    const report = await DebugEngine.detectDuplicates(PROJECT_ID as never, { scope: "none" })
    assertAuditCaveatPresent(report, "detectDuplicates(report)")
    expect(report.clusters).toEqual([])

    // Empty graph → no clusters, but the caveat must still be present
    // and the type must accept the optional field.
    expect(report.auditCaveat).toBeTypeOf("string")
  })

  test("RULE_ID_PATTERN accepts every scanner's ruleId namespace", () => {
    const samples = [
      "axcode:detect-duplicates-exact",
      "axcode:detect-duplicates-structural",
      "axcode:detect-duplicates-semantic",
      "axcode:detect-hardcodes-magic-number",
      "axcode:detect-hardcodes-inline-url",
      "axcode:detect-hardcodes-inline-path",
      "axcode:detect-hardcodes-inline-secret-shape",
      "axcode:detect-races-toctou",
      "axcode:detect-races-non-atomic-counter",
      "axcode:detect-races-conflicting-mutation",
      "axcode:detect-races-stale-listener",
      "axcode:detect-lifecycle-event-listener-no-cleanup",
      "axcode:detect-lifecycle-timer-no-cleanup",
      "axcode:detect-lifecycle-subscription-no-cleanup",
      "axcode:detect-lifecycle-abort-controller-no-cleanup",
      "axcode:detect-lifecycle-child-process-no-cleanup",
      "axcode:detect-lifecycle-map-growth-unbounded-growth",
      "axcode:detect-security-path-traversal",
      "axcode:detect-security-command-injection",
      "axcode:detect-security-ssrf",
      "axcode:detect-security-missing-validation",
      "axcode:detect-security-env-leak",
      "policy:custom-rule",
      "user:my-rule",
    ]
    for (const sample of samples) {
      expect(sample, sample).toMatch(RULE_ID_PATTERN)
    }
    // Negative samples — uppercase, leading dash, missing colon, empty kebab.
    // (The pattern intentionally allows trailing dashes; that's an
    // implementation detail of the regex, not a contract violation.)
    expect("axcode:Detect-Hardcodes-Magic-Number").not.toMatch(RULE_ID_PATTERN)
    expect("axcode:-leading-dash").not.toMatch(RULE_ID_PATTERN)
    expect("axcode").not.toMatch(RULE_ID_PATTERN)
    expect("axcode:").not.toMatch(RULE_ID_PATTERN)
    expect("unknown:other-rule").not.toMatch(RULE_ID_PATTERN)
  })
})
