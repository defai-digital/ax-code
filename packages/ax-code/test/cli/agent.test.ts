import { describe, expect, test } from "vitest"
import { buildAgentCreateFrontmatter, buildAgentCreatePermission } from "../../src/cli/cmd/agent"
import { Permission } from "../../src/permission"

describe("agent command helpers", () => {
  test("buildAgentCreatePermission omits permission when every tool is selected", () => {
    expect(
      buildAgentCreatePermission([
        "bash",
        "read",
        "write",
        "edit",
        "list",
        "glob",
        "grep",
        "webfetch",
        "task",
        "todowrite",
        "todoread",
      ]),
    ).toBeUndefined()
  })

  test("buildAgentCreatePermission writes allow and deny rules for partial selections", () => {
    const permission = buildAgentCreatePermission(["read", "grep"])

    expect(permission).toMatchObject({
      read: "allow",
      grep: "allow",
      bash: "deny",
      edit: "deny",
    })
  })

  test("buildAgentCreateFrontmatter emits permission and never deprecated tools", () => {
    const frontmatter = buildAgentCreateFrontmatter({
      description: "Use for focused review.",
      mode: "subagent",
      selectedTools: ["read"],
    })

    expect(frontmatter).toMatchObject({
      description: "Use for focused review.",
      mode: "subagent",
      permission: {
        read: "allow",
        bash: "deny",
      },
    })
    expect(frontmatter).not.toHaveProperty("tools")
  })
})

describe("agent create permission enforcement", () => {
  test("selecting write lets the agent's write tool through", () => {
    const permission = buildAgentCreatePermission(["read", "write"])!
    const ruleset = Permission.fromConfig(permission)
    // The write tool asks for the `edit` permission.
    expect(Permission.evaluate("edit", "src/a.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "ls", ruleset).action).toBe("deny")
  })

  test("leaving out both write and edit still denies edits", () => {
    const ruleset = Permission.fromConfig(buildAgentCreatePermission(["read"])!)
    expect(Permission.evaluate("edit", "src/a.ts", ruleset).action).toBe("deny")
  })
})
