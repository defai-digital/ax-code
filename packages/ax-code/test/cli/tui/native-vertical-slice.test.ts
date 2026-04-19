import { describe, expect, test } from "bun:test"
import path from "node:path"
import { parseTuiRendererName, resolveTuiRendererName } from "../../../src/cli/cmd/tui/renderer-choice"
import {
  applyNativePromptAction,
  loadNativeTranscript,
  nativeFrameLines,
  parseNativeInputActions,
  projectNativeTranscript,
  renderNativeFrame,
  runNativeTuiSlice,
} from "../../../src/cli/cmd/tui/native/vertical-slice"

describe("tui native vertical slice", () => {
  test("keeps OpenTUI as the default renderer without a promotion manifest and enables native only by flag", () => {
    const manifestPath = path.join(import.meta.dir, "__missing_renderer_manifest__.json")

    expect(resolveTuiRendererName(undefined, { manifestPath })).toBe("opentui")
    expect(resolveTuiRendererName("opentui", { manifestPath })).toBe("opentui")
    expect(resolveTuiRendererName("native", { manifestPath })).toBe("opentui")
    expect(resolveTuiRendererName("native", { nativeEnabled: "1", manifestPath })).toBe("native")
    expect(() => resolveTuiRendererName("invalid")).toThrow("Invalid TUI renderer")
    expect(parseTuiRendererName("native")).toBe("native")
    expect(() => parseTuiRendererName("invalid")).toThrow("Invalid TUI renderer")
  })

  test("projects static transcript text without renderer state", () => {
    expect(
      projectNativeTranscript([
        {
          info: { role: "user" },
          parts: [
            { type: "text", text: "hello" },
            { type: "text", text: "synthetic", synthetic: true },
            { type: "text", text: "ignored", ignored: true },
          ],
        },
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

  test("forks the selected session before loading transcript", async () => {
    const urls: string[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(`${init?.method ?? "GET"} ${String(url)}`)
      if (String(url).includes("/session?")) return Response.json([{ id: "ses_parent" }])
      if (String(url).includes("/session/ses_parent/fork")) return Response.json({ id: "ses_fork" })
      return Response.json([{ info: { role: "assistant" }, parts: [{ type: "text", text: "forked" }] }])
    }

    await expect(
      loadNativeTranscript({
        url: "http://opencode.internal",
        args: { continue: true, fork: true },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toEqual([{ role: "assistant", text: "forked" }])
    expect(urls[0]).toContain("GET http://opencode.internal/session?limit=1")
    expect(urls[1]).toContain("POST http://opencode.internal/session/ses_parent/fork")
    expect(urls[2]).toContain("GET http://opencode.internal/session/ses_fork/message?limit=20")
  })

  test("falls back to the original session when forking fails", async () => {
    const urls: string[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(`${init?.method ?? "GET"} ${String(url)}`)
      if (String(url).includes("/session?")) return Response.json([{ id: "ses_parent" }])
      if (String(url).includes("/session/ses_parent/fork")) return new Response("nope", { status: 500 })
      return Response.json([{ info: { role: "assistant" }, parts: [{ type: "text", text: "original" }] }])
    }

    await expect(
      loadNativeTranscript({
        url: "http://opencode.internal",
        args: { continue: true, fork: true },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toEqual([{ role: "assistant", text: "original" }])
    expect(urls[2]).toContain("GET http://opencode.internal/session/ses_parent/message?limit=20")
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

  test("renders session busy status in the native footer", () => {
    const lines = nativeFrameLines({
      viewport: { width: 64, height: 8 },
      transcript: [],
      prompt: "",
      sessionStatus: {
        type: "busy",
        waitState: "tool",
        activeTool: "bash",
        startedAt: Date.now() - 12_000,
      },
    })

    expect(lines.join("\n")).toContain("Running Bash")
  })

  test("renders blocking permission, question, and workspace overlays above the prompt", () => {
    const permissionLines = nativeFrameLines({
      viewport: { width: 40, height: 8 },
      transcript: [{ role: "assistant", text: "ready" }],
      prompt: "ignored",
      permissionState: {
        request: {
          id: "perm_1",
          sessionID: "ses_1",
          permission: "bash",
          patterns: ["git status"],
        },
        editingReject: false,
        rejectMessage: "",
      },
    })
    expect(permissionLines.join("\n")).toContain("permission: bash")
    expect(permissionLines.at(-1)).toContain("permission pending")

    const permissionRejectLines = nativeFrameLines({
      viewport: { width: 48, height: 9 },
      transcript: [],
      prompt: "ignored",
      permissionState: {
        request: {
          id: "perm_2",
          sessionID: "ses_1",
          permission: "edit",
          patterns: ["src/app.ts"],
        },
        editingReject: true,
        rejectMessage: "Use a safer edit",
      },
    })
    expect(permissionRejectLines.join("\n")).toContain("note: Use a safer edit")
    expect(permissionRejectLines.at(-1)).toContain("type reject note")

    const questionLines = nativeFrameLines({
      viewport: { width: 40, height: 9 },
      transcript: [],
      prompt: "ignored",
      questionState: {
        request: {
          id: "q_1",
          sessionID: "ses_1",
          questions: [
            {
              header: "Mode",
              question: "How should this run?",
              options: [
                { label: "Fast", description: "Return quickly" },
                { label: "Deep", description: "Inspect more" },
              ],
            },
          ],
        },
        index: 0,
        answers: [[]],
        selection: 1,
        customAnswers: [""],
        editingCustom: false,
      },
    })
    expect(questionLines.join("\n")).toContain("question 1/1: Mode")
    expect(questionLines.join("\n")).toContain("* 2. Deep - Inspect more")
    expect(questionLines.at(-1)).toContain("select 1-9")

    const multiQuestionLines = nativeFrameLines({
      viewport: { width: 48, height: 10 },
      transcript: [],
      prompt: "ignored",
      questionState: {
        request: {
          id: "q_2",
          sessionID: "ses_1",
          questions: [
            {
              header: "Actions",
              question: "Which actions should run?",
              multiple: true,
              custom: true,
              options: [
                { label: "Tests", description: "Run the test suite" },
                { label: "Lint", description: "Run lint checks" },
              ],
            },
          ],
        },
        index: 0,
        answers: [["Tests", "Local note"]],
        selection: 1,
        customAnswers: ["Local note"],
        editingCustom: false,
      },
    })
    expect(multiQuestionLines.join("\n")).toContain("? * 2. [ ] Lint - Run lint checks")
    expect(multiQuestionLines.join("\n")).toContain("?   0. [x] Type your own answer - Local note")
    expect(multiQuestionLines.at(-1)).toContain("toggle 1-9, 0 custom, Enter next")

    const workspaceLines = nativeFrameLines({
      viewport: { width: 64, height: 10 },
      transcript: [],
      prompt: "ignored",
      workspaceState: {
        entries: [
          { id: "local", title: "Local workspace", directory: "/repo/main" },
          { id: "/repo/worktrees/feature", title: "feature", directory: "/repo/worktrees/feature" },
        ],
        selection: 1,
        loading: false,
        localDirectory: "/repo/main",
        currentDirectory: "/repo/worktrees/feature",
      },
    })
    expect(workspaceLines.join("\n")).toContain("workspace: select target")
    expect(workspaceLines.join("\n")).toContain("* 2. feature - /repo/worktrees/feature (current)")
    expect(workspaceLines.at(-1)).toContain("Enter to open")
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

  test("submits prompts and refreshes transcript from session events", async () => {
    class TestStdin {
      isTTY = true
      rawMode: boolean[] = []
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode(value: boolean) {
        this.rawMode.push(value)
      }

      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 48
      rows = 8
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    const handlers = new Set<(event: any) => void>()
    const events = {
      on(handler: (event: any) => void) {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }
    const emit = (event: any) => {
      for (const handler of [...handlers]) handler(event)
    }

    const promptBodies: any[] = []
    let transcript: any[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      if (value.includes("/session/ses_native/message?limit=20")) return Response.json(transcript)
      if (value.endsWith("/session")) return Response.json({ id: "ses_native" })
      if (value.includes("/session/ses_native/prompt_async")) {
        promptBodies.push(JSON.parse(String(init?.body ?? "{}")))
        return new Response(null, { status: 202 })
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: { model: "openai/gpt-5" },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
        events,
      },
      {
        stdin,
        stdout,
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    stdin.emit("hi\r")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(promptBodies).toHaveLength(1)
    expect(promptBodies[0]).toEqual({
      model: { providerID: "openai", modelID: "gpt-5" },
      parts: [{ type: "text", text: "hi" }],
    })

    transcript = [
      { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] },
    ]
    emit({
      type: "message.part.updated",
      properties: {
        part: {
          sessionID: "ses_native",
          type: "text",
        },
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(stdout.writes.at(-1)).toContain("assistant: done")

    stdin.emit("\u0003")
    await done
  })

  test("polls for transcript updates when no event source is available", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 48
      rows = 8
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    let messageReads = 0
    let statusReads = 0
    const fetch = async (url: string | URL | Request) => {
      const value = String(url)
      if (value.endsWith("/session")) return Response.json({ id: "ses_poll" })
      if (value.includes("/session/ses_poll/prompt_async")) return new Response(null, { status: 202 })
      if (value.includes("/session/ses_poll/message?limit=20")) {
        messageReads += 1
        if (messageReads === 1) {
          return Response.json([{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] }])
        }
        return Response.json([
          { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
          { info: { role: "assistant" }, parts: [{ type: "text", text: "world" }] },
        ])
      }
      if (value.includes("/session/status")) {
        statusReads += 1
        return Response.json({
          ses_poll: {
            type: statusReads === 1 ? "running" : "idle",
          },
        })
      }
      throw new Error(`Unexpected request: ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: { model: "openai/gpt-5" },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
      },
      {
        stdin,
        stdout,
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    stdin.emit("hello\r")
    await new Promise((resolve) => setTimeout(resolve, 325))

    expect(statusReads).toBeGreaterThanOrEqual(1)
    expect(stdout.writes.at(-1)).toContain("assistant: world")

    stdin.emit("\u0003")
    await done
  })

  test("uses server-side default model selection and forwards Headers instances", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 48
      rows = 8
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    const seenAuth: string[] = []
    const promptBodies: any[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      const auth = new Headers(init?.headers).get("authorization")
      if (auth) seenAuth.push(auth)

      if (value.includes("/config/providers")) {
        return Response.json({
          providers: [{ id: "server", models: { "model-a": {}, "model-b": {} } }],
          default: { server: "model-b" },
        })
      }
      if (value.endsWith("/config")) return Response.json({})
      if (value.endsWith("/session")) return Response.json({ id: "ses_remote" })
      if (value.includes("/session/ses_remote/prompt_async")) {
        promptBodies.push(JSON.parse(String(init?.body ?? "{}")))
        return new Response(null, { status: 202 })
      }
      if (value.includes("/session/status")) return Response.json({ ses_remote: { type: "idle" } })
      if (value.includes("/session/ses_remote/message?limit=20")) return Response.json([])
      throw new Error(`Unexpected request: ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://remote.ax-code.test",
        args: {},
        config: {},
        fetch: fetch as typeof globalThis.fetch,
        headers: new Headers({ Authorization: "Bearer remote-token" }),
      },
      {
        stdin,
        stdout,
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    stdin.emit("remote\r")
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(promptBodies).toHaveLength(1)
    expect(promptBodies[0]).toEqual({
      model: { providerID: "server", modelID: "model-b" },
      parts: [{ type: "text", text: "remote" }],
    })
    expect(seenAuth.length).toBeGreaterThan(0)
    expect(seenAuth.every((value) => value === "Bearer remote-token")).toBe(true)

    stdin.emit("\u0003")
    await done
  })

  test("switches worker workspace to the resolved session directory before loading blocking state", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 48
      rows = 8
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    const workspaceCalls: Array<string | undefined> = []
    const urls: string[] = []
    const events = {
      on() {
        return () => {}
      },
      setWorkspace(workspaceID?: string) {
        workspaceCalls.push(workspaceID)
      },
    }
    const fetch = async (url: string | URL | Request) => {
      const value = String(url)
      urls.push(value)
      if (value.endsWith("/session/ses_route")) {
        return Response.json({ id: "ses_route", directory: "/repo/worktrees/feature" })
      }
      if (value.includes("/session/ses_route/message?limit=20&directory=%2Frepo%2Fworktrees%2Ffeature")) {
        return Response.json([])
      }
      if (value.endsWith("/permission?directory=%2Frepo%2Fworktrees%2Ffeature")) return Response.json([])
      if (value.endsWith("/question?directory=%2Frepo%2Fworktrees%2Ffeature")) return Response.json([])
      throw new Error(`Unexpected request: ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: { sessionID: "ses_route" },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
        events,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(workspaceCalls).toEqual(["/repo/worktrees/feature"])
    expect(urls).toContain("http://opencode.internal/session/ses_route")
    expect(urls.some((value) => value.includes("directory=%2Frepo%2Fworktrees%2Ffeature"))).toBe(true)

    stdin.emit("\u0003")
    await done
  })

  test("switches worker workspace to the forked session directory during startup continue flow", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 48
      rows = 8
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    const workspaceCalls: Array<string | undefined> = []
    const urls: string[] = []
    const events = {
      on() {
        return () => {}
      },
      setWorkspace(workspaceID?: string) {
        workspaceCalls.push(workspaceID)
      },
    }
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      urls.push(`${init?.method ?? "GET"} ${value}`)
      if (value.endsWith("/session?limit=1")) return Response.json([{ id: "ses_parent", directory: "/repo/main" }])
      if (value.endsWith("/session/ses_parent/fork")) {
        return Response.json({ id: "ses_fork", directory: "/repo/worktrees/feature" })
      }
      if (value.includes("/session/ses_fork/message?limit=20&directory=%2Frepo%2Fworktrees%2Ffeature")) {
        return Response.json([])
      }
      if (value.endsWith("/permission?directory=%2Frepo%2Fworktrees%2Ffeature")) return Response.json([])
      if (value.endsWith("/question?directory=%2Frepo%2Fworktrees%2Ffeature")) return Response.json([])
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: { continue: true, fork: true },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
        events,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(workspaceCalls).toEqual(["/repo/worktrees/feature"])
    expect(urls).toContain("POST http://opencode.internal/session/ses_parent/fork")
    expect(urls.some((value) => value.includes("directory=%2Frepo%2Fworktrees%2Ffeature"))).toBe(true)

    stdin.emit("\u0003")
    await done
  })

  test("switches worker workspace after creating a new session from prompt input", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 48
      rows = 8
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    const workspaceCalls: Array<string | undefined> = []
    const urls: string[] = []
    const events = {
      on() {
        return () => {}
      },
      setWorkspace(workspaceID?: string) {
        workspaceCalls.push(workspaceID)
      },
    }
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      urls.push(`${init?.method ?? "GET"} ${value}`)
      if (value.includes("/config/providers")) {
        return Response.json({
          providers: [{ id: "server", models: { "model-a": {} } }],
          default: { server: "model-a" },
        })
      }
      if (value.endsWith("/config")) return Response.json({})
      if (value.endsWith("/session")) return Response.json({ id: "ses_new", directory: "/repo/worktrees/new" })
      if (value.includes("/session/ses_new/prompt_async")) return new Response(null, { status: 202 })
      if (value.includes("/session/status?directory=%2Frepo%2Fworktrees%2Fnew")) {
        return Response.json({ ses_new: { type: "idle" } })
      }
      if (value.includes("/session/ses_new/message?limit=20&directory=%2Frepo%2Fworktrees%2Fnew")) {
        return Response.json([])
      }
      if (value.endsWith("/permission?directory=%2Frepo%2Fworktrees%2Fnew")) return Response.json([])
      if (value.endsWith("/question?directory=%2Frepo%2Fworktrees%2Fnew")) return Response.json([])
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: {},
        config: {},
        fetch: fetch as typeof globalThis.fetch,
        events,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    stdin.emit("hello\r")
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(workspaceCalls).toEqual(["/repo/worktrees/new"])
    expect(urls.some((value) => value.includes("directory=%2Frepo%2Fworktrees%2Fnew"))).toBe(true)

    stdin.emit("\u0003")
    await done
  })

  test("opens the workspace picker and switches to the selected workspace session", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 72
      rows = 12
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    const workspaceCalls: Array<string | undefined> = []
    const events = {
      on() {
        return () => {}
      },
      setWorkspace(workspaceID?: string) {
        workspaceCalls.push(workspaceID)
      },
    }
    const fetch = async (url: string | URL | Request) => {
      const value = String(url)
      if (value.endsWith("/worktree?directory=%2Frepo%2Fmain")) {
        return Response.json(["/repo/worktrees/feature"])
      }
      if (value.includes("/session?roots=true&limit=1&directory=%2Frepo%2Fworktrees%2Ffeature")) {
        return Response.json([{ id: "ses_feature", directory: "/repo/worktrees/feature" }])
      }
      if (value.includes("/session/ses_feature/message?limit=20&directory=%2Frepo%2Fworktrees%2Ffeature")) {
        return Response.json([{ info: { role: "assistant" }, parts: [{ type: "text", text: "feature ready" }] }])
      }
      if (value.endsWith("/permission?directory=%2Frepo%2Fworktrees%2Ffeature")) return Response.json([])
      if (value.endsWith("/question?directory=%2Frepo%2Fworktrees%2Ffeature")) return Response.json([])
      throw new Error(`Unexpected request: ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: {},
        config: {},
        directory: "/repo/main",
        fetch: fetch as typeof globalThis.fetch,
        events,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    stdin.emit("/workspace\r")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(stdout.writes.some((chunk) => chunk.includes("workspace: select target"))).toBe(true)

    stdin.emit("2\r")
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(workspaceCalls).toEqual(["/repo/worktrees/feature"])
    expect(stdout.writes.at(-1)).toContain("assistant: feature ready")

    stdin.emit("\u0003")
    await done
  })

  test("returns to the local workspace from the picker when local is selected", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 72
      rows = 12
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    const workspaceCalls: Array<string | undefined> = []
    const events = {
      on() {
        return () => {}
      },
      setWorkspace(workspaceID?: string) {
        workspaceCalls.push(workspaceID)
      },
    }
    const fetch = async (url: string | URL | Request) => {
      const value = String(url)
      if (value.endsWith("/session/ses_feature")) {
        return Response.json({ id: "ses_feature", directory: "/repo/worktrees/feature" })
      }
      if (value.includes("/session/ses_feature/message?limit=20&directory=%2Frepo%2Fworktrees%2Ffeature")) {
        return Response.json([{ info: { role: "assistant" }, parts: [{ type: "text", text: "feature ready" }] }])
      }
      if (value.endsWith("/permission?directory=%2Frepo%2Fworktrees%2Ffeature")) return Response.json([])
      if (value.endsWith("/question?directory=%2Frepo%2Fworktrees%2Ffeature")) return Response.json([])
      if (value.endsWith("/worktree?directory=%2Frepo%2Fworktrees%2Ffeature")) {
        return Response.json(["/repo/worktrees/feature"])
      }
      if (value.endsWith("/session?roots=true&limit=1")) return Response.json([])
      throw new Error(`Unexpected request: ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: { sessionID: "ses_feature" },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
        events,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(workspaceCalls).toEqual(["/repo/worktrees/feature"])

    stdin.emit("/workspace\r")
    await new Promise((resolve) => setTimeout(resolve, 10))
    stdin.emit("1\r")
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(workspaceCalls).toEqual(["/repo/worktrees/feature", undefined])
    expect(stdout.writes.at(-1)).not.toContain("assistant: feature ready")

    stdin.emit("\u0003")
    await done
  })

  test("replies to pending permission requests from native input", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 48
      rows = 8
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    const handlers = new Set<(event: any) => void>()
    const events = {
      on(handler: (event: any) => void) {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }
    const emit = (event: any) => {
      for (const handler of [...handlers]) handler(event)
    }

    const replies: any[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      if (value.includes("/session/ses_perm/message?limit=20")) return Response.json([])
      if (value.endsWith("/permission")) return Response.json([])
      if (value.endsWith("/question")) return Response.json([])
      if (value.includes("/permission/perm_1/reply")) {
        replies.push(JSON.parse(String(init?.body ?? "{}")))
        return Response.json(true)
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: { sessionID: "ses_perm" },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
        events,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    emit({
      type: "permission.asked",
      properties: {
        id: "perm_1",
        sessionID: "ses_perm",
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(stdout.writes.at(-1)).toContain("permission: bash")

    stdin.emit("y")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(replies).toEqual([{ reply: "once" }])

    stdin.emit("\u0003")
    await done
  })

  test("replies to pending permission requests with a correction note from native input", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 56
      rows = 10
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    const handlers = new Set<(event: any) => void>()
    const events = {
      on(handler: (event: any) => void) {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }
    const emit = (event: any) => {
      for (const handler of [...handlers]) handler(event)
    }

    const replies: any[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      if (value.includes("/session/ses_perm_note/message?limit=20")) return Response.json([])
      if (value.endsWith("/permission")) return Response.json([])
      if (value.endsWith("/question")) return Response.json([])
      if (value.includes("/permission/perm_note/reply")) {
        replies.push(JSON.parse(String(init?.body ?? "{}")))
        return Response.json(true)
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: { sessionID: "ses_perm_note" },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
        events,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    emit({
      type: "permission.asked",
      properties: {
        id: "perm_note",
        sessionID: "ses_perm_note",
        permission: "edit",
        patterns: ["src/app.ts"],
        metadata: {},
        always: [],
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    stdin.emit("m")
    stdin.emit("Use a safer edit")
    stdin.emit("\r")
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(replies).toEqual([{ reply: "reject", message: "Use a safer edit" }])
    expect(stdout.writes.some((chunk) => chunk.includes("type reject note"))).toBe(true)

    stdin.emit("\u0003")
    await done
  })

  test("replies to pending question requests from native input", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 56
      rows = 10
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    const handlers = new Set<(event: any) => void>()
    const events = {
      on(handler: (event: any) => void) {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }
    const emit = (event: any) => {
      for (const handler of [...handlers]) handler(event)
    }

    const replies: any[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      if (value.includes("/session/ses_q/message?limit=20")) return Response.json([])
      if (value.endsWith("/permission")) return Response.json([])
      if (value.endsWith("/question")) return Response.json([])
      if (value.includes("/question/q_1/reply")) {
        replies.push(JSON.parse(String(init?.body ?? "{}")))
        return Response.json(true)
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: { sessionID: "ses_q" },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
        events,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    emit({
      type: "question.asked",
      properties: {
        id: "q_1",
        sessionID: "ses_q",
        questions: [
          {
            header: "Mode",
            question: "How should this run?",
            options: [
              { label: "Fast", description: "Return quickly" },
              { label: "Deep", description: "Inspect more" },
            ],
          },
        ],
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(stdout.writes.at(-1)).toContain("question 1/1: Mode")

    stdin.emit("2\r")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(replies).toEqual([{ answers: [["Deep"]] }])

    stdin.emit("\u0003")
    await done
  })

  test("replies to pending multi-select questions with custom answers from native input", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 64
      rows = 12
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    const handlers = new Set<(event: any) => void>()
    const events = {
      on(handler: (event: any) => void) {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }
    const emit = (event: any) => {
      for (const handler of [...handlers]) handler(event)
    }

    const replies: any[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      if (value.includes("/session/ses_q_multi/message?limit=20")) return Response.json([])
      if (value.endsWith("/permission")) return Response.json([])
      if (value.endsWith("/question")) return Response.json([])
      if (value.includes("/question/q_multi/reply")) {
        replies.push(JSON.parse(String(init?.body ?? "{}")))
        return Response.json(true)
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: { sessionID: "ses_q_multi" },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
        events,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    emit({
      type: "question.asked",
      properties: {
        id: "q_multi",
        sessionID: "ses_q_multi",
        questions: [
          {
            header: "Actions",
            question: "Which actions should run?",
            multiple: true,
            custom: true,
            options: [
              { label: "Tests", description: "Run the test suite" },
              { label: "Lint", description: "Run lint checks" },
            ],
          },
        ],
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    stdin.emit("1")
    stdin.emit("0")
    stdin.emit("Local note")
    stdin.emit("\r")
    stdin.emit("\r")
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(replies).toEqual([{ answers: [["Tests", "Local note"]] }])
    expect(stdout.writes.some((chunk) => chunk.includes("toggle 1-9, 0 custom, Enter next"))).toBe(true)

    stdin.emit("\u0003")
    await done
  })

  test("loads pending blocking requests from list endpoints and prefers permission before question", async () => {
    class TestStdin {
      isTTY = true
      private handlers = new Set<(chunk: Buffer | string) => void>()

      setRawMode() {}
      resume() {}
      pause() {}

      on(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.add(handler)
      }

      off(_event: "data", handler: (chunk: Buffer | string) => void) {
        this.handlers.delete(handler)
      }

      emit(chunk: string) {
        for (const handler of [...this.handlers]) handler(chunk)
      }
    }

    class TestStdout {
      columns = 56
      rows = 10
      writes: string[] = []

      write(chunk: string) {
        this.writes.push(chunk)
        return true
      }

      on() {}
      off() {}
    }

    let permissionResolved = false
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      if (value.includes("/session/ses_blocked/message?limit=20")) return Response.json([])
      if (value.endsWith("/permission")) {
        return Response.json(
          permissionResolved
            ? []
            : [
                {
                  id: "perm_1",
                  sessionID: "ses_blocked",
                  permission: "bash",
                  patterns: ["git status"],
                  metadata: {},
                  always: [],
                },
              ],
        )
      }
      if (value.endsWith("/question")) {
        return Response.json([
          {
            id: "q_1",
            sessionID: "ses_blocked",
            questions: [
              {
                header: "Mode",
                question: "How should this run?",
                options: [
                  { label: "Fast", description: "Return quickly" },
                  { label: "Deep", description: "Inspect more" },
                ],
              },
            ],
          },
        ])
      }
      if (value.includes("/permission/perm_1/reply")) {
        permissionResolved = true
        return Response.json(true)
      }
      if (value.includes("/question/q_1/reply")) return Response.json(true)
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${value}`)
    }

    const stdin = new TestStdin()
    const stdout = new TestStdout()
    const done = runNativeTuiSlice(
      {
        url: "http://opencode.internal",
        args: { sessionID: "ses_blocked" },
        config: {},
        fetch: fetch as typeof globalThis.fetch,
      },
      { stdin, stdout },
    )

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(stdout.writes.at(-1)).toContain("permission: bash")

    stdin.emit("y")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(stdout.writes.at(-1)).toContain("question 1/1: Mode")

    stdin.emit("1\r")
    await new Promise((resolve) => setTimeout(resolve, 20))

    stdin.emit("\u0003")
    await done
  })
})
