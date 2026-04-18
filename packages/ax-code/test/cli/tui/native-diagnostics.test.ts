import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { DiagnosticLog } from "../../../src/debug/diagnostic-log"
import { runNativeTuiSlice } from "../../../src/cli/cmd/tui/native/vertical-slice"
import { tmpdir } from "../../fixture/fixture"

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

  emitResize() {
    for (const handler of this.#handlers) handler()
  }
}

async function readJsonLines(file: string) {
  const text = await fs.readFile(file, "utf8")
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

afterEach(async () => {
  await DiagnosticLog.flush()
  await DiagnosticLog.configure({ enabled: false })
})

describe("tui native diagnostics", () => {
  test("records startup, dialog, prompt, resize, and shutdown events when debug logging is enabled", async () => {
    await using tmp = await tmpdir()
    await DiagnosticLog.configure({
      enabled: true,
      dir: tmp.path,
      manifest: { component: "test-native" },
    })

    const stdin = new FakeStdin()
    const stdout = new FakeStdout()

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
              },
            },
          ],
          connected: ["openai"],
          default: { openai: "gpt-4.1" },
        })
      }
      if (value.endsWith("/session") && init?.method === "POST") {
        return Response.json({ id: "ses_diag", title: "Diagnostics", directory: "/repo/main" })
      }
      if (value.endsWith("/session/ses_diag")) {
        return Response.json({ id: "ses_diag", title: "Diagnostics", directory: "/repo/main" })
      }
      if (value.includes("/session/ses_diag/prompt_async")) return new Response(null, { status: 202 })
      if (value.includes("/session/status")) return Response.json({ ses_diag: { type: "idle" } })
      if (value.includes("/session/ses_diag/message?limit=20")) return Response.json([])
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
    stdin.emit("\u001b")
    await new Promise((resolve) => setTimeout(resolve, 10))
    stdout.emitResize()
    await new Promise((resolve) => setTimeout(resolve, 10))
    stdin.emit("hello\r")
    await new Promise((resolve) => setTimeout(resolve, 25))
    stdin.emit("\u0003")
    await running
    await DiagnosticLog.flush()

    const processEvents = await readJsonLines(path.join(tmp.path, "process.jsonl"))
    const eventTypes = processEvents.map((event) => event.eventType)

    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "configured",
        "tui.native.started",
        "tui.native.dialogOpened",
        "tui.native.resized",
        "tui.native.promptSubmitted",
        "tui.native.promptAccepted",
        "tui.native.interrupted",
        "tui.native.stopped",
      ]),
    )
  })

  test("records backend request failures so TUI startup issues are diagnosable", async () => {
    await using tmp = await tmpdir()
    await DiagnosticLog.configure({
      enabled: true,
      dir: tmp.path,
      manifest: { component: "test-native-http" },
    })

    const stdin = new FakeStdin()
    const stdout = new FakeStdout()

    const fetch = async (url: string | URL | Request) => {
      const value = String(url)
      if (value.includes("/session")) return new Response("boom", { status: 503 })
      return Response.json({})
    }

    const running = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: {
          continue: true,
          model: "openai/gpt-4.1",
        },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 20))
    stdin.emit("\u0003")
    await running
    await DiagnosticLog.flush()

    const processEvents = await readJsonLines(path.join(tmp.path, "process.jsonl"))
    const httpFailure = processEvents.find((event) => event.eventType === "tui.native.httpError")

    expect(httpFailure).toBeTruthy()
    expect(httpFailure?.data).toMatchObject({
      method: "GET",
      pathname: "/session",
      status: 503,
    })
  })
})
