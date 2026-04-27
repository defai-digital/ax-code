import { describe, expect, test } from "bun:test"
import { classify, SAFE_PERMISSIONS, RISK_PERMISSIONS } from "../../src/permission/risk-classes"

describe("permission risk classification", () => {
  test("safe permissions classify as safe", () => {
    for (const p of SAFE_PERMISSIONS) {
      expect(classify(p)).toBe("safe")
    }
  })

  test("risk permissions classify as risk", () => {
    for (const p of RISK_PERMISSIONS) {
      expect(classify(p)).toBe("risk")
    }
  })

  test("unknown permissions classify as unknown", () => {
    expect(classify("isolation_escalation")).toBe("unknown")
    expect(classify("doom_loop")).toBe("unknown")
    expect(classify("totally_made_up")).toBe("unknown")
  })

  test("safe and risk sets do not overlap", () => {
    for (const p of SAFE_PERMISSIONS) {
      expect(RISK_PERMISSIONS.has(p)).toBe(false)
    }
  })

  test("listed names match real permission strings used in the codebase (regression)", () => {
    // These are the actual `permission: "..."` strings emitted by tool
    // runtimes today (write/apply_patch/multiedit/edit/refactor_apply
    // all map to "edit" via EDIT_TOOLS in permission/index.ts).
    // A name in the SAFE/RISK sets that nobody ever queries is dead
    // code and a misleading classification — guard against the earlier
    // mistake where the lists carried wishlist names like "write",
    // "apply_patch", "list_directory".
    const realPermissionNames = new Set([
      "bash",
      "code_intelligence",
      "codesearch",
      "edit",
      "external_directory",
      "glob",
      "grep",
      "list",
      "lsp",
      "read",
      "skill",
      "task",
      "todoread",
      "todowrite",
      "webfetch",
      "websearch",
      // ADR-005 dispatcher; checked explicitly because the Dispatch
      // tool is registered separately.
      "dispatcher",
    ])
    for (const p of SAFE_PERMISSIONS) {
      expect(realPermissionNames.has(p)).toBe(true)
    }
    for (const p of RISK_PERMISSIONS) {
      expect(realPermissionNames.has(p)).toBe(true)
    }
  })

  test("classifies tool-emitted permission names correctly", () => {
    // Sanity-check the hybrid policy boundaries: read-class is safe,
    // edit-class is risk, network-egress and subagent-spawn are risk.
    expect(classify("read")).toBe("safe")
    expect(classify("grep")).toBe("safe")
    expect(classify("codesearch")).toBe("safe")
    expect(classify("edit")).toBe("risk")
    expect(classify("bash")).toBe("risk")
    expect(classify("external_directory")).toBe("risk")
    expect(classify("task")).toBe("risk")
    expect(classify("dispatcher")).toBe("risk")
    expect(classify("webfetch")).toBe("risk")
  })
})
