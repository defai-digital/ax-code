import { describe, expect, test } from "bun:test"
import { Permission } from "../../src/permission"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import {
  agentInfo,
  appendShellOutputChunk,
  assistantLoopExitDecision,
  assistantRespondedAfterUser,
  attachmentLineRange,
  commandModel,
  commandParts,
  commandTemplateText,
  consecutiveErrorDecision,
  commandUser,
  loopMessages,
  modelInfo,
  pendingCompactionDecision,
  parseGoalArguments,
  chooseFallbackModel,
  providerFallbackLookupDecision,
  providerFallbackSwitchState,
  processorLoopDecision,
  readToolCallText,
  remindQueuedMessages,
  scanLoopMessages,
  sessionAssistantPath,
  shellArgs,
  shellOutputMetadata,
  shouldScheduleUsageCompaction,
  syntheticTextPart,
  systemPrompt,
  textPart,
  titleContextMessages,
  zeroTokenUsage,
} from "../../src/session/prompt-helpers"

describe("session.prompt helpers", () => {
  test("bounds large first-turn title context", () => {
    const result = titleContextMessages([
      {
        info: { id: "user-1", role: "user" },
        parts: [{ type: "text", text: "x".repeat(20_000) }],
      } as any,
    ])

    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("[Title context truncated]")
    expect(String(result[0].content).length).toBeLessThan(13_000)
  })

  test("summarizes file parts for title context", () => {
    const result = titleContextMessages([
      {
        info: { id: "user-1", role: "user" },
        parts: [
          { type: "text", text: "x".repeat(20_000) },
          {
            type: "file",
            mime: "image/png",
            filename: "screenshot.png",
            url: "data:image/png;base64,AA==",
          },
        ],
      } as any,
    ])

    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("[Attached image/png: screenshot.png]")
    expect(result[0].content).toContain("[Title context truncated]")
  })

  test("builds synthetic text parts with generated ids", () => {
    const part = syntheticTextPart({
      messageID: "msg_test" as any,
      sessionID: "ses_test" as any,
      text: "remember the plan",
    })

    expect(part).toMatchObject({
      messageID: "msg_test",
      sessionID: "ses_test",
      type: "text",
      text: "remember the plan",
      synthetic: true,
    })
    expect(part.id).toStartWith("prt_")
  })

  test("builds text parts with optional synthetic and time metadata", () => {
    const part = textPart({
      messageID: "msg_test" as any,
      sessionID: "ses_test" as any,
      text: "done",
      synthetic: true,
      time: { start: 1, end: 2 },
    })

    expect(part).toMatchObject({
      messageID: "msg_test",
      sessionID: "ses_test",
      type: "text",
      text: "done",
      synthetic: true,
      time: { start: 1, end: 2 },
    })
    expect(part.id).toStartWith("prt_")
  })

  test("formats Read tool call text through JSON serialization", () => {
    expect(readToolCallText({ filePath: '/tmp/has "quotes".txt', offset: 3, limit: undefined })).toBe(
      'Called the Read tool with the following input: {"filePath":"/tmp/has \\"quotes\\".txt","offset":3}',
    )
  })

  test("parses attachment line ranges from URL search parameters", () => {
    expect(attachmentLineRange({ start: null, end: null })).toBeUndefined()
    expect(attachmentLineRange({ start: "not-a-line", end: "0" })).toBeUndefined()
    expect(attachmentLineRange({ start: "-1", end: "0" })).toBeUndefined()
    expect(attachmentLineRange({ start: "5", end: "3" })).toEqual({ start: 5, end: undefined })
    expect(attachmentLineRange({ start: "5", end: "" })).toEqual({ start: 5, end: undefined })
    expect(attachmentLineRange({ start: "5", end: "7" })).toEqual({ start: 5, end: 7 })
  })

  test("parses goal control arguments", () => {
    expect(parseGoalArguments("")).toEqual({ action: "view" })
    expect(parseGoalArguments(" pause ")).toEqual({ action: "pause" })
    expect(parseGoalArguments("RESUME")).toEqual({ action: "resume" })
    expect(parseGoalArguments("clear")).toEqual({ action: "clear" })
  })

  test("parses goal creation arguments with optional token budgets", () => {
    expect(parseGoalArguments("ship the refactor")).toEqual({
      action: "create",
      objective: "ship the refactor",
    })
    expect(parseGoalArguments("--budget 123 keep working")).toEqual({
      action: "create",
      tokenBudget: 123,
      objective: "keep working",
    })
    expect(parseGoalArguments("--token-budget 456\nfinish the migration")).toEqual({
      action: "create",
      tokenBudget: 456,
      objective: "finish the migration",
    })
  })

  test("treats --budget N without an objective as a view action", () => {
    expect(parseGoalArguments("--budget 1000")).toEqual({ action: "view" })
    expect(parseGoalArguments("--token-budget 500")).toEqual({ action: "view" })
  })

  test("appends shell output chunks until the byte cap", () => {
    const state = appendShellOutputChunk({ output: "abc", outputBytes: 3, outputTruncated: false }, "def", 6)

    expect(state).toEqual({
      output: "abcdef",
      outputBytes: 6,
      outputTruncated: false,
    })
  })

  test("truncates shell output without splitting UTF-8 characters", () => {
    const state = appendShellOutputChunk({ output: "ab", outputBytes: 2, outputTruncated: false }, "éz", 4)

    expect(state).toEqual({
      output: "abé\n\n[output truncated at 10MB]",
      outputBytes: 4,
      outputTruncated: true,
    })

    expect(appendShellOutputChunk(state, "ignored", 10).output).toBe(state.output)
  })

  test("builds shell output metadata from output state", () => {
    expect(shellOutputMetadata({ output: "done", outputBytes: 4, outputTruncated: true })).toEqual({
      output: "done",
      description: "",
      outputTruncated: true,
    })
  })

  test("builds assistant path from explicit runtime boundaries", () => {
    expect(sessionAssistantPath({ directory: "/tmp/project", worktree: "/tmp" })).toEqual({
      cwd: "/tmp/project",
      root: "/tmp",
    })
  })

  test("builds zero token usage with optional total", () => {
    expect(zeroTokenUsage()).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    })
    expect(zeroTokenUsage({ total: 0 })).toEqual({
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    })
  })

  test("splits quoted and image arguments", async () => {
    await expect(
      commandTemplateText({
        template: "$1|$2|$3|$4|$5",
        arguments: `alpha "two words" 'three words' [Image 2] tail`,
      }),
    ).resolves.toBe("alpha|two words|three words|[Image 2]|tail")
  })

  test("fills numbered placeholders", async () => {
    await expect(commandTemplateText({ template: "open $1 with $2", arguments: `file.ts "line 20"` })).resolves.toBe(
      "open file.ts with line 20",
    )
  })

  test("lets the final placeholder absorb extra args", async () => {
    await expect(
      commandTemplateText({
        template: "review $1: $2",
        arguments: `src/app.ts missing null guard near submit handler`,
      }),
    ).resolves.toBe("review src/app.ts: missing null guard near submit handler")
  })

  test("replaces arguments placeholder verbatim", async () => {
    await expect(
      commandTemplateText({ template: "run this:\n$ARGUMENTS", arguments: `echo "hello world"` }),
    ).resolves.toBe('run this:\necho "hello world"')
  })

  test("uses remaining args for $ARGUMENTS when numbered placeholders are also present", async () => {
    await expect(commandTemplateText({ template: "$1 $ARGUMENTS", arguments: "foo bar baz" })).resolves.toBe(
      "foo bar baz",
    )
    await expect(
      commandTemplateText({ template: "compare $1 with $ARGUMENTS", arguments: 'left "right side" extra' }),
    ).resolves.toBe("compare left with right side extra")
  })

  test("appends args when template has no placeholders", async () => {
    await expect(commandTemplateText({ template: "summarize this change", arguments: "focus on tests" })).resolves.toBe(
      "summarize this change\n\nfocus on tests",
    )
  })

  test("drops missing numbered args", async () => {
    await expect(commandTemplateText({ template: "compare $1 and $2", arguments: "left" })).resolves.toBe(
      "compare left and",
    )
  })

  test("builds shell invocation args by shell family", () => {
    expect(shellArgs("/bin/fish", "echo hi", "darwin")).toEqual(["-c", "echo hi"])
    expect(shellArgs("/bin/bash", "echo hi", "darwin")[0]).toBe("-c")
    expect(shellArgs("/bin/zsh", "echo hi", "darwin")[0]).toBe("-c")
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

  test("selects explicit command model without requiring command metadata", async () => {
    await expect(
      commandModel({
        model: "openai/gpt-5.2",
        sessionID: "ses_test" as any,
      }),
    ).resolves.toEqual({
      providerID: ProviderID.make("openai"),
      modelID: ModelID.make("gpt-5.2"),
    })
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

  test("maps pending compaction results to loop actions", () => {
    expect(pendingCompactionDecision({ result: "stop" })).toEqual({
      type: "break",
      reason: "completed",
    })
    expect(pendingCompactionDecision({ result: "stop", overflow: true })).toEqual({
      type: "break",
      reason: "error",
    })
    expect(pendingCompactionDecision({ result: "busy" })).toEqual({
      type: "retry",
      delayMs: 250,
    })
    expect(pendingCompactionDecision({ result: "busy", busyRetries: Number.NaN })).toEqual({
      type: "break",
      reason: "error",
    })
    expect(pendingCompactionDecision({ result: "continue" })).toEqual({
      type: "continue",
    })
  })

  test("schedules usage compaction only for unfinished summaries that overflow", () => {
    const tokens = { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 10 }

    expect(shouldScheduleUsageCompaction({ lastFinished: undefined, overflow: true })).toBe(false)
    expect(
      shouldScheduleUsageCompaction({
        lastFinished: { summary: true, tokens } as any,
        overflow: true,
      }),
    ).toBe(false)
    expect(
      shouldScheduleUsageCompaction({
        lastFinished: { summary: false, tokens } as any,
        overflow: false,
      }),
    ).toBe(false)
    expect(
      shouldScheduleUsageCompaction({
        lastFinished: { summary: false, tokens } as any,
        overflow: true,
      }),
    ).toBe(true)
  })

  test("stops the prompt loop after too many consecutive errors", () => {
    expect(
      consecutiveErrorDecision({
        consecutiveErrors: 2,
        maxConsecutiveErrors: 3,
        step: 12,
      }),
    ).toEqual({ action: "continue" })

    expect(
      consecutiveErrorDecision({
        consecutiveErrors: 3,
        maxConsecutiveErrors: 3,
        step: 12,
      }),
    ).toEqual({
      action: "stop",
      reason: "error",
      message:
        `Agent encountered 3 consecutive errors at step 12. ` +
        `Stopping to prevent retry loop. Try rephrasing your request or breaking it into smaller tasks.`,
    })
  })

  test("stops the prompt loop when consecutive error limits are non-comparable", () => {
    expect(
      consecutiveErrorDecision({
        consecutiveErrors: 1,
        maxConsecutiveErrors: Number.NaN,
        step: 12,
      }),
    ).toMatchObject({
      action: "stop",
      reason: "error",
    })
    expect(
      consecutiveErrorDecision({
        consecutiveErrors: Number.NaN,
        maxConsecutiveErrors: 3,
        step: 12,
      }),
    ).toEqual({
      action: "stop",
      reason: "error",
      message:
        `Agent encountered an invalid number of consecutive errors at step 12. ` +
        `Stopping to prevent retry loop. Try rephrasing your request or breaking it into smaller tasks.`,
    })
  })

  test("looks up fallback providers immediately for account failures and after repeated rate limits", () => {
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 1,
        error: { name: "APIError", data: { statusCode: 429, message: "rate limited" } },
      }),
    ).toEqual({ action: "skip" })
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 2,
        error: { name: "APIError", data: { statusCode: 429, message: "rate limited" } },
      }),
    ).toEqual({
      action: "lookup",
      errorMessage: "rate limited",
      stopWithoutFallback: false,
    })
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 1,
        error: {
          name: "APIError",
          data: { statusCode: 429, message: "Your token-plan quota has been exhausted." },
        },
      }),
    ).toEqual({
      action: "lookup",
      errorMessage: "Your token-plan quota has been exhausted.",
      stopWithoutFallback: true,
    })
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 1,
        error: {
          name: "AI_APICallError",
          statusCode: 429,
          responseBody: JSON.stringify({
            error: {
              message: "Your token-plan quota has been exhausted.",
              type: "insufficient_quota",
              code: "insufficient_quota",
            },
          }),
        },
      }),
    ).toEqual({
      action: "lookup",
      errorMessage: "Your token-plan quota has been exhausted.",
      stopWithoutFallback: true,
    })
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 1,
        error: {
          name: "AI_APICallError",
          statusCode: 429,
          responseBody: JSON.stringify({
            error: {
              code: "insufficient_quota",
            },
          }),
        },
      }),
    ).toEqual({
      action: "lookup",
      errorMessage: "insufficient_quota",
      stopWithoutFallback: true,
    })
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 1,
        error: {
          name: "AI_APICallError",
          message: "Too Many Requests",
          statusCode: 429,
          responseBody: JSON.stringify({
            error: {
              code: "insufficient_quota",
            },
          }),
        },
      }),
    ).toEqual({
      action: "lookup",
      errorMessage: "insufficient_quota",
      stopWithoutFallback: true,
    })
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 1,
        error: { name: "APIError", data: { statusCode: 402, message: "payment required" } },
      }),
    ).toEqual({
      action: "lookup",
      errorMessage: "payment required",
      stopWithoutFallback: true,
    })
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 1,
        error: { name: "APIError", data: { statusCode: 403, message: "forbidden" } },
      }),
    ).toEqual({
      action: "lookup",
      errorMessage: "forbidden",
      stopWithoutFallback: true,
    })
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 2,
        error: { name: "APIError", data: { statusCode: 500, message: "server error" } },
      }),
    ).toEqual({ action: "skip" })
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 2,
        error: { name: "OtherError", data: { statusCode: 429, message: "rate limited" } },
      }),
    ).toEqual({ action: "skip" })
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: Number.NaN,
        error: { name: "APIError", data: { statusCode: 429, message: "rate limited" } },
      }),
    ).toEqual({ action: "skip" })
  })

  test("chooses the same model from another provider before sorted fallback models", () => {
    const providers = {
      "alibaba-token-plan": {
        id: ProviderID.make("alibaba-token-plan"),
        name: "Alibaba Token Plan",
        models: {
          "glm-5.1": { id: ModelID.make("glm-5.1") },
        },
      } as any,
      "zai-coding-plan": {
        id: ProviderID.make("zai-coding-plan"),
        name: "ZAI Coding Plan",
        models: {
          "zai-small": { id: ModelID.make("zai-small") },
          "glm-5.1": { id: ModelID.make("glm-5.1") },
        },
      } as any,
      openrouter: {
        id: ProviderID.make("openrouter"),
        name: "OpenRouter",
        models: {
          "z-model": { id: ModelID.make("z-model") },
        },
      } as any,
    } as any

    const result = chooseFallbackModel(providers, {
      failedProviderID: ProviderID.make("alibaba-token-plan"),
      preferredModelID: ModelID.make("glm-5.1"),
    })

    expect(result).toEqual({
      providerID: ProviderID.make("zai-coding-plan"),
      modelID: ModelID.make("glm-5.1"),
    })

    const excludedResult = chooseFallbackModel(providers, {
      failedProviderID: ProviderID.make("alibaba-token-plan"),
      preferredModelID: ModelID.make("glm-5.1"),
      excludedProviderIDs: [ProviderID.make("zai-coding-plan")],
    })

    expect(excludedResult).toEqual({
      providerID: ProviderID.make("openrouter"),
      modelID: ModelID.make("z-model"),
    })
  })

  test("builds fallback provider switch state", () => {
    expect(
      providerFallbackSwitchState({
        current: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-opus") },
        fallback: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5") },
        errorMessage: "quota exceeded",
        consecutiveErrors: 5,
      }),
    ).toEqual({
      from: "anthropic/claude-opus",
      to: "openai/gpt-5",
      reason: "quota exceeded",
      message: "Provider anthropic failed: quota exceeded. Switching to openai/gpt-5.",
      nextConsecutiveErrors: 2,
    })

    const unknownReasonSwitch = providerFallbackSwitchState({
      current: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-opus") },
      fallback: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5") },
      errorMessage: undefined,
      consecutiveErrors: 2,
    })
    expect(unknownReasonSwitch.reason).toBe("unknown error")
    expect(unknownReasonSwitch.message).toBe("Provider anthropic failed: unknown error. Switching to openai/gpt-5.")

    const blankReasonSwitch = providerFallbackSwitchState({
      current: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-opus") },
      fallback: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5") },
      errorMessage: "  ",
      consecutiveErrors: 2,
    })
    expect(blankReasonSwitch.reason).toBe("unknown error")
    expect(blankReasonSwitch.message).toBe("Provider anthropic failed: unknown error. Switching to openai/gpt-5.")
  })

  test("normalizes invalid fallback provider error counts before resuming", () => {
    expect(
      providerFallbackSwitchState({
        current: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-opus") },
        fallback: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5") },
        errorMessage: "quota exceeded",
        consecutiveErrors: Number.NaN,
      }).nextConsecutiveErrors,
    ).toBe(0)
    expect(
      providerFallbackSwitchState({
        current: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-opus") },
        fallback: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5") },
        errorMessage: "quota exceeded",
        consecutiveErrors: -1,
      }).nextConsecutiveErrors,
    ).toBe(0)
  })

  test("maps processor results to prompt loop decisions", () => {
    expect(processorLoopDecision({ result: "stop", messageFinish: "stop", hasError: false })).toEqual({
      action: "stop",
      reason: "completed",
    })
    expect(processorLoopDecision({ result: "stop", messageFinish: "stop", hasError: true })).toEqual({
      action: "stop",
      reason: "error",
    })
    expect(processorLoopDecision({ result: "continue", messageFinish: "tool-calls", hasError: false })).toEqual({
      action: "continue",
    })
    expect(processorLoopDecision({ result: "compact", messageFinish: "stop", hasError: false })).toEqual({
      action: "compact",
      overflow: false,
      triggerReason: "provider_usage",
    })
    expect(processorLoopDecision({ result: "compact", messageFinish: undefined, hasError: false })).toEqual({
      action: "compact",
      overflow: true,
      triggerReason: "context_overflow_error",
    })
  })

  test("detects whether an assistant response belongs after the current user turn", () => {
    expect(
      assistantRespondedAfterUser({
        lastUserID: "001",
        lastAssistant: { id: "002", finish: "stop" } as any,
      }),
    ).toBe(true)
    expect(
      assistantRespondedAfterUser({
        lastUserID: "002",
        lastAssistant: { id: "001", finish: "stop" } as any,
      }),
    ).toBe(false)
    expect(
      assistantRespondedAfterUser({
        lastUserID: "001",
        lastAssistant: { id: "002", finish: undefined } as any,
      }),
    ).toBe(false)
    expect(assistantRespondedAfterUser({ lastUserID: "001", lastAssistant: undefined })).toBe(false)
  })

  test("maps completed assistant turns to loop exit decisions", () => {
    expect(
      assistantLoopExitDecision({
        lastUserID: "001",
        lastAssistant: { id: "002", finish: "stop" } as any,
        hasPendingSubtask: false,
      }),
    ).toEqual({ action: "complete" })

    expect(
      assistantLoopExitDecision({
        lastUserID: "001",
        lastAssistant: { id: "002", finish: "unknown" } as any,
        hasPendingSubtask: false,
      }),
    ).toEqual({
      action: "complete_unknown_finish",
      logMessage: "model returned unknown finish with no actionable output",
    })
  })

  test("keeps loop running for actionable, stale, or unfinished assistant turns", () => {
    expect(
      assistantLoopExitDecision({
        lastUserID: "001",
        lastAssistant: { id: "002", finish: "tool-calls" } as any,
        hasPendingSubtask: false,
      }),
    ).toEqual({ action: "continue" })
    expect(
      assistantLoopExitDecision({
        lastUserID: "001",
        lastAssistant: { id: "002", finish: "unknown" } as any,
        hasPendingSubtask: true,
      }),
    ).toEqual({ action: "continue" })
    expect(
      assistantLoopExitDecision({
        lastUserID: "003",
        lastAssistant: { id: "002", finish: "stop" } as any,
        hasPendingSubtask: false,
      }),
    ).toEqual({ action: "continue" })
    expect(
      assistantLoopExitDecision({
        lastUserID: "001",
        lastAssistant: { id: "002", finish: undefined } as any,
        hasPendingSubtask: false,
      }),
    ).toEqual({ action: "continue" })
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

  test("injects the assurance workflow when structured review tools are enabled", async () => {
    const result = await systemPrompt({
      agent: { name: "build", permission: Permission.fromConfig({ "*": "allow" }) } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "text" },
      cache: {},
      skills: async () => undefined,
      environment: async () => ["env"],
      instructions: async () => ["rules"],
      memory: async () => undefined,
      decisionHints: async () => undefined,
    })

    expect(result[0]).toBe("env")
    expect(result[1]).toContain("<assurance_workflow>")
    expect(result[1]).toContain("register_finding")
    expect(result[1]).toContain("verify_project")
    expect(result[1]).toContain("review_complete")
    expect(result[2]).toBe("rules")
  })

  test("omits the assurance workflow when structured review tools are denied", async () => {
    const result = await systemPrompt({
      agent: { name: "summary", permission: Permission.fromConfig({ "*": "deny" }) } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "text" },
      cache: {},
      skills: async () => undefined,
      environment: async () => ["env"],
      instructions: async () => ["rules"],
      memory: async () => undefined,
      decisionHints: async () => undefined,
    })

    expect(result).toEqual(["env", "rules"])
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
