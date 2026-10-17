import { describe, expect, test } from "vitest"
import { autoAcceptEnabled, shouldAutoAccept } from "../../src/permission/auto-accept"
import { AUTONOMOUS_BLOCKED_PATHS, AUTONOMOUS_PROTECTED_PATHS } from "../../src/constants/session"
import { SafetyPolicy } from "../../src/control-plane/safety-policy"

const base = {
  enabled: true,
  permission: "edit",
  patterns: ["src/file.ts"],
  directory: "/project",
  decide: (input: Parameters<typeof SafetyPolicy.decide>[0]) => SafetyPolicy.decide(input),
}

describe("project auto-accept pure decision", () => {
  test("without an injected safety decision nothing is auto-accepted (fail closed)", () => {
    const { decide: _decide, ...withoutDecide } = base
    expect(shouldAutoAccept(withoutDecide)).toBe(false)
  })

  test("off by default; managed force-off dominates config and runtime", () => {
    expect(autoAcceptEnabled({})).toBe(false)
    expect(shouldAutoAccept({ ...base, enabled: undefined })).toBe(false)
    for (const configured of [undefined, false, true]) {
      for (const override of [undefined, false, true]) {
        expect(autoAcceptEnabled({ configured, override, managedDisabled: true })).toBe(false)
        expect(autoAcceptEnabled({ configured, override })).toBe(override ?? configured ?? false)
      }
    }
  })
  test.each(["edit", "write", "apply_patch", "multiedit", "bash"])("includes %s", (permission) => {
    expect(
      shouldAutoAccept({
        ...base,
        permission,
        patterns: [permission === "bash" ? "echo hello" : "src/file.ts"],
        metadata: { bashCommand: "echo hello", bashCwd: "/project" },
      }),
    ).toBe(true)
  })
  test.each([
    "external_directory",
    "computer",
    "mcp_sampling",
    "hook",
    "isolation_escalation",
    "bash_destructive",
    "ops_approve",
    "webmcp",
    "read",
    "task",
    "unknown",
    "schedule",
  ])("excludes %s", (permission) => {
    expect(shouldAutoAccept({ ...base, permission })).toBe(false)
  })
  test.each(["high", "unknown", "blocked", "unexpected"])("excludes risk %s", (risk) => {
    expect(shouldAutoAccept({ ...base, risk })).toBe(false)
    expect(shouldAutoAccept({ ...base, riskClass: risk })).toBe(false)
  })
  test.each([
    { interactiveOnly: true },
    { metadata: { requireInteractive: true } },
    { denied: true },
    { managedRule: true },
    { managedDisabled: true },
    { patterns: [] },
  ])("keeps a protected approval asking: %j", (extra) => {
    expect(shouldAutoAccept({ ...base, ...extra })).toBe(false)
  })
  test.each([...new Set([...AUTONOMOUS_BLOCKED_PATHS, ...AUTONOMOUS_PROTECTED_PATHS])])(
    "preserves protected pattern %s",
    (glob) => {
      const target = glob.replaceAll("**/", "nested/").replaceAll("**", "file").replaceAll("*", "file")
      expect(shouldAutoAccept({ ...base, patterns: [target] })).toBe(false)
      expect(
        shouldAutoAccept({
          ...base,
          permission: "bash",
          patterns: ["echo test"],
          paths: [target],
          metadata: { bashCommand: "echo test", bashCwd: "/project" },
        }),
      ).toBe(false)
    },
  )
  test.each([".git/HEAD", "src/../.env", "src/../../outside", "/outside/file", "~/.config/config", "src/*"])(
    "does not auto-accept %s",
    (target) => {
      expect(shouldAutoAccept({ ...base, patterns: [target] })).toBe(false)
    },
  )
  test.each([
    "echo hi > .env",
    "tool --output=.env",
    "cat secrets/password",
    "echo $HOME",
    "echo `pwd`",
    "touch *.pem",
  ])("keeps sensitive or uncertain bash asking: %s", (command) => {
    expect(
      shouldAutoAccept({
        ...base,
        permission: "bash",
        patterns: [command],
        metadata: { bashCommand: command, bashCwd: "/project" },
      }),
    ).toBe(false)
  })
  test("extra protected lists are additive, including absolute paths", () => {
    expect(shouldAutoAccept({ ...base, protectedPaths: ["src/**"] })).toBe(false)
    expect(shouldAutoAccept({ ...base, protectedPaths: ["/project/src/**"] })).toBe(false)
    expect(shouldAutoAccept({ ...base, patterns: [".env"], protectedPaths: [] })).toBe(false)
  })
})
