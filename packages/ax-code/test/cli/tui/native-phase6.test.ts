import { describe, expect, test } from "bun:test"
import {
  nativeFrameLines,
  parseNativeInputActions,
  runNativeTuiSlice,
} from "../../../src/cli/cmd/tui/native/vertical-slice"

class FakeStdin {
  isTTY = true
  #handlers = new Set<(chunk: Buffer | string) => void>()

  setRawMode() {}

  resume() {}

  pause() {}

  on(event: "data", handler: (chunk: Buffer | string) => void) {
    if (event === "data") this.#handlers.add(handler)
  }

  off(event: "data", handler: (chunk: Buffer | string) => void) {
    if (event === "data") this.#handlers.delete(handler)
  }

  emit(chunk: Buffer | string) {
    for (const handler of this.#handlers) handler(chunk)
  }
}

class FakeStdout {
  columns = 72
  rows = 12
  writes: string[] = []
  #handlers = new Set<() => void>()

  write(chunk: string) {
    this.writes.push(chunk)
  }

  on(event: "resize", handler: () => void) {
    if (event === "resize") this.#handlers.add(handler)
  }

  off(event: "resize", handler: () => void) {
    if (event === "resize") this.#handlers.delete(handler)
  }
}

describe("tui native phase6", () => {
  test("parses ANSI navigation keys and renders wrapped footer metadata without ANSI bleed", () => {
    expect(parseNativeInputActions("\u001b[A\u001b[B\u001b[5~\u001b[6~\u001b[H\u001b[F\u001b")).toEqual([
      { type: "key", name: "up" },
      { type: "key", name: "down" },
      { type: "key", name: "pageup" },
      { type: "key", name: "pagedown" },
      { type: "key", name: "home" },
      { type: "key", name: "end" },
      { type: "key", name: "escape" },
    ])

    const lines = nativeFrameLines({
      viewport: { width: 56, height: 8 },
      transcript: [
        {
          role: "assistant",
          text: "\u001b[31m紅色輸出\u001b[0m with a very long line that should wrap cleanly",
        },
      ],
      prompt: "",
      currentAgent: "plan",
      currentModel: { providerID: "openai", modelID: "gpt-5" },
      sessionInfo: { id: "ses_1", title: "Feature session", directory: "/repo/worktrees/feature" },
      localDirectory: "/repo/main",
      scrollOffset: 1,
    })

    expect(lines[0]).toContain("Workspace feature")
    expect(lines.at(-2)).toContain("Agent plan")
    expect(lines.at(-2)).toContain("Scroll -1")
    expect(lines.join("\n")).toContain("assistant: 紅色輸出")
    expect(lines.join("\n")).not.toContain("\u001b[31m")
  })

  test("opens the command palette and switches the active model before prompt submit", async () => {
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const promptBodies: any[] = []

    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      if (value.includes("/config/providers")) {
        return Response.json({
          providers: [{ id: "openai", models: { "gpt-4.1": {}, "gpt-5": {} } }],
          default: { openai: "gpt-4.1" },
        })
      }
      if (value.endsWith("/config")) return Response.json({})
      if (value.endsWith("/provider")) {
        return Response.json({
          all: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" },
                "gpt-5": { id: "gpt-5", name: "GPT-5" },
              },
            },
          ],
          connected: ["openai"],
          default: { openai: "gpt-4.1" },
        })
      }
      if (value.endsWith("/session") && init?.method === "POST") {
        return Response.json({ id: "ses_model", title: "Model Session", directory: "/repo/main" })
      }
      if (value.endsWith("/session/ses_model")) {
        return Response.json({ id: "ses_model", title: "Model Session", directory: "/repo/main" })
      }
      if (value.includes("/session/ses_model/prompt_async")) {
        promptBodies.push(JSON.parse(String(init?.body ?? "{}")))
        return new Response(null, { status: 202 })
      }
      if (value.includes("/session/status")) return Response.json({ ses_model: { type: "idle" } })
      if (value.includes("/session/ses_model/message?limit=20")) return Response.json([])
      if (value.endsWith("/permission")) return Response.json([])
      if (value.endsWith("/question")) return Response.json([])
      return Response.json([])
    }

    const running = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: {},
        config: {},
        fetch: fetch as typeof globalThis.fetch,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    stdin.emit("/commands\r")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(stdout.writes.some((chunk) => chunk.includes("dialog: Commands"))).toBe(true)

    stdin.emit("5\r")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(stdout.writes.some((chunk) => chunk.includes("dialog: Select model"))).toBe(true)

    stdin.emit("2\r")
    await new Promise((resolve) => setTimeout(resolve, 10))
    stdin.emit("hello\r")
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(promptBodies).toHaveLength(1)
    expect(promptBodies[0]?.model).toEqual({ providerID: "openai", modelID: "gpt-5" })

    stdin.emit("\u0003")
    await running
  })

  test("provider and agent dialogs feed the selected provider/model and agent into prompt_async", async () => {
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const promptBodies: any[] = []

    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      if (value.includes("/config/providers")) {
        return Response.json({
          providers: [{ id: "openai", models: { "gpt-4.1": {} } }],
          default: { openai: "gpt-4.1" },
        })
      }
      if (value.endsWith("/config")) return Response.json({})
      if (value.endsWith("/provider")) {
        return Response.json({
          all: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" },
                "gpt-5": { id: "gpt-5", name: "GPT-5" },
              },
            },
          ],
          connected: ["openai"],
          default: { openai: "gpt-4.1" },
        })
      }
      if (value.endsWith("/agent")) {
        return Response.json([
          {
            name: "build",
            displayName: "Build",
            description: "Default",
            model: { providerID: "openai", modelID: "gpt-4.1" },
          },
          { name: "plan", displayName: "Plan", description: "Planner" },
        ])
      }
      if (value.endsWith("/session") && init?.method === "POST") {
        return Response.json({ id: "ses_agent", title: "Agent Session", directory: "/repo/main" })
      }
      if (value.endsWith("/session/ses_agent")) {
        return Response.json({ id: "ses_agent", title: "Agent Session", directory: "/repo/main" })
      }
      if (value.includes("/session/ses_agent/prompt_async")) {
        promptBodies.push(JSON.parse(String(init?.body ?? "{}")))
        return new Response(null, { status: 202 })
      }
      if (value.includes("/session/status")) return Response.json({ ses_agent: { type: "idle" } })
      if (value.includes("/session/ses_agent/message?limit=20")) return Response.json([])
      if (value.endsWith("/permission")) return Response.json([])
      if (value.endsWith("/question")) return Response.json([])
      return Response.json([])
    }

    const running = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: {},
        config: {},
        fetch: fetch as typeof globalThis.fetch,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    stdin.emit("/provider\r")
    await new Promise((resolve) => setTimeout(resolve, 10))
    stdin.emit("1\r")
    await new Promise((resolve) => setTimeout(resolve, 10))
    stdin.emit("2\r")
    await new Promise((resolve) => setTimeout(resolve, 10))

    stdin.emit("/agent\r")
    await new Promise((resolve) => setTimeout(resolve, 10))
    stdin.emit("2\r")
    await new Promise((resolve) => setTimeout(resolve, 10))

    stdin.emit("ship it\r")
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(promptBodies).toHaveLength(1)
    expect(promptBodies[0]?.model).toEqual({ providerID: "openai", modelID: "gpt-5" })
    expect(promptBodies[0]?.agent).toBe("plan")
    expect(stdout.writes.at(-1)).toContain("Agent plan")

    stdin.emit("\u0003")
    await running
  })

  test("session dialog switches transcript and session header metadata", async () => {
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()

    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      if (value.endsWith("/config")) return Response.json({})
      if (value.includes("/config/providers")) {
        return Response.json({
          providers: [{ id: "openai", models: { "gpt-4.1": {} } }],
          default: { openai: "gpt-4.1" },
        })
      }
      if (value.includes("/session?roots=true&limit=30")) {
        return Response.json([
          { id: "ses_old", title: "Old Session", directory: "/repo/main", time: { updated: 1 } },
          { id: "ses_new", title: "New Session", directory: "/repo/worktrees/feature", time: { updated: 2 } },
        ])
      }
      if (value.includes("/session/ses_new") && !value.includes("/message")) {
        return Response.json({ id: "ses_new", title: "New Session", directory: "/repo/worktrees/feature" })
      }
      if (value.includes("/session/ses_new/message?limit=20")) {
        return Response.json([{ info: { role: "assistant" }, parts: [{ type: "text", text: "feature transcript" }] }])
      }
      if (value.endsWith("/permission?directory=%2Frepo%2Fworktrees%2Ffeature")) return Response.json([])
      if (value.endsWith("/question?directory=%2Frepo%2Fworktrees%2Ffeature")) return Response.json([])
      return Response.json([])
    }

    const running = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: {},
        config: {},
        directory: "/repo/main",
        fetch: fetch as typeof globalThis.fetch,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    stdin.emit("/session\r")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(stdout.writes.some((chunk) => chunk.includes("dialog: Sessions"))).toBe(true)

    stdin.emit("2\r")
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(stdout.writes.at(-1)).toContain("feature transcript")
    expect(stdout.writes.at(-1)).toContain("Workspace feature")
    expect(stdout.writes.at(-1)).toContain("New Session")

    stdin.emit("\u0003")
    await running
  })
})
