import { describe, expect, test } from "bun:test"

import { SafetyPolicy } from "../../src/control-plane/safety-policy"

describe("SafetyPolicy", () => {
  test("allows safe permissions without checkpoint", () => {
    expect(
      SafetyPolicy.decide({
        permission: "read",
        path: "src/index.ts",
      }),
    ).toEqual({
      action: "allow",
      risk: "safe",
      reason: "safe_permission",
      checkpointRequired: false,
      matchedRule: "read",
    })
  })

  test("denies protected paths before permission classification", () => {
    expect(
      SafetyPolicy.decide({
        mode: "autonomous",
        permission: "read",
        path: "packages/app/.env",
      }),
    ).toEqual({
      action: "deny",
      risk: "blocked",
      reason: "protected_path",
      checkpointRequired: false,
      matchedRule: "**/.env",
    })
  })

  test("denies protected directories as well as nested files", () => {
    expect(
      SafetyPolicy.decide({
        permission: "read",
        path: "packages/app/secrets",
      }),
    ).toMatchObject({
      action: "deny",
      reason: "protected_path",
      matchedRule: "**/secrets",
    })
  })

  test("matches glob metacharacters literally outside wildcard tokens", () => {
    expect(
      SafetyPolicy.decide({
        permission: "read",
        path: "packages/app/.env.local",
      }),
    ).toMatchObject({
      action: "deny",
      matchedRule: "**/.env.*",
    })
  })

  test("asks before risky permissions in autonomous mode", () => {
    expect(
      SafetyPolicy.decide({
        mode: "autonomous",
        permission: "write",
        path: "src/app.ts",
      }),
    ).toEqual({
      action: "ask",
      risk: "high",
      reason: "autonomous_risky_permission",
      checkpointRequired: true,
      matchedRule: "write",
    })
  })

  test("allows risky normal-mode permissions only with checkpoint", () => {
    expect(
      SafetyPolicy.decide({
        mode: "normal",
        permission: "bash",
      }),
    ).toEqual({
      action: "allow_with_checkpoint",
      risk: "medium",
      reason: "risky_permission",
      checkpointRequired: true,
      matchedRule: "bash",
    })
  })

  test("asks for unknown permissions in autonomous mode", () => {
    expect(
      SafetyPolicy.decide({
        mode: "autonomous",
        permission: "custom_tool",
      }),
    ).toEqual({
      action: "ask",
      risk: "medium",
      reason: "unknown_permission",
      checkpointRequired: true,
      matchedRule: "custom_tool",
    })
  })

  test("denies blast-radius overages", () => {
    expect(
      SafetyPolicy.decide({
        permission: "write",
        blastRadius: {
          filesChanged: 11,
          maxFiles: 10,
        },
      }),
    ).toEqual({
      action: "deny",
      risk: "blocked",
      reason: "blast_radius_files_exceeded",
      checkpointRequired: false,
      matchedRule: "files>10",
    })
  })

  test("requires checkpoint at blast-radius limit", () => {
    expect(
      SafetyPolicy.decide({
        permission: "write",
        blastRadius: {
          linesChanged: 500,
          maxLines: 500,
        },
      }),
    ).toMatchObject({
      action: "allow_with_checkpoint",
      risk: "high",
      reason: "blast_radius_at_limit",
      checkpointRequired: true,
    })
  })

  test("denies when lines changed exceed limit", () => {
    expect(
      SafetyPolicy.decide({
        permission: "write",
        blastRadius: {
          linesChanged: 501,
          maxLines: 500,
        },
      }),
    ).toEqual({
      action: "deny",
      risk: "blocked",
      reason: "blast_radius_lines_exceeded",
      checkpointRequired: false,
      matchedRule: "lines>500",
    })
  })

  test("forces ask when approvalRequired is set regardless of permission type", () => {
    expect(
      SafetyPolicy.decide({
        mode: "normal",
        permission: "read",
        approvalRequired: true,
      }),
    ).toEqual({
      action: "ask",
      risk: "high",
      reason: "approval_required",
      checkpointRequired: true,
    })
  })

  test("allows permission that appears in custom safePermissions override", () => {
    expect(
      SafetyPolicy.decide({
        permission: "custom_read",
        safePermissions: ["custom_read", "custom_list"],
      }),
    ).toEqual({
      action: "allow",
      risk: "safe",
      reason: "safe_permission",
      checkpointRequired: false,
      matchedRule: "custom_read",
    })
  })

  test("treats permission as risky when it appears in custom riskyPermissions override", () => {
    expect(
      SafetyPolicy.decide({
        mode: "normal",
        permission: "custom_write",
        safePermissions: [],
        riskyPermissions: ["custom_write"],
      }),
    ).toEqual({
      action: "allow_with_checkpoint",
      risk: "medium",
      reason: "risky_permission",
      checkpointRequired: true,
      matchedRule: "custom_write",
    })
  })

  test("allows checkpoint for unknown permissions in normal mode without strictUnknown", () => {
    expect(
      SafetyPolicy.decide({
        mode: "normal",
        permission: "totally_unknown_tool",
      }),
    ).toEqual({
      action: "allow_with_checkpoint",
      risk: "low",
      reason: "unknown_permission_checkpoint",
      checkpointRequired: true,
      matchedRule: "totally_unknown_tool",
    })
  })

  test("treats unknown permission as ask when strictUnknown is set in normal mode", () => {
    expect(
      SafetyPolicy.decide({
        mode: "normal",
        permission: "new_tool",
        strictUnknown: true,
      }),
    ).toEqual({
      action: "ask",
      risk: "medium",
      reason: "unknown_permission",
      checkpointRequired: true,
      matchedRule: "new_tool",
    })
  })

  test("denies access when any path in the paths array is protected", () => {
    expect(
      SafetyPolicy.decide({
        permission: "read",
        path: "src/index.ts",
        paths: ["src/util.ts", "packages/app/.env"],
      }),
    ).toMatchObject({
      action: "deny",
      reason: "protected_path",
      matchedRule: "**/.env",
    })
  })

  test("allows reads when no path in the paths array is protected", () => {
    expect(
      SafetyPolicy.decide({
        permission: "read",
        path: "src/index.ts",
        paths: ["src/util.ts", "src/helpers.ts"],
      }),
    ).toEqual({
      action: "allow",
      risk: "safe",
      reason: "safe_permission",
      checkpointRequired: false,
      matchedRule: "read",
    })
  })

  test("denies protected git hooks paths", () => {
    expect(
      SafetyPolicy.decide({
        permission: "write",
        path: ".git/hooks/pre-commit",
      }),
    ).toMatchObject({
      action: "deny",
      reason: "protected_path",
    })
  })

  test("evaluates custom protected paths when provided", () => {
    expect(
      SafetyPolicy.decide({
        permission: "read",
        path: "internal/config.yaml",
        protectedPaths: ["internal/**"],
      }),
    ).toMatchObject({
      action: "deny",
      reason: "protected_path",
      matchedRule: "internal/**",
    })
  })
})
