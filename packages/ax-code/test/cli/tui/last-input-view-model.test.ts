import { describe, expect, test } from "vitest"
import {
  derivePinnedInputBanner,
  messagePreviewVisibility,
  normalizePreviewText,
  pinnedInputMaxLines,
  selectPinnedInputCandidate,
  sessionChromeRows,
  subagentPanelRows,
  truncateToCellWidth,
  type PinnedInputCandidate,
} from "../../../src/cli/cmd/tui/routes/session/last-input-view-model"

function parts(map: Record<string, Array<Record<string, unknown>> | undefined>) {
  return map as Record<
    string,
    Array<{ type?: string; synthetic?: boolean; ignored?: boolean; text?: string }> | undefined
  >
}

const ready: PinnedInputCandidate = {
  state: "ready",
  messageID: "msg_user",
  text: "Fix the failing session rollback test",
}

describe("selectPinnedInputCandidate", () => {
  test("selects the last user message with visible text", () => {
    expect(
      selectPinnedInputCandidate({
        messages: [
          { id: "a", role: "user" },
          { id: "b", role: "assistant" },
          { id: "c", role: "user" },
        ],
        partsByMessageID: parts({
          a: [{ type: "text", text: "old" }],
          c: [{ type: "text", text: "hello" }],
        }),
        hiddenIDs: new Set(),
        historyTruncated: false,
      }),
    ).toEqual({ state: "ready", messageID: "c", text: "hello" })
  })

  test("joins multiple visible text parts and skips synthetic and ignored text", () => {
    expect(
      selectPinnedInputCandidate({
        messages: [{ id: "a", role: "user" }],
        partsByMessageID: parts({
          a: [
            { type: "text", text: "hello " },
            { type: "text", text: "hidden", synthetic: true },
            { type: "text", text: "ignored", ignored: true },
            { type: "text", text: "world" },
          ],
        }),
        hiddenIDs: new Set(),
        historyTruncated: false,
      }),
    ).toEqual({ state: "ready", messageID: "a", text: "hello world" })
  })

  test("hides while the newest user message has not received parts", () => {
    expect(
      selectPinnedInputCandidate({
        messages: [
          { id: "a", role: "user" },
          { id: "b", role: "user" },
        ],
        partsByMessageID: parts({
          a: [{ type: "text", text: "previous" }],
          b: undefined,
        }),
        hiddenIDs: new Set(),
        historyTruncated: false,
      }),
    ).toEqual({ state: "none", reason: "pending-parts" })
  })

  test("skips compaction-only user messages instead of pending", () => {
    expect(
      selectPinnedInputCandidate({
        messages: [
          { id: "a", role: "user" },
          { id: "b", role: "user" },
        ],
        partsByMessageID: parts({
          a: [{ type: "text", text: "keep me" }],
          b: [{ type: "compaction" }],
        }),
        hiddenIDs: new Set(),
        historyTruncated: false,
      }),
    ).toEqual({ state: "ready", messageID: "a", text: "keep me" })
  })

  test("skips reverted user messages", () => {
    expect(
      selectPinnedInputCandidate({
        messages: [
          { id: "a", role: "user" },
          { id: "b", role: "assistant" },
          { id: "c", role: "user" },
        ],
        partsByMessageID: parts({
          a: [{ type: "text", text: "keep" }],
          c: [{ type: "text", text: "reverted" }],
        }),
        hiddenIDs: new Set(["b", "c"]),
        historyTruncated: false,
      }),
    ).toEqual({ state: "ready", messageID: "a", text: "keep" })
  })

  test("fails closed when the revert boundary is outside the loaded window", () => {
    expect(
      selectPinnedInputCandidate({
        messages: [{ id: "c", role: "user" }],
        partsByMessageID: parts({
          c: [{ type: "text", text: "loaded" }],
        }),
        hiddenIDs: new Set(),
        revertMessageID: "missing",
        historyTruncated: true,
      }),
    ).toEqual({ state: "none", reason: "truncated-revert" })
  })

  test("returns empty when no qualifying user text exists", () => {
    expect(
      selectPinnedInputCandidate({
        messages: [{ id: "a", role: "assistant" }],
        partsByMessageID: parts({}),
        hiddenIDs: new Set(),
        historyTruncated: false,
      }),
    ).toEqual({ state: "none", reason: "empty" })
  })
})

describe("derivePinnedInputBanner", () => {
  const roomy = {
    autonomousActive: false,
    contentColumns: 80,
    terminalHeight: 40,
    header: "session" as const,
    subagentRows: 0,
    previewVisibility: "offscreen" as const,
  }

  test("renders a one-line input preview with a neutral label", () => {
    const banner = derivePinnedInputBanner({ candidate: ready, ...roomy })
    expect(banner.state).toBe("visible")
    if (banner.state !== "visible") return
    expect(banner.label).toBe("Input")
    expect(banner.badge).toBeUndefined()
    expect(banner.messageID).toBe("msg_user")
    expect(banner.lines[0]).toMatch(/^Input Fix the failing session rollback test$/)
  })

  test("adds an autonomous runtime badge without claiming message provenance", () => {
    const banner = derivePinnedInputBanner({ candidate: ready, ...roomy, autonomousActive: true })
    expect(banner.state).toBe("visible")
    if (banner.state !== "visible") return
    expect(banner.badge).toBe("autonomous")
    expect(banner.lines[0]?.startsWith("Input · AUTONOMOUS ")).toBe(true)
  })

  test("keeps the banner after the turn goes idle", () => {
    const banner = derivePinnedInputBanner({ candidate: ready, ...roomy, autonomousActive: false })
    expect(banner.state).toBe("visible")
  })

  test("hides when the original preview is fully visible", () => {
    expect(derivePinnedInputBanner({ candidate: ready, ...roomy, previewVisibility: "fully-visible" })).toEqual({
      state: "hidden",
      reason: "preview-visible",
    })
  })

  test("still shows for partial, offscreen, and unknown preview geometry", () => {
    for (const previewVisibility of ["partial", "offscreen", "unknown"] as const) {
      expect(derivePinnedInputBanner({ candidate: ready, ...roomy, previewVisibility }).state).toBe("visible")
    }
  })

  test("hides when the terminal cannot keep 10 scrollback rows", () => {
    expect(
      derivePinnedInputBanner({
        candidate: ready,
        ...roomy,
        terminalHeight: 18,
        subagentRows: 8,
      }),
    ).toEqual({ state: "hidden", reason: "insufficient-space" })
  })

  test("hides pending and empty candidates", () => {
    expect(
      derivePinnedInputBanner({
        candidate: { state: "none", reason: "pending-parts" },
        ...roomy,
      }),
    ).toEqual({ state: "hidden", reason: "pending-parts" })
    expect(
      derivePinnedInputBanner({
        candidate: { state: "none", reason: "empty" },
        ...roomy,
      }),
    ).toEqual({ state: "hidden", reason: "empty" })
  })

  test("wraps a long prompt onto two lines in a wide session", () => {
    const banner = derivePinnedInputBanner({
      candidate: {
        state: "ready",
        messageID: "msg_long",
        text: "Please inspect the session rollback path and explain why empty snapshots still fail the gate",
      },
      ...roomy,
    })
    expect(banner.state).toBe("visible")
    if (banner.state !== "visible") return
    expect(banner.lineCount).toBe(2)
    expect(banner.lines[0]?.startsWith("Input ")).toBe(true)
    expect(banner.lines[1]?.startsWith("Input ")).toBe(false)
  })
})

describe("pinned input layout helpers", () => {
  test("normalizes whitespace before measuring", () => {
    expect(normalizePreviewText("  hello\n\tworld  ")).toBe("hello world")
  })

  test("truncates by terminal cell width rather than string length", () => {
    expect(truncateToCellWidth("你好世界", 3)).toBe("你…")
  })

  test("counts an expanded subagent rail including the overflow row", () => {
    expect(subagentPanelRows({ terminalHeight: 60, activeCount: 20, collapsed: false })).toBe(8)
    expect(subagentPanelRows({ terminalHeight: 60, activeCount: 2, collapsed: true })).toBe(1)
    expect(subagentPanelRows({ terminalHeight: 60, activeCount: 0, collapsed: false })).toBe(0)
  })

  test("reserves header, subagent, prompt, padding, and gaps", () => {
    expect(sessionChromeRows({ header: "hidden", subagentRows: 0 })).toBe(8)
    expect(sessionChromeRows({ header: "session", subagentRows: 3 })).toBe(18)
  })

  test("picks two lines, one line, or none from remaining scroll rows", () => {
    expect(pinnedInputMaxLines({ terminalHeight: 40, contentColumns: 80, chromeRows: 12 })).toBe(2)
    expect(pinnedInputMaxLines({ terminalHeight: 24, contentColumns: 50, chromeRows: 12 })).toBe(1)
    expect(pinnedInputMaxLines({ terminalHeight: 18, contentColumns: 80, chromeRows: 12 })).toBe(0)
  })

  test("classifies preview visibility from scroll geometry", () => {
    expect(messagePreviewVisibility({ y: 4, scrollTop: 0, viewportHeight: 20, previewRows: 2 })).toBe("fully-visible")
    expect(messagePreviewVisibility({ y: 19, scrollTop: 0, viewportHeight: 20, previewRows: 2 })).toBe("partial")
    expect(messagePreviewVisibility({ y: -4, scrollTop: 0, viewportHeight: 20, previewRows: 2 })).toBe("offscreen")
    expect(messagePreviewVisibility({ y: undefined, scrollTop: 0, viewportHeight: 20, previewRows: 2 })).toBe("unknown")
  })
})
