import { describe, expect, test } from "vitest"
import type { Message, Part } from "@ax-code/sdk/v2"
import {
  createTranscriptProjector,
  MAX_TRACKED_REVERTS,
  type TranscriptSnapshot,
} from "../../../../src/cli/tui/inline/transcript-projector"
import { formatBlock, markdownText } from "../../../../src/cli/tui/inline/block-format"
import { settledTextLength } from "../../../../src/cli/tui/inline/scrollback-stream"

const user = { id: "m1", sessionID: "s", role: "user", time: { created: 1 } } as Message
const assistant = {
  id: "m2",
  sessionID: "s",
  role: "assistant",
  parentID: "m1",
  modelID: "test",
  providerID: "test",
  mode: "build",
  agent: "build",
  path: { cwd: "/tmp", root: "/tmp" },
  time: { created: 2, completed: 4 },
  tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 0, write: 0 } },
  cost: 42.5,
} as Message
const text = (id: string, value: string, done = true): Part => ({
  id,
  sessionID: "s",
  messageID: "m2",
  type: "text",
  text: value,
  time: done ? { start: 1, end: 2 } : { start: 1 },
})
const tool = (id: string, status: "running" | "completed" | "error"): Part =>
  ({
    id,
    messageID: "m2",
    sessionID: "s",
    type: "tool",
    tool: "bash",
    callID: id,
    state: { status, title: id, error: "failed", input: {}, output: "", time: { start: 1, end: 2 }, metadata: {} },
  }) as Part
const snapshot = (): TranscriptSnapshot => ({
  sessionID: "s",
  messages: [user, assistant],
  parts: { m1: [text("u", "hello")], m2: [text("a", "answer"), tool("t", "completed")] },
  status: { type: "idle" },
})

describe("inline transcript projection", () => {
  test("dedupes complete parts and emits a tokens-only idle summary", () => {
    const projector = createTranscriptProjector()
    const input = snapshot()
    const blocks = projector.project(input)
    expect(blocks.map((block) => block.kind)).toEqual(["marker", "user", "assistant", "tool", "summary"])
    expect(blocks[2].key).toBe("s:m2:a")
    expect(blocks.at(-1)?.text).toBe("Tokens: 100 input, 20 output, 5 reasoning")
    expect(blocks.at(-1)?.text).not.toMatch(/\$|dollar|42\.5/i)
    expect(projector.project(input)).toEqual([])
    expect(projector.project({ ...input, messages: structuredClone(input.messages) })).toEqual([])
  })

  test("holds later text/tools behind unfinished parts and does not finalize text at idle", () => {
    const projector = createTranscriptProjector()
    const input = snapshot()
    input.parts.m2 = [text("a", "partial", false), tool("t", "completed"), text("b", "after tool")]
    expect(projector.project(input).map((block) => block.kind)).toEqual(["marker", "user", "assistant"])
    expect(projector.project(input)[0].progress).toBe(true)
    input.parts.m2[0] = text("a", "finished")
    expect(projector.project(input).map((block) => block.kind)).toEqual(["assistant", "tool", "assistant", "summary"])
    expect(projector.project(input)).toEqual([])
  })

  test("a running tool blocks later text until its error or completion", () => {
    const input = snapshot()
    input.parts.m2 = [tool("t", "running"), text("b", "tail")]
    const projector = createTranscriptProjector()
    expect(projector.project(input).map((block) => block.kind)).toEqual(["marker", "user"])
    input.parts.m2[0] = tool("t", "error")
    expect(projector.project(input).map(formatBlock)).toEqual([
      "[error] bash: failed",
      "tail",
      "Tokens: 100 input, 20 output, 5 reasoning",
    ])
  })

  test("a part-level revert keeps the boundary message up to the reverted part", () => {
    const blocks = createTranscriptProjector().project({ ...snapshot(), revert: "m2", revertPart: "t" })
    const kinds = blocks.map((block) => block.kind)
    expect(blocks.find((block) => block.kind === "assistant")?.text).toBe("answer")
    expect(kinds).not.toContain("tool")
  })

  test("a message revert hides the boundary message", () => {
    const blocks = createTranscriptProjector().project({ ...snapshot(), revert: "m2" })
    expect(blocks.map((block) => block.kind)).not.toContain("assistant")
    expect(blocks.find((block) => block.kind === "user")?.text).toBe("hello")
  })

  test("session, revert and compaction markers append without replaying old content", () => {
    const projector = createTranscriptProjector()
    const input = snapshot()
    projector.project(input)
    input.parts.m2.push({ id: "c", type: "compaction", messageID: "m2", sessionID: "s", auto: true })
    expect(projector.project(input)[0].text).toContain("Context compacted")
    expect(projector.project({ ...input, revert: "m2" })[0].text).toContain("Reverted to m2")
    expect(projector.project({ ...input, sessionID: "other", messages: [] })[0].text).toContain("Session other")
    const back = projector.project(input)
    expect(back.every((block) => block.kind === "marker")).toBe(true)
    expect(back[0].text).toContain("Session s")
  })

  test("pending requests belong to the footer and never append a full-screen notice", () => {
    const projector = createTranscriptProjector()
    const input = {
      ...snapshot(),
      requests: [
        { id: "per", kind: "permission" as const },
        { id: "q", kind: "question" as const },
      ],
    }
    expect(
      projector
        .project(input)
        .filter((block) => block.kind === "notice")
        .map((block) => block.text),
    ).toEqual([])
    expect(projector.project(input)).toEqual([])
    expect(input.requests).toHaveLength(2)
  })

  test("settles paragraphs and closed fences, retaining partial paragraphs and open fences", () => {
    expect(markdownText("Use `**literal**` and **bold**")).toBe("Use **literal** and bold")
    const prefix = "First paragraph.\n\n"
    expect(settledTextLength(prefix + "partial")).toBe(prefix.length)
    expect(settledTextLength(prefix + "```ts\ncode\n\n")).toBe(prefix.length)
    const closed = prefix + "```ts\ncode\n```\n"
    expect(settledTextLength(closed + "tail")).toBe(closed.length)
    expect(settledTextLength("~~~\n```\n\n")).toBe(0)
    expect(markdownText("# Heading\n\n**bold** and `code`\n\n```ts\nconst a = '**literal**'\n```")).toBe(
      "Heading\n\nbold and code\n\nconst a = '**literal**'",
    )
  })

  test("revert memory stays bounded across many sessions", () => {
    const projector = createTranscriptProjector()
    for (let i = 0; i < MAX_TRACKED_REVERTS * 3; i++) {
      projector.project({ sessionID: `ses_${i}`, messages: [], parts: {}, revert: "msg_1" })
    }
    // The oldest session was forgotten, so returning to it records its revert again.
    const again = projector.project({ sessionID: "ses_0", messages: [], parts: {}, revert: "msg_1" })
    expect(again.map((block) => block.kind)).toEqual(["marker", "marker"])
    // A recent session is still remembered: only the switch marker is emitted.
    projector.project({ sessionID: `ses_${MAX_TRACKED_REVERTS * 3 - 1}`, messages: [], parts: {}, revert: "msg_1" })
    const recent = projector.project({ sessionID: "ses_0", messages: [], parts: {}, revert: "msg_1" })
    expect(recent.map((block) => block.kind)).toEqual(["marker"])
  })
})
