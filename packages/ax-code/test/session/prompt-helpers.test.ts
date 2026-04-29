import { describe, expect, test } from "bun:test"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import {
  agentInfo,
  commandArgs,
  commandParts,
  commandTemplate,
  commandTemplateText,
  commandUser,
  loopMessages,
  modelInfo,
  remindQueuedMessages,
  scanLoopMessages,
  shellArgs,
  shellKey,
  systemPrompt,
} from "../../src/session/prompt-helpers"

describe("session.prompt helpers", () => {
  test("splits quoted and image arguments", () => {
    expect(commandArgs(`alpha "two words" 'three words' [Image 2] tail`)).toEqual([
      "alpha",
      "two words",
      "three words",
      "[Image 2]",
      "tail",
    ])
  })

  test("fills numbered placeholders", () => {
    expect(commandTemplate("open $1 with $2", `file.ts "line 20"`)).toBe("open file.ts with line 20")
  })

  test("lets the final placeholder absorb extra args", () => {
    expect(commandTemplate("review $1: $2", `src/app.ts missing null guard near submit handler`)).toBe(
      "review src/app.ts: missing null guard near submit handler",
    )
  })

  test("replaces arguments placeholder verbatim", () => {
    expect(commandTemplate("run this:\n$ARGUMENTS", `echo "hello world"`)).toBe('run this:\necho "hello world"')
  })

  test("uses remaining args for $ARGUMENTS when numbered placeholders are also present", () => {
    expect(commandTemplate("$1 $ARGUMENTS", "foo bar baz")).toBe("foo bar baz")
    expect(commandTemplate("compare $1 with $ARGUMENTS", 'left "right side" extra')).toBe(
      "compare left with right side extra",
    )
  })

  test("appends args when template has no placeholders", () => {
    expect(commandTemplate("summarize this change", "focus on tests")).toBe("summarize this change\n\nfocus on tests")
  })

  test("drops missing numbered args", () => {
    expect(commandTemplate("compare $1 and $2", "left")).toBe("compare left and ")
  })

  test("normalizes shell binary names by platform", () => {
    expect(shellKey("/bin/zsh", "darwin")).toBe("zsh")
    expect(shellKey("C:\\Program Files\\PowerShell\\7\\pwsh.exe", "win32")).toBe("pwsh")
  })

  test("builds shell invocation args by shell family", () => {
    expect(shellArgs("/bin/fish", "echo hi", "darwin")).toEqual(["-c", "echo hi"])
    expect(shellArgs("/bin/bash", "echo hi", "darwin")[0]).toBe("-c")
    expect(shellArgs("C:\\Windows\\System32\\cmd.exe", "dir", "win32")).toEqual(["/c", "dir"])
    expect(shellArgs("C:\\Program Files\\PowerShell\\7\\pwsh.exe", "Get-ChildItem", "win32")).toEqual([
      "-NoProfile",
      "-Command",
      "Get-ChildItem",
    ])
  })

  test("expands shell-backed template blocks", async () => {
    expect(
      await commandTemplateText({
        template: "status:\n!`echo ready`",
        arguments: "",
        run: async (cmd) => `${cmd}:ok`,
      }),
    ).toBe("status:\necho ready:ok")
  })

  test("selects user agent and model for subtask commands", async () => {
    expect(
      await commandUser({
        subtask: true,
        agentName: "reviewer",
        inputAgent: undefined,
        inputModel: "openai/gpt-5.2",
        taskModel: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") },
        sessionID: "s" as any,
        defaultAgent: async () => "default",
        parseModel: () => ({ providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") }),
        last: async () => ({ providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.1") }),
      }),
    ).toEqual({
      agent: "default",
      model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") },
    })
  })

  test("builds inline command parts when subtask mode is off", async () => {
    const result = await commandParts({
      agent: { name: "build", mode: "primary" },
      command: { description: "desc" },
      name: "review",
      model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") },
      template: "review this change",
      parts: [{ type: "file", filename: "a.ts" }],
    })

    expect(result.subtask).toBe(false)
    expect(result.parts[0]).toMatchObject({ type: "text", text: "review this change" })
    expect(result.parts[1]).toMatchObject({ type: "file", filename: "a.ts" })
  })

  test("builds subtask command parts when agent runs as subagent", async () => {
    const result = await commandParts({
      agent: { name: "reviewer", mode: "subagent" },
      command: { description: "Review the diff" },
      name: "review",
      model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") },
      template: "look at src/app.ts",
    })

    expect(result.subtask).toBe(true)
    expect(result.parts).toEqual([
      {
        type: "subtask",
        agent: "reviewer",
        description: "Review the diff",
        command: "review",
        model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") },
        prompt: "look at src/app.ts",
      },
    ])
  })

  test("falls back to inline command parts when subtask input includes non-text parts", async () => {
    const result = await commandParts({
      agent: { name: "reviewer", mode: "subagent" },
      command: { description: "Review the diff" },
      name: "review",
      model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") },
      template: "look at src/app.ts",
      parts: [{ type: "file", filename: "a.ts" }],
    })

    expect(result.subtask).toBe(false)
    expect(result.parts[0]).toMatchObject({ type: "text", text: "look at src/app.ts" })
    expect(result.parts[1]).toMatchObject({ type: "file", filename: "a.ts" })
  })

  test("scans loop messages for the current turn and pending tasks", () => {
    const msgs = [
      {
        info: { id: "001", role: "user" },
        parts: [{ type: "text", text: "old" }],
      },
      {
        info: { id: "002", role: "assistant", finish: "stop" },
        parts: [],
      },
      {
        info: { id: "003", role: "assistant" },
        parts: [{ type: "subtask", prompt: "fix", description: "Fix", agent: "build" }],
      },
      {
        info: { id: "004", role: "user" },
        parts: [{ type: "agent", name: "reviewer" }],
      },
    ] as any as MessageV2.WithParts[]

    const result = scanLoopMessages(msgs)

    expect(String(result.lastUser?.id)).toBe("004")
    expect(String(result.lastAssistant?.id)).toBe("003")
    expect(String(result.lastFinished?.id)).toBe("002")
    expect(result.lastUserParts as any).toEqual(msgs[3].parts)
    expect(result.tasks as any).toEqual(msgs[2].parts)
  })

  test("wraps queued user text with a system reminder", () => {
    const msgs = [
      {
        info: { id: "001", role: "assistant", finish: "stop" },
        parts: [],
      },
      {
        info: { id: "002", role: "user" },
        parts: [
          { type: "text", text: "Ship it" },
          { type: "text", text: " ", ignored: true },
        ],
      },
      {
        info: { id: "003", role: "user" },
        parts: [{ type: "text", text: "ignored", synthetic: true }],
      },
    ] as any as MessageV2.WithParts[]

    const next = remindQueuedMessages(msgs, msgs[0].info as MessageV2.Assistant)

    expect((next[1].parts[0] as MessageV2.TextPart).text).toContain("The user sent the following message:")
    expect((next[1].parts[0] as MessageV2.TextPart).text).toContain("Ship it")
    expect((next[2].parts[0] as MessageV2.TextPart).text).toBe("ignored")
    expect((msgs[1].parts[0] as MessageV2.TextPart).text).toBe("Ship it")
  })

  test("does not mutate the original text part object when wrapping reminders", () => {
    const part = { type: "text", text: "Ship it" } as any
    const msgs = [
      {
        info: { id: "001", role: "assistant", finish: "stop" },
        parts: [],
      },
      {
        info: { id: "002", role: "user" },
        parts: [part],
      },
    ] as any as MessageV2.WithParts[]

    const next = remindQueuedMessages(msgs, msgs[0].info as MessageV2.Assistant)

    expect(part.text).toBe("Ship it")
    expect((next[1].parts[0] as MessageV2.TextPart).text).toContain("The user sent the following message:")
  })

  test("loads compacted history on first loop pass and appends newer messages", async () => {
    const first = [{ info: { id: "001", role: "user" }, parts: [] }] as any as MessageV2.WithParts[]
    const second = [{ info: { id: "002", role: "assistant" }, parts: [] }] as any as MessageV2.WithParts[]

    const loaded = await loopMessages({
      sessionID: "ses_test" as any,
      filterCompacted: async () => first,
      after: async () => second,
    })
    expect(loaded.cached).toBe(first)
    expect(loaded.msgs).toEqual(first)
    expect(loaded.msgs).not.toBe(first)

    const next = await loopMessages({
      sessionID: "ses_test" as any,
      cached: loaded.cached,
      filterCompacted: async () => [],
      after: async () => second,
    })
    expect(next.msgs.map((item) => String(item.info.id))).toEqual(["001", "002"])
  })

  test("builds and caches the system prompt by model", async () => {
    const cache = {}
    const first = await systemPrompt({
      agent: { name: "build" } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "json_schema" },
      cache,
      skills: async () => "skills",
      environment: async () => ["env"],
      instructions: async () => ["rules"],
      memory: async () => undefined,
      structuredPrompt: "structured",
    })
    expect(first).toEqual(["env", "skills", "rules", "structured"])

    const second = await systemPrompt({
      agent: { name: "build" } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "text" },
      cache,
      skills: async () => undefined,
      environment: async () => ["other"],
      instructions: async () => ["ignored"],
      memory: async () => undefined,
      structuredPrompt: "structured",
    })
    expect(second).toEqual(["env", "rules"])
  })

  test("includes project memory and decision hints between environment and skills when present", async () => {
    const cache = {}
    const result = await systemPrompt({
      agent: { name: "build" } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "text" },
      cache,
      skills: async () => "skills",
      environment: async () => ["env"],
      instructions: async () => ["rules"],
      memory: async () => "<project-memory>...</project-memory>",
      decisionHints: async () => "<decision-hints>...</decision-hints>",
    })
    expect(result).toEqual([
      "env",
      "<project-memory>...</project-memory>",
      "<decision-hints>...</decision-hints>",
      "skills",
      "rules",
    ])
  })

  test("skills cache survives non-file-tool messages and re-runs on a new file-tool call", async () => {
    // The skills section only changes when a new file-tool call enters the
    // conversation. Previously the cache keyed on raw msgCount and re-ran
    // skillsFn (which walks the full message history) on every loop step.
    const cache = {}
    let calls = 0
    const skillsFn = async () => {
      calls++
      return `skills-${calls}`
    }

    const env = async () => ["env"]
    const instr = async () => ["rules"]
    const memory = async () => undefined

    const userMsg = (id: string) =>
      ({
        info: { id, sessionID: "s1", role: "user" as const },
        parts: [{ type: "text" as const, text: "hi" }],
      }) as any

    const fileToolMsg = (id: string) =>
      ({
        info: { id, sessionID: "s1", role: "assistant" as const },
        parts: [
          {
            type: "tool" as const,
            callID: `c-${id}`,
            tool: "read",
            state: {
              status: "completed" as const,
              input: { filePath: "/tmp/x.ts" },
              output: "",
              title: "Read",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        ],
      }) as any

    const bashToolMsg = (id: string) =>
      ({
        info: { id, sessionID: "s1", role: "assistant" as const },
        parts: [
          {
            type: "tool" as const,
            callID: `c-${id}`,
            tool: "bash",
            state: {
              status: "completed" as const,
              input: { command: "ls" },
              output: "",
              title: "Run bash",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        ],
      }) as any

    const args = (messages: any[]) => ({
      agent: { name: "build" } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "text" } as { type: string },
      cache,
      skills: skillsFn,
      environment: env,
      instructions: instr,
      memory,
      messages,
    })

    // Step 1: first call → recompute (cache empty)
    await systemPrompt(args([userMsg("m1")]))
    expect(calls).toBe(1)

    // Step 2: new user + non-file tool message → cache hit (no file-tool call added)
    await systemPrompt(args([userMsg("m1"), userMsg("m2"), bashToolMsg("m3")]))
    expect(calls).toBe(1)

    // Step 3: new file-tool message → cache miss, recompute
    await systemPrompt(args([userMsg("m1"), userMsg("m2"), bashToolMsg("m3"), fileToolMsg("m4")]))
    expect(calls).toBe(2)

    // Step 4: another non-file message → cache hit again
    await systemPrompt(args([userMsg("m1"), userMsg("m2"), bashToolMsg("m3"), fileToolMsg("m4"), userMsg("m5")]))
    expect(calls).toBe(2)
  })

  test("skills cache invalidates when message history is truncated (compaction)", async () => {
    const cache = {}
    let calls = 0
    const skillsFn = async () => {
      calls++
      return `skills-${calls}`
    }
    const args = (messages: any[]) => ({
      agent: { name: "build" } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "text" } as { type: string },
      cache,
      skills: skillsFn,
      environment: async () => ["env"],
      instructions: async () => ["rules"],
      memory: async () => undefined,
      messages,
    })

    const msg = (id: string) =>
      ({
        info: { id, sessionID: "s1", role: "user" as const },
        parts: [{ type: "text" as const, text: "hi" }],
      }) as any

    await systemPrompt(args([msg("m1"), msg("m2"), msg("m3")]))
    expect(calls).toBe(1)

    // Compaction replaces the prefix — the previous skillsLastMsgID ("m3") is
    // no longer in the message list. Must recompute to avoid stale state.
    await systemPrompt(args([msg("m4"), msg("m5")]))
    expect(calls).toBe(2)
  })

  test("memory is loaded fresh on every call (no staleness when user records mid-session)", async () => {
    const cache = {}
    let memoryContent = "v1"
    const memoryFn = async () => `memory-${memoryContent}`
    const env = async () => ["env"]
    const instr = async () => ["rules"]

    const first = await systemPrompt({
      agent: { name: "build" } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "text" },
      cache,
      skills: async () => undefined,
      environment: env,
      instructions: instr,
      memory: memoryFn,
    })
    expect(first).toContain("memory-v1")

    // Simulate user running `ax-code memory remember` between prompt loops.
    memoryContent = "v2"

    const second = await systemPrompt({
      agent: { name: "build" } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "text" },
      cache,
      skills: async () => undefined,
      environment: env,
      instructions: instr,
      memory: memoryFn,
    })
    expect(second).toContain("memory-v2")
    expect(second).not.toContain("memory-v1")
  })

  test("passes messages into memory loader for path-scoped context", async () => {
    const cache = {}
    let received: MessageV2.WithParts[] | undefined
    const messages = [
      {
        info: { id: "m1", sessionID: "s1", role: "assistant" as const },
        parts: [
          {
            type: "tool" as const,
            callID: "c1",
            tool: "read",
            state: {
              status: "completed" as const,
              input: { filePath: "/repo/src/memory/recall.ts" },
              output: "",
              title: "Read file",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        ],
      },
    ] as any as MessageV2.WithParts[]

    const result = await systemPrompt({
      agent: { name: "build" } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "text" },
      cache,
      skills: async () => undefined,
      environment: async () => ["env"],
      instructions: async () => ["rules"],
      memory: async (_agent, nextMessages) => {
        received = nextMessages
        return "memory"
      },
      messages,
    })

    expect(result).toContain("memory")
    expect(received).toBe(messages)
  })

  test("passes session id and messages into decision hint loader", async () => {
    const cache = {}
    let received: Parameters<NonNullable<Parameters<typeof systemPrompt>[0]["decisionHints"]>>[0] | undefined
    const messages = [
      {
        info: { id: "m1", sessionID: "s1", role: "user" as const },
        parts: [{ type: "text" as const, text: "hi" }],
      },
    ] as any as MessageV2.WithParts[]

    const result = await systemPrompt({
      agent: { name: "build" } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "text" },
      cache,
      skills: async () => undefined,
      environment: async () => ["env"],
      instructions: async () => ["rules"],
      memory: async () => undefined,
      decisionHints: async (input) => {
        received = input
        return "decision hints"
      },
      messages,
      sessionID: "s1" as any,
    })

    expect(result).toContain("decision hints")
    expect(received?.messages).toBe(messages)
    expect(String(received?.sessionID)).toBe("s1")
  })

  test("formats missing agent errors with available names", async () => {
    const err = await agentInfo({
      sessionID: "ses_test" as any,
      name: "missing",
      get: async () => undefined,
      list: async () => [{ name: "build" }, { name: "hidden", hidden: true }],
      report: () => {},
    }).then(
      () => undefined,
      (error) => error,
    )

    expect(err).toBeDefined()
    expect(String(err.data.message)).toContain('Agent not found: "missing"')
    expect(String(err.data.message)).toContain("build")
  })

  test("formats missing model errors with suggestions", async () => {
    const err = await modelInfo({
      sessionID: "ses_test" as any,
      providerID: ProviderID.make("openai"),
      modelID: ModelID.make("bad-model"),
      get: async () => {
        throw new Provider.ModelNotFoundError({
          providerID: ProviderID.make("openai"),
          modelID: ModelID.make("bad-model"),
          suggestions: ["gpt-5.2"],
        })
      },
      report: () => {},
    }).then(
      () => undefined,
      (error) => error,
    )

    expect(err).toBeDefined()
    expect(Provider.ModelNotFoundError.isInstance(err)).toBe(true)
  })
})
