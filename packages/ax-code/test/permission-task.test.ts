import { afterEach, beforeEach, describe, test, expect, vi } from "vitest"
import { Permission } from "../src/permission"
import { Config } from "../src/config/config"
import { Instance } from "../src/project/instance"
import { Agent } from "../src/agent/agent"
import { Session } from "../src/session"
import { SessionPrompt } from "../src/session/prompt"
import { MessageV2 } from "../src/session/message-v2"
import { MessageID } from "../src/session/schema"
import { TaskTool } from "../src/tool/task"
import { tmpdir } from "./fixture/fixture"

afterEach(async () => {
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

describe("Permission.evaluate for permission.task", () => {
  const createRuleset = (rules: Record<string, "allow" | "deny" | "ask">): Permission.Ruleset =>
    Object.entries(rules).map(([pattern, action]) => ({
      permission: "task",
      pattern,
      action,
    }))

  test("returns ask when no match (default)", () => {
    expect(Permission.evaluate("task", "code-reviewer", []).action).toBe("ask")
  })

  test("returns deny for explicit deny", () => {
    const ruleset = createRuleset({ "code-reviewer": "deny" })
    expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
  })

  test("returns allow for explicit allow", () => {
    const ruleset = createRuleset({ "code-reviewer": "allow" })
    expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("allow")
  })

  test("returns ask for explicit ask", () => {
    const ruleset = createRuleset({ "code-reviewer": "ask" })
    expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("ask")
  })

  test("matches wildcard patterns with deny", () => {
    const ruleset = createRuleset({ "orchestrator-*": "deny" })
    expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("deny")
    expect(Permission.evaluate("task", "orchestrator-slow", ruleset).action).toBe("deny")
    expect(Permission.evaluate("task", "general", ruleset).action).toBe("ask")
  })

  test("matches wildcard patterns with allow", () => {
    const ruleset = createRuleset({ "orchestrator-*": "allow" })
    expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("allow")
    expect(Permission.evaluate("task", "orchestrator-slow", ruleset).action).toBe("allow")
  })

  test("matches wildcard patterns with ask", () => {
    const ruleset = createRuleset({ "orchestrator-*": "ask" })
    expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("ask")
    const globalRuleset = createRuleset({ "*": "ask" })
    expect(Permission.evaluate("task", "code-reviewer", globalRuleset).action).toBe("ask")
  })

  test("later rules take precedence (last match wins)", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "deny",
      "orchestrator-fast": "allow",
    })
    expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("allow")
    expect(Permission.evaluate("task", "orchestrator-slow", ruleset).action).toBe("deny")
  })

  test("matches global wildcard", () => {
    expect(Permission.evaluate("task", "any-agent", createRuleset({ "*": "allow" })).action).toBe("allow")
    expect(Permission.evaluate("task", "any-agent", createRuleset({ "*": "deny" })).action).toBe("deny")
    expect(Permission.evaluate("task", "any-agent", createRuleset({ "*": "ask" })).action).toBe("ask")
  })
})

describe("Permission.disabled for task tool", () => {
  // Note: The `disabled` function checks if a TOOL should be completely removed from the tool list.
  // It only disables a tool when there's a rule with `pattern: "*"` and `action: "deny"`.
  // It does NOT evaluate complex subagent patterns - those are handled at runtime by `evaluate`.
  const createRuleset = (rules: Record<string, "allow" | "deny" | "ask">): Permission.Ruleset =>
    Object.entries(rules).map(([pattern, action]) => ({
      permission: "task",
      pattern,
      action,
    }))

  test("task tool is disabled when global deny pattern exists (even with specific allows)", () => {
    // When "*": "deny" exists, the task tool is disabled because the disabled() function
    // only checks for wildcard deny patterns - it doesn't consider that specific subagents might be allowed
    const ruleset = createRuleset({
      "orchestrator-*": "allow",
      "*": "deny",
    })
    const disabled = Permission.disabled(["task", "bash", "read"], ruleset)
    // The task tool IS disabled because there's a pattern: "*" with action: "deny"
    expect(disabled.has("task")).toBe(true)
  })

  test("task tool is disabled when global deny pattern exists (even with ask overrides)", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "ask",
      "*": "deny",
    })
    const disabled = Permission.disabled(["task"], ruleset)
    // The task tool IS disabled because there's a pattern: "*" with action: "deny"
    expect(disabled.has("task")).toBe(true)
  })

  test("task tool is disabled when global deny pattern exists", () => {
    const ruleset = createRuleset({ "*": "deny" })
    const disabled = Permission.disabled(["task"], ruleset)
    expect(disabled.has("task")).toBe(true)
  })

  test("task tool is NOT disabled when only specific patterns are denied (no wildcard)", () => {
    // The disabled() function only disables tools when pattern: "*" && action: "deny"
    // Specific subagent denies don't disable the task tool - those are handled at runtime
    const ruleset = createRuleset({
      "orchestrator-*": "deny",
      general: "deny",
    })
    const disabled = Permission.disabled(["task"], ruleset)
    // The task tool is NOT disabled because no rule has pattern: "*" with action: "deny"
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool is enabled when no task rules exist (default ask)", () => {
    const disabled = Permission.disabled(["task"], [])
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool is NOT disabled when last wildcard pattern is allow", () => {
    // Last matching rule wins - if wildcard allow comes after wildcard deny, tool is enabled
    const ruleset = createRuleset({
      "*": "deny",
      "orchestrator-coder": "allow",
    })
    const disabled = Permission.disabled(["task"], ruleset)
    // The disabled() function uses findLast and checks if the last matching rule
    // has pattern: "*" and action: "deny". In this case, the last rule matching
    // "task" permission has pattern "orchestrator-coder", not "*", so not disabled
    expect(disabled.has("task")).toBe(false)
  })
})

// Integration tests that load permissions from real config files
describe("permission.task with real config files", () => {
  beforeEach(() => vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1"))

  test("loads task permissions from ax-code.json config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            "*": "allow",
            "code-reviewer": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = Permission.fromConfig(config.permission ?? {})
        // general and orchestrator-fast should be allowed, code-reviewer denied
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("allow")
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
      },
    })
  })

  test("loads task permissions with wildcard patterns from config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            "*": "ask",
            "orchestrator-*": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = Permission.fromConfig(config.permission ?? {})
        // general and code-reviewer should be ask, orchestrator-* denied
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("ask")
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("ask")
        expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("deny")
      },
    })
  })

  test("evaluate respects task permission from config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            general: "allow",
            "code-reviewer": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = Permission.fromConfig(config.permission ?? {})
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
        // Unspecified agents default to "ask"
        expect(Permission.evaluate("task", "unknown-agent", ruleset).action).toBe("ask")
      },
    })
  })

  test("mixed permission config with task and other tools", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          bash: "allow",
          edit: "ask",
          task: {
            "*": "deny",
            general: "allow",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = Permission.fromConfig(config.permission ?? {})

        // Verify task permissions
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")

        // Verify other tool permissions
        expect(Permission.evaluate("bash", "*", ruleset).action).toBe("allow")
        expect(Permission.evaluate("edit", "*", ruleset).action).toBe("ask")

        // Verify disabled tools
        const disabled = Permission.disabled(["bash", "edit", "task"], ruleset)
        expect(disabled.has("bash")).toBe(false)
        expect(disabled.has("edit")).toBe(false)
        // task is NOT disabled because disabled() uses findLast, and the last rule
        // matching "task" permission is {pattern: "general", action: "allow"}, not pattern: "*"
        expect(disabled.has("task")).toBe(false)
      },
    })
  })

  test("task tool disabled when global deny comes last in config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            general: "allow",
            "code-reviewer": "allow",
            "*": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = Permission.fromConfig(config.permission ?? {})

        // Last matching rule wins - "*" deny is last, so all agents are denied
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("deny")
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
        expect(Permission.evaluate("task", "unknown", ruleset).action).toBe("deny")

        // Since "*": "deny" is the last rule, disabled() finds it with findLast
        // and sees pattern: "*" with action: "deny", so task is disabled
        const disabled = Permission.disabled(["task"], ruleset)
        expect(disabled.has("task")).toBe(true)
      },
    })
  })

  test("task tool NOT disabled when specific allow comes last in config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            "*": "deny",
            general: "allow",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = Permission.fromConfig(config.permission ?? {})

        // Evaluate uses findLast - "general" allow comes after "*" deny
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("allow")
        // Other agents still denied by the earlier "*" deny
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")

        // disabled() uses findLast and checks if the last rule has pattern: "*" with action: "deny"
        // In this case, the last rule is {pattern: "general", action: "allow"}, not pattern: "*"
        // So the task tool is NOT disabled (even though most subagents are denied)
        const disabled = Permission.disabled(["task"], ruleset)
        expect(disabled.has("task")).toBe(false)
      },
    })
  })
})

// SPEC-2026-08-20-agent-backend-parity Phase 0 (R2) / ADR-057 D2: the fan-out
// gate in src/tool/task.ts requires an EXPLICIT allow for the `task`
// permission. The LAST rule naming `task` decides, regardless of pattern —
// this keeps the gate consistent with Permission.evaluate's last-match
// semantics, so a scoped allow like `task: { general: "allow" }` counts,
// wildcard `*` rules are just rules like any other, and no task rule at all
// means deny-by-default (every agent inherits a `*: allow` default that must
// not enable fan-out on its own).
describe("task tool fan-out gate (canFanOut)", () => {
  // Trust the project config so agent permission grants in ax-code.json apply.
  beforeEach(() => vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1"))

  // Mirrors the gate in src/tool/task.ts.
  const gate = (ruleset: Permission.Ruleset) =>
    ruleset.filter((rule) => rule.permission === "task").findLast(() => true)?.action === "allow"

  async function setupParent(tmp: { path: string }) {
    const parent = await Session.create({})
    const user = await Session.updateMessage({
      id: MessageID.ascending(),
      sessionID: parent.id,
      role: "user",
      time: { created: Date.now() },
      agent: "build",
      model: { providerID: "test" as any, modelID: "test-model" as any },
      tools: {},
      mode: "build",
    } as any)
    const assistant = await Session.updateMessage({
      id: MessageID.ascending(),
      parentID: user.id,
      sessionID: parent.id,
      role: "assistant",
      mode: "build",
      agent: "build",
      path: { cwd: tmp.path, root: tmp.path },
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: "test-model",
      providerID: "test",
      time: { created: Date.now() },
    } as MessageV2.Assistant)
    return { parent, assistant: assistant as MessageV2.Assistant }
  }

  function mockPromptText(text: string) {
    return vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => ({
      info: {
        id: input.messageID,
        sessionID: input.sessionID,
        role: "assistant",
        time: { created: Date.now(), completed: Date.now() },
      },
      parts: [{ type: "text", text }],
    })) as any)
  }

  async function executeTask(parent: Session.Info, assistant: MessageV2.Assistant, subagentType: string) {
    return (await TaskTool.init()).execute(
      {
        description: "nested task",
        prompt: "do work",
        subagent_type: subagentType,
      },
      {
        sessionID: parent.id,
        messageID: assistant.id,
        callID: "",
        agent: "build",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => {},
        ask: async () => {},
        extra: {},
      } as any,
    )
  }

  test("built-in general/explore/scout cannot fan out (denySubagentFanout)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const name of ["general", "explore", "scout"]) {
          const agent = await Agent.get(name)
          expect(agent, `agent ${name} should exist`).toBeDefined()
          // Their task rules deny fan-out (ADR-005).
          expect(
            Permission.evaluate(
              "task",
              "*",
              agent.permission.filter((r) => r.permission === "task"),
            ).action,
          ).toBe("deny")
          expect(gate(agent.permission)).toBe(false)
        }

        // Execute-level: a spawned general session still gets `task` denied
        // and the task tool hidden.
        const { parent, assistant } = await setupParent(tmp)
        const promptSpy = mockPromptText("done")
        try {
          const result = await executeTask(parent, assistant, "general")
          expect(result.metadata.subagentError).toBe(false)

          const children = await Session.children(parent.id)
          expect(children).toHaveLength(1)
          expect(children[0].permission).toEqual(
            expect.arrayContaining([{ permission: "task", pattern: "*", action: "deny" }]),
          )
          const tools = (promptSpy.mock.calls[0]?.[0] as any).tools
          expect(tools.task).toBe(false)
          // No fan-out means no background tasks to wait on — waitfor hidden too.
          expect(tools.waitfor).toBe(false)
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })

  test("custom agent with NO task rule cannot fan out (deny-by-default, ADR-005)", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          plain: { description: "Plain agent", mode: "subagent" },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("plain")
        expect(agent).toBeDefined()
        // Sanity: the FULL ruleset resolves allow via the inherited
        // `*: allow` default — this is exactly why the gate must filter to
        // rules naming `task` instead of evaluating the whole ruleset.
        expect(Permission.evaluate("task", "*", agent.permission).action).toBe("allow")
        // The gate itself: no explicit task rule => no fan-out.
        expect(gate(agent.permission)).toBe(false)

        const { parent, assistant } = await setupParent(tmp)
        const promptSpy = mockPromptText("done")
        try {
          const result = await executeTask(parent, assistant, "plain")
          expect(result.metadata.subagentError).toBe(false)

          const children = await Session.children(parent.id)
          expect(children).toHaveLength(1)
          expect(children[0].permission).toEqual(
            expect.arrayContaining([{ permission: "task", pattern: "*", action: "deny" }]),
          )
          const tools = (promptSpy.mock.calls[0]?.[0] as any).tools
          expect(tools.task).toBe(false)
          expect(tools.waitfor).toBe(false)
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })

  test("custom agent with an explicit task allow can fan out (no deny injected)", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          orchestrator: {
            description: "Fan-out agent",
            mode: "subagent",
            permission: { task: "allow" },
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("orchestrator")
        expect(agent).toBeDefined()
        expect(gate(agent.permission)).toBe(true)

        const { parent, assistant } = await setupParent(tmp)
        const promptSpy = mockPromptText("done")
        try {
          const result = await executeTask(parent, assistant, "orchestrator")
          expect(result.metadata.subagentError).toBe(false)

          const children = await Session.children(parent.id)
          expect(children).toHaveLength(1)
          // No session-level task deny is injected...
          expect(
            children[0].permission?.some(
              (rule) => rule.permission === "task" && rule.pattern === "*" && rule.action === "deny",
            ),
          ).toBe(false)
          // ...and the task tool stays visible to the subagent.
          const tools = (promptSpy.mock.calls[0]?.[0] as any).tools
          expect(tools.task).not.toBe(false)
          expect(tools.waitfor).not.toBe(false)
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })

  test("scoped allow task: { general: 'allow' } enables fan-out (no blanket deny injected)", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          scoped_orchestrator: {
            description: "Scoped fan-out agent",
            mode: "subagent",
            permission: { task: { general: "allow" } },
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("scoped_orchestrator")
        expect(agent).toBeDefined()
        // The gate must treat the pattern-scoped allow as an explicit allow —
        // evaluating `task` against "*" would miss the `general` pattern and
        // nullify the grant with an injected blanket deny.
        expect(gate(agent.permission)).toBe(true)

        const { parent, assistant } = await setupParent(tmp)
        const promptSpy = mockPromptText("done")
        try {
          const result = await executeTask(parent, assistant, "scoped_orchestrator")
          expect(result.metadata.subagentError).toBe(false)

          const children = await Session.children(parent.id)
          expect(children).toHaveLength(1)
          expect(
            children[0].permission?.some(
              (rule) => rule.permission === "task" && rule.pattern === "*" && rule.action === "deny",
            ),
          ).toBe(false)
          const tools = (promptSpy.mock.calls[0]?.[0] as any).tools
          expect(tools.task).not.toBe(false)
          expect(tools.waitfor).not.toBe(false)
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })
})
