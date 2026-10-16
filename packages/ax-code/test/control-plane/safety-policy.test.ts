import { describe, expect, test } from "vitest"

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

  test("denies sensitive credential files the same way .env is denied (ADR-235)", () => {
    // Private keys, material credentials, and the dotfile credentials
    // stores that npm/PyPI/the major clouds read at login. Each path
    // must trip a hard "deny" the same way .env does, with a matched
    // rule from the protected list — so the existing blast-radius and
    // permission paths pick the right reason without per-file special
    // cases.
    const cases: Array<[string, string]> = [
      // Top-level paths trip the bare-name pattern; nested paths trip
      // the `**/`-prefixed twin. Either way the action is `deny` with
      // `protected_path` — the matched rule is informational, the
      // protection is not.
      ["server.pem", "*.pem"],
      ["keys/server.pem", "**/*.pem"],
      ["certs/site.p12", "**/*.p12"],
      [".ssh/id_rsa", "**/id_rsa*"],
      [".ssh/id_rsa-cert", "**/id_rsa*"],
      [".ssh/id_ed25519", "**/id_ed25519*"],
      [".ssh/id_ed25519-sk", "**/id_ed25519*"],
      [".npmrc", ".npmrc"],
      ["subdir/.npmrc", "**/.npmrc"],
      [".pypirc", ".pypirc"],
      [".netrc", ".netrc"],
      ["service-account/credentials.json", "**/credentials.json"],
      [".aws/credentials", ".aws/credentials"],
      ["subdir/.aws/credentials", "**/.aws/credentials"],
      [".config/gcloud/credentials.db", ".config/gcloud/**"],
    ]
    for (const [path, expectedRule] of cases) {
      const decision = SafetyPolicy.decide({
        mode: "autonomous",
        permission: "edit",
        path,
      })
      expect(decision.action, path).toBe("deny")
      expect(decision.reason, path).toBe("protected_path")
      expect(decision.matchedRule, path).toBe(expectedRule)
    }
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
        permission: "edit",
        path: "src/app.ts",
      }),
    ).toEqual({
      action: "ask",
      risk: "high",
      reason: "autonomous_risky_permission",
      checkpointRequired: true,
      matchedRule: "edit",
    })
  })

  test("does not classify stale tool aliases as default runtime permissions", () => {
    expect(
      SafetyPolicy.decide({
        mode: "normal",
        permission: "write",
      }),
    ).toEqual({
      action: "allow_with_checkpoint",
      risk: "low",
      reason: "unknown_permission_checkpoint",
      checkpointRequired: true,
      matchedRule: "write",
    })
  })

  test("uses runtime permission risk classes for autonomous shadow decisions", () => {
    expect(
      SafetyPolicy.decide({
        mode: "autonomous",
        permission: "task",
      }),
    ).toMatchObject({
      action: "ask",
      risk: "high",
      reason: "autonomous_risky_permission",
      matchedRule: "task",
    })

    expect(
      SafetyPolicy.decide({
        mode: "autonomous",
        permission: "memorywrite",
      }),
    ).toMatchObject({
      action: "ask",
      risk: "high",
      reason: "autonomous_risky_permission",
      matchedRule: "memorywrite",
    })
  })

  test("keeps network search aligned with runtime risky permissions", () => {
    for (const permission of ["websearch", "codesearch"]) {
      expect(
        SafetyPolicy.decide({
          mode: "autonomous",
          permission,
        }),
      ).toEqual({
        action: "ask",
        risk: "high",
        reason: "autonomous_risky_permission",
        checkpointRequired: true,
        matchedRule: permission,
      })
    }
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

  test("keeps denying protected .git paths and asks for other .git control paths (ADR-235)", () => {
    for (const path of [".git/hooks/pre-commit", ".git/config", ".git/refs/heads/main"]) {
      const decision = SafetyPolicy.decide({ mode: "autonomous", permission: "write", path })
      expect(decision.action, path).toBe("deny")
      expect(decision.reason, path).toBe("protected_path")
    }
    for (const path of [".git/HEAD", ".git/info/exclude", "subdir/.git/HEAD"]) {
      const decision = SafetyPolicy.decide({ mode: "autonomous", permission: "write", path })
      expect(decision.action, path).toBe("ask")
      expect(decision.reason, path).toBe("git_control_path")
      expect(decision.checkpointRequired, path).toBe(true)
    }
  })
  test("asks for nested .git control paths", () => {
    const decision = SafetyPolicy.decide({
      mode: "autonomous",
      permission: "edit",
      path: "subdir/.git/HEAD",
    })
    expect(decision.action).toBe("ask")
    expect(decision.reason).toBe("git_control_path")
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

describe("SafetyPolicy unified protected paths", () => {
  // These entries come from AUTONOMOUS_BLOCKED_PATHS (constants/session.ts),
  // now the single source shared with blast-radius enforcement.
  test("denies infrastructure surfaces inherited from the blast-radius list", () => {
    for (const path of ["infra/main.tf", "terraform/prod/vpc.tf", ".github/workflows/deploy.yml"]) {
      const decision = SafetyPolicy.decide({
        mode: "autonomous",
        permission: "edit",
        path,
      })
      expect(decision.action).toBe("deny")
      expect(decision.reason).toBe("protected_path")
    }
  })

  test("still denies directory-form patterns kept as local additions", () => {
    for (const path of ["secrets", "nested/secrets"]) {
      const decision = SafetyPolicy.decide({
        mode: "autonomous",
        permission: "edit",
        path,
      })
      expect(decision.action).toBe("deny")
      expect(decision.reason).toBe("protected_path")
    }
  })
})
