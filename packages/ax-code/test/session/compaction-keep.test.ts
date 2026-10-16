import { describe, expect, test } from "vitest"
import { SessionCompaction } from "../../src/session/compaction"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import type { Provider } from "../../src/provider/provider"

Log.init({ print: false })

const SESSION = SessionID.make("ses_keep")

type Role = "user" | "assistant"

/** Minimal WithParts builder: enough shape for the pure window math and the preview. */
function msg(id: string, role: Role, parts: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return {
    info: { id: MessageID.make(id), role, sessionID: SESSION, time: { created: 0 }, ...extra },
    parts: parts.map((part, index) => ({
      id: PartID.make(`prt_${id}_${index}`),
      messageID: MessageID.make(id),
      sessionID: SESSION,
      ...part,
    })),
  } as unknown as MessageV2.WithParts
}

const text = (body: string) => ({ type: "text", text: body })
const compaction = (keep?: number) => (keep === undefined ? { type: "compaction" } : { type: "compaction", keep })
const completedTool = (tool: string, output: string) => ({
  type: "tool",
  tool,
  state: {
    status: "completed",
    title: `${tool} call`,
    input: {},
    output,
    metadata: {},
    time: { start: 0, end: 0 },
  },
})

function createModel(): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: { context: 100_000, input: 80_000, output: 32_000 },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai" },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  } as Provider.Model
}

const { selectKeepWindow, preview, COMPACTION_KEEP_MAX } = SessionCompaction

describe("session.compaction.selectKeepWindow", () => {
  test("keeps the last N messages before the marker and summarizes the rest", () => {
    const messages = [
      msg("u1", "user", [text("one")]),
      msg("a1", "assistant", [text("two")]),
      msg("u2", "user", [text("three")]),
      msg("a2", "assistant", [text("four")]),
      msg("marker", "user", [compaction(2)]),
    ]
    const { summarize, kept } = selectKeepWindow({ messages, keep: 2, markerID: MessageID.make("marker") })
    expect(summarize.map((m) => m.info.id)).toEqual(["u1", "a1"])
    expect(kept.map((m) => m.info.id)).toEqual(["u2", "a2"])
  })

  test("clamps the window to at least one and at most COMPACTION_KEEP_MAX", () => {
    const messages = Array.from({ length: 80 }, (_, i) => msg(`m${i}`, i % 2 ? "assistant" : "user", [text(`${i}`)]))
    expect(selectKeepWindow({ messages, keep: 0 }).kept).toHaveLength(1)
    expect(selectKeepWindow({ messages, keep: 999 }).kept).toHaveLength(COMPACTION_KEEP_MAX)
    expect(COMPACTION_KEEP_MAX).toBe(50)
  })

  test("never crosses an earlier compaction boundary", () => {
    const messages = [
      msg("old-marker", "user", [compaction()]),
      msg("kept-old", "user", [text("kept")]),
      msg("m1", "user", [text("one")]),
      msg("m2", "assistant", [text("two")]),
      msg("marker", "user", [compaction(5)]),
    ]
    const { summarize, kept } = selectKeepWindow({ messages, keep: 5, markerID: MessageID.make("marker") })
    // Walked back past `kept-old` and stopped at the earlier marker: the
    // boundary is never absorbed by the window (that history was already
    // discarded), only the two messages after it are kept.
    expect(kept.map((m) => m.info.id)).toEqual(["kept-old", "m1", "m2"])
    expect(summarize.map((m) => m.info.id)).toEqual(["old-marker"])
  })

  test("anchors at the list end when the marker is absent (overflow replay)", () => {
    const messages = [msg("m1", "user", [text("one")]), msg("m2", "assistant", [text("two")])]
    const { summarize, kept } = selectKeepWindow({ messages, keep: 1 })
    expect(kept.map((m) => m.info.id)).toEqual(["m2"])
    expect(summarize.map((m) => m.info.id)).toEqual(["m1"])
  })
})

describe("session.compaction.preview", () => {
  test("counts summarized and kept messages and renders the focus", async () => {
    const messages = [
      msg("m1", "user", [text("one")]),
      msg("m2", "assistant", [text("two")]),
      msg("m3", "user", [text("three")]),
    ]
    const result = await preview({ messages, model: createModel(), keep: 1, focus: "keep the API notes" })
    expect(result.summarizeMessages).toBe(2)
    expect(result.keepMessages).toBe(1)
    expect(result.focus).toContain("keep the API notes")
    expect(result.summarizeTokens).toBeGreaterThan(0)
    expect(result.keepTokens).toBeGreaterThan(0)
  })

  test("without keep nothing is kept", async () => {
    const messages = [msg("m1", "user", [text("one")]), msg("m2", "assistant", [text("two")])]
    const result = await preview({ messages, model: createModel() })
    expect(result.keepMessages).toBe(0)
    expect(result.keepTokens).toBe(0)
    expect(result.summarizeMessages).toBe(2)
    expect(result.focus).toBe("")
  })

  test("aggregates completed tool outputs inside the summarized range by tool", async () => {
    const messages = [
      msg("m1", "assistant", [completedTool("bash", "hello output"), completedTool("bash", "more output")]),
      msg("m2", "assistant", [completedTool("read", "file body")]),
      msg("m3", "assistant", [{ type: "tool", tool: "bash", state: { status: "running" } }]),
    ]
    const result = await preview({ messages, model: createModel() })
    const bash = result.prunedToolOutputs.find((entry) => entry.tool === "bash")
    const read = result.prunedToolOutputs.find((entry) => entry.tool === "read")
    expect(bash).toEqual(expect.objectContaining({ parts: 2 }))
    expect(read).toEqual(expect.objectContaining({ parts: 1 }))
    expect(bash?.estimatedTokens).toBeGreaterThan(0)
  })

  test("excludes the kept window's tool outputs from pruning", async () => {
    const messages = [
      msg("m1", "assistant", [completedTool("bash", "summarized")]),
      msg("m2", "assistant", [completedTool("read", "kept")]),
    ]
    const result = await preview({ messages, model: createModel(), keep: 1 })
    expect(result.prunedToolOutputs.map((entry) => entry.tool)).toEqual(["bash"])
  })
})

describe("session.compaction summarize preview schema", () => {
  test("the CompactionPart keep field is bounded to 1..COMPACTION_KEEP_MAX", () => {
    const base = {
      id: PartID.make("prt_x"),
      sessionID: SESSION,
      messageID: MessageID.make("msg_x"),
      type: "compaction" as const,
      auto: false,
    }
    expect(MessageV2.CompactionPart.safeParse({ ...base, keep: 1 }).success).toBe(true)
    expect(MessageV2.CompactionPart.safeParse({ ...base, keep: COMPACTION_KEEP_MAX }).success).toBe(true)
    expect(MessageV2.CompactionPart.safeParse({ ...base, keep: 0 }).success).toBe(false)
    expect(MessageV2.CompactionPart.safeParse({ ...base, keep: COMPACTION_KEEP_MAX + 1 }).success).toBe(false)
    expect(MessageV2.CompactionPart.safeParse(base).success).toBe(true)
  })

  test("SummarizePreview validates a well-formed body and rejects negatives", () => {
    const valid = {
      summarizeMessages: 3,
      summarizeTokens: 1200,
      keepMessages: 1,
      keepTokens: 300,
      prunedToolOutputs: [{ tool: "bash", parts: 2, estimatedTokens: 800 }],
      focus: "",
    }
    expect(SessionCompaction.SummarizePreview.safeParse(valid).success).toBe(true)
    expect(SessionCompaction.SummarizePreview.safeParse({ ...valid, summarizeMessages: -1 }).success).toBe(false)
  })
})

describe("session.compaction message-v2 keep window", () => {
  // Stream order is newest → oldest (see MessageV2.stream).
  function stream(messages: MessageV2.WithParts[]) {
    return (async function* () {
      for (const message of messages) yield message
    })()
  }

  test("kept messages survive filterCompacted verbatim before the summary", async () => {
    const summary = msg("summary", "assistant", [text("the summary")], {
      summary: true,
      finish: "stop",
      parentID: MessageID.make("marker"),
    })
    const messages = [
      summary,
      msg("marker", "user", [compaction(2)]),
      msg("m2", "assistant", [text("kept two")]),
      msg("m1", "user", [text("kept one")]),
      msg("old", "user", [text("dropped")]),
    ]
    const surviving = await MessageV2.filterCompacted(stream(messages))
    expect(surviving.map((m) => m.info.id)).toEqual(["m1", "m2", "marker", "summary"])
  })

  test("a marker with no keep behaves exactly as before (marker + summary only)", async () => {
    const summary = msg("summary", "assistant", [text("the summary")], {
      summary: true,
      finish: "stop",
      parentID: MessageID.make("marker"),
    })
    const messages = [
      summary,
      msg("marker", "user", [compaction()]),
      msg("m2", "assistant", [text("dropped two")]),
      msg("m1", "user", [text("dropped one")]),
    ]
    const surviving = await MessageV2.filterCompacted(stream(messages))
    expect(surviving.map((m) => m.info.id)).toEqual(["marker", "summary"])
  })

  test("the keep window stops at an earlier compaction boundary", async () => {
    const summary = msg("summary", "assistant", [text("the summary")], {
      summary: true,
      finish: "stop",
      parentID: MessageID.make("marker"),
    })
    const messages = [
      summary,
      msg("marker", "user", [compaction(5)]),
      msg("m1", "user", [text("kept")]),
      msg("old-marker", "user", [compaction()]),
      msg("ancient", "user", [text("not kept")]),
    ]
    const surviving = await MessageV2.filterCompacted(stream(messages))
    expect(surviving.map((m) => m.info.id)).toEqual(["m1", "marker", "summary"])
  })
})
