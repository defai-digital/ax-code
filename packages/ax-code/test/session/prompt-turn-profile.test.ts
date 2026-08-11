import { describe, expect, test } from "vitest"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import {
  detectTurnExecutionProfile,
  RESPONSE_ONLY_SYSTEM_PROMPT,
  responseOnlyUsesFastReasoning,
} from "../../src/session/prompt-turn-profile"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const sessionID = SessionID.make("ses_response_only")
const providerID = ProviderID.make("ax-engine")
const modelID = ModelID.make("qwen-local")

function userMessage(text: string, input: { id?: string; format?: MessageV2.OutputFormat; parts?: any[] } = {}) {
  const id = MessageID.make(input.id ?? "msg_user")
  const info: MessageV2.User = {
    id,
    sessionID,
    role: "user",
    time: { created: 2 },
    agent: "build",
    model: { providerID, modelID },
    format: input.format,
  }
  return {
    info,
    parts: input.parts ?? [
      {
        id: PartID.make(`${id}_text`),
        sessionID,
        messageID: id,
        type: "text" as const,
        text,
      },
    ],
  } satisfies MessageV2.WithParts
}

function assistantMessage(text: string, input: { id?: string; parts?: any[]; finish?: string; error?: any } = {}) {
  const id = MessageID.make(input.id ?? "msg_assistant")
  const info: MessageV2.Assistant = {
    id,
    sessionID,
    parentID: MessageID.make("msg_source_user"),
    role: "assistant",
    mode: "build",
    agent: "build",
    modelID,
    providerID,
    path: { cwd: "/tmp/project", root: "/tmp/project" },
    time: { created: 1, completed: 2 },
    tokens: { input: 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: input.finish ?? "stop",
    error: input.error,
  }
  return {
    info,
    parts: input.parts ?? [
      {
        id: PartID.make(`${id}_text`),
        sessionID,
        messageID: id,
        type: "text" as const,
        text,
      },
    ],
  } satisfies MessageV2.WithParts
}

function detect(text: string) {
  const assistant = assistantMessage("The implementation is complete, with two caveats.")
  const user = userMessage(text)
  return detectTurnExecutionProfile({ messages: [assistant, user], currentUser: user.info })
}

describe("response-only turn execution profile", () => {
  test("matches the reproduced Traditional Chinese follow-up", () => {
    const profile = detect("please tell me in trad. chinese")

    expect(profile).toMatchObject({
      kind: "response-only",
      intent: "translate",
      reason: "previous_answer_translate",
    })
  })

  test.each([
    ["Translate the previous answer into Japanese", "translate"],
    ["Make that shorter", "shorten"],
    ["Rewrite the above more formally", "rewrite"],
    ["Format that as bullet points", "reformat"],
    ["請用繁體中文回答", "translate"],
  ])("matches conservative response transforms: %s", (text, intent) => {
    expect(detect(text)).toMatchObject({ kind: "response-only", intent })
  })

  test.each([
    "Translate the app to Traditional Chinese",
    "Add i18n strings for Chinese",
    "Translate README.md into Chinese",
    "Edit `src/messages.ts` to use Chinese",
    "Write a poem in Chinese",
    "Make that shorter and then inspect the tests",
  ])("rejects repository work or ambiguous new tasks: %s", (text) => {
    expect(detect(text).kind).toBe("default")
  })

  test("rejects structured output and attachments", () => {
    const assistant = assistantMessage("Answer")
    const structured = userMessage("Make that shorter", {
      format: { type: "json_schema", schema: { type: "object" }, retryCount: 0 },
    })
    expect(
      detectTurnExecutionProfile({ messages: [assistant, structured], currentUser: structured.info }),
    ).toMatchObject({ kind: "default", reason: "structured_output" })

    const attached = userMessage("Translate that into Japanese", {
      id: "msg_attached",
      parts: [
        {
          id: PartID.make("part_file"),
          sessionID,
          messageID: MessageID.make("msg_attached"),
          type: "file",
          mime: "text/plain",
          filename: "answer.txt",
          url: "data:text/plain;base64,QQ==",
        },
      ],
    })
    expect(detectTurnExecutionProfile({ messages: [assistant, attached], currentUser: attached.info })).toMatchObject({
      kind: "default",
      reason: "non_text_or_synthetic_user_part",
    })
  })

  test("requires the immediately previous completed assistant answer", () => {
    const incomplete = assistantMessage("Partial", { finish: "length" })
    const user = userMessage("Make that shorter")
    expect(detectTurnExecutionProfile({ messages: [incomplete, user], currentUser: user.info })).toMatchObject({
      kind: "default",
      reason: "assistant_not_completed_text",
    })

    const queued = userMessage("Unrelated queued request", { id: "msg_queued" })
    expect(
      detectTurnExecutionProfile({ messages: [assistantMessage("Answer"), queued, user], currentUser: user.info }),
    ).toMatchObject({ kind: "default", reason: "no_immediate_assistant" })
  })

  test("projects a pairing-safe two-message text window", () => {
    const assistant = assistantMessage("Final answer", {
      parts: [
        {
          id: PartID.make("reasoning"),
          sessionID,
          messageID: MessageID.make("msg_assistant"),
          type: "reasoning",
          text: "private reasoning",
          time: { start: 1, end: 2 },
        },
        {
          id: PartID.make("tool"),
          sessionID,
          messageID: MessageID.make("msg_assistant"),
          type: "tool",
          callID: "call_1",
          tool: "read",
          state: { status: "completed", input: {}, output: "large tool output", title: "read", metadata: {} },
        },
        {
          id: PartID.make("answer"),
          sessionID,
          messageID: MessageID.make("msg_assistant"),
          type: "text",
          text: "Final answer",
        },
      ],
    })
    const user = userMessage("in traditional chinese")
    const profile = detectTurnExecutionProfile({ messages: [assistant, user], currentUser: user.info })

    expect(profile.kind).toBe("response-only")
    if (profile.kind !== "response-only") throw new Error("expected response-only profile")
    expect(profile.requestMessages).toHaveLength(2)
    expect(profile.requestMessages[0]?.parts.map((part) => part.type)).toEqual(["text"])
    expect(profile.requestMessages[1]?.parts.map((part) => part.type)).toEqual(["text"])
    expect(profile.sourceTextChars).toBe("Final answer".length)
  })

  test("uses fast reasoning unless the user explicitly selected another depth or variant", () => {
    expect(responseOnlyUsesFastReasoning({})).toBe(true)
    expect(responseOnlyUsesFastReasoning({ requestedDepth: "fast" })).toBe(true)
    expect(responseOnlyUsesFastReasoning({ requestedDepth: "standard" })).toBe(false)
    expect(responseOnlyUsesFastReasoning({ requestedDepth: "deep" })).toBe(false)
    expect(responseOnlyUsesFastReasoning({ variant: "auto" })).toBe(true)
    expect(responseOnlyUsesFastReasoning({ variant: "high" })).toBe(false)
  })

  test("uses an explicit compact system contract", () => {
    expect(RESPONSE_ONLY_SYSTEM_PROMPT).toContain("immediately preceding assistant answer")
    expect(RESPONSE_ONLY_SYSTEM_PROMPT).toContain("Do not inspect the workspace")
    expect(RESPONSE_ONLY_SYSTEM_PROMPT).toContain("Return only the transformed answer")
  })
})
