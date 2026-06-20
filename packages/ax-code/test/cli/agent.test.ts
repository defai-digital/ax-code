import { describe, expect, test } from "vitest"
import { buildAgentCreateFrontmatter, buildAgentCreatePermission } from "../../src/cli/cmd/agent"

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
