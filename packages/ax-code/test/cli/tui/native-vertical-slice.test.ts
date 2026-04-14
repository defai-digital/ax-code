import { describe, expect, test } from "bun:test"
import { parseTuiRendererName, resolveTuiRendererName } from "../../../src/cli/cmd/tui/renderer-choice"
import {
  applyNativePromptAction,
  loadNativeTranscript,
  nativeFrameLines,
  parseNativeInputActions,
  projectNativeTranscript,
  renderNativeFrame,
} from "../../../src/cli/cmd/tui/native/vertical-slice"

describe("tui native vertical slice", () => {
  test("keeps OpenTUI as the default renderer and enables native only by flag", () => {
    expect(resolveTuiRendererName(undefined)).toBe("opentui")
    expect(resolveTuiRendererName("opentui")).toBe("opentui")
    expect(resolveTuiRendererName("native")).toBe("native")
    expect(() => resolveTuiRendererName("invalid")).toThrow("Invalid TUI renderer")
    expect(parseTuiRendererName("native")).toBe("native")
    expect(() => parseTuiRendererName("invalid")).toThrow("Invalid TUI renderer")
  })

  test("projects static transcript text without renderer state", () => {
    expect(
      projectNativeTranscript([
        { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
        { info: { role: "assistant" }, parts: [{ type: "tool", tool: "bash", state: { status: "completed" } }] },
      ]),
    ).toEqual([
      { role: "user", text: "hello" },
      { role: "assistant", text: "[tool:bash] completed" },
    ])
  })

  test("loads latest session transcript for continue mode", async () => {
    const urls: string[] = []
    const fetch = async (url: string | URL | Request) => {
      urls.push(String(url))
      if (String(url).includes("/session?")) return Response.json([{ id: "ses_1" }])
      return Response.json([{ info: { role: "user" }, parts: [{ type: "text", text: "continued" }] }])
    }

    await expect(
      loadNativeTranscript({
        url: "http://opencode.internal",
        args: { continue: true },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toEqual([{ role: "user", text: "continued" }])
    expect(urls[0]).toContain("/session?limit=1")
    expect(urls[1]).toContain("/session/ses_1/message?limit=20")
  })

  test("renders a bounded first frame with prompt echo and resize dimensions", () => {
    const lines = nativeFrameLines({
      viewport: { width: 32, height: 8 },
      transcript: [{ role: "assistant", text: "ready" }],
      prompt: "next prompt",
    })

    expect(lines).toHaveLength(8)
    expect(lines[0]).toContain("(32x8)")
    expect(lines.at(-1)).toBe("> next prompt".padEnd(32, " "))
    expect(renderNativeFrame({ viewport: { width: 32, height: 8 }, transcript: [], prompt: "" })).toStartWith(
      "\x1b[H\x1b[2J",
    )
  })

  test("does not render beyond tiny terminal dimensions", () => {
    const lines = nativeFrameLines({
      viewport: { width: 10, height: 3 },
      transcript: [{ role: "assistant", text: "this line is longer than the viewport" }],
      prompt: "abcdefghi",
    })

    expect(lines).toHaveLength(3)
    expect(lines.every((line) => Array.from(line).length <= 10)).toBe(true)
    expect(lines.at(-1)).toBe("> abcdefgh")

    const zeroSizedLines = nativeFrameLines({
      viewport: { width: 0, height: 0 },
      transcript: [{ role: "assistant", text: "ready" }],
      prompt: "x",
    })
    expect(zeroSizedLines).toHaveLength(1)
    expect(Array.from(zeroSizedLines[0] ?? "")).toHaveLength(1)
  })

  test("parses fallback prompt input and applies editable echo", () => {
    const actions = parseNativeInputActions("abc\u007f\r\u0003")
    expect(actions).toEqual([
      { type: "text", text: "abc" },
      { type: "key", name: "backspace" },
      { type: "key", name: "enter" },
      { type: "key", name: "c", ctrl: true },
    ])

    let prompt = ""
    prompt = applyNativePromptAction(prompt, actions[0]!)
    prompt = applyNativePromptAction(prompt, actions[1]!)
    expect(prompt).toBe("ab")
  })

  test("maps tagged native core input events", () => {
    const core = {
      parseInputJson: () =>
        JSON.stringify([
          { type: "text", text: "a" },
          { type: "paste", text: "bc" },
          { type: "key", name: "left", ctrl: true, alt: true, shift: false },
        ]),
    }

    expect(parseNativeInputActions("ignored", core)).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "bc" },
      { type: "key", name: "left", ctrl: true, meta: true, shift: false },
    ])
  })
})
