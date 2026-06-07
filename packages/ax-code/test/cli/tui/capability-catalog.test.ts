import { describe, expect, test } from "bun:test"
import { capabilityCatalogDescription, capabilityCatalogOptions } from "../../../src/cli/cmd/tui/routes/session/capability-catalog"

describe("tui capability catalog", () => {
  test("groups catalog entries and exposes safety metadata", () => {
    const options = capabilityCatalogOptions([
      {
        kind: "workflow",
        name: "release",
        description: "Release flow",
        sourceTool: "ax-code",
        scope: "project",
        metadata: {
          requiresWorkflowRuntime: true,
          trust: "trusted",
          permissionImpact: { write: true },
        },
      },
      {
        kind: "skill",
        name: "release-check",
        description: "Review release readiness.",
        sourceTool: "opencode",
        scope: "project",
        warnings: [{ code: "duplicate", message: "Duplicate name", severity: "warn" }],
        metadata: {
          recommended: true,
          permissionImpact: "instructions_only",
        },
      },
      {
        kind: "agent",
        name: "build",
        metadata: {
          permissionImpact: { allow: 1, ask: 2, deny: 0 },
        },
      },
      {
        kind: "instruction",
        name: "AGENTS.md",
        sourceTool: "ax-code",
        scope: "project",
        metadata: {
          recommended: true,
          permissionImpact: "instructions_only",
        },
      },
    ])

    expect(options.map((option) => `${option.category}:${option.value}`)).toEqual([
      "Instructions:instruction:AGENTS.md",
      "Skills:skill:release-check",
      "Agents:agent:build",
      "Workflows:workflow:release",
    ])
    expect(options.find((option) => option.value === "skill:release-check")?.description).toContain("recommended")
    expect(options.find((option) => option.value === "skill:release-check")?.description).toContain("1 warning")
    expect(options.find((option) => option.value === "agent:build")?.description).toContain(
      "permission allow:1 ask:2 deny:0",
    )
    expect(options.find((option) => option.value === "workflow:release")?.description).toContain("runtime gated")
    expect(options.find((option) => option.value === "workflow:release")?.description).toContain("trust trusted")
  })

  test("formats string permission impacts for scanning", () => {
    expect(
      capabilityCatalogDescription({
        kind: "command",
        name: "check",
        metadata: {
          permissionImpact: "default_agent_permissions",
        },
      }),
    ).toBe("permission default agent permissions")
  })
})
