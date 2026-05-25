import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  applyHeadlessProjectionEvent,
  createHeadlessClient,
  createHeadlessProjectionState,
  HEADLESS_RUNTIME_SCHEMA_VERSION,
  startHeadlessBackend,
} from "../src/headless.js"

const originalPath = process.env.PATH
const originalPidFile = process.env.AX_CODE_FAKE_PID_FILE
const originalTermFile = process.env.AX_CODE_FAKE_TERM_FILE
const originalAuthFile = process.env.AX_CODE_FAKE_AUTH_FILE
const originalArgsFile = process.env.AX_CODE_FAKE_ARGS_FILE

afterEach(() => {
  process.env.PATH = originalPath
  setEnv("AX_CODE_FAKE_PID_FILE", originalPidFile)
  setEnv("AX_CODE_FAKE_TERM_FILE", originalTermFile)
  setEnv("AX_CODE_FAKE_AUTH_FILE", originalAuthFile)
  setEnv("AX_CODE_FAKE_ARGS_FILE", originalArgsFile)
})

describe("headless backend lifecycle", () => {
  test("starts with generated auth, verifies health, and terminates the backend", async () => {
    await using fake = await createReadyFakeAxCode()
    const healthRequests: Request[] = []

    const backend = await startHeadlessBackend({
      auth: { username: "app", password: "secret" },
      fetch: (async (input: URL | RequestInfo, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        healthRequests.push(request)
        return new Response(JSON.stringify({ healthy: true }), {
          headers: { "content-type": "application/json" },
        })
      }) as typeof fetch,
    })

    expect(backend.url).toBe("http://127.0.0.1:18456")
    expect(backend.headers.Authorization).toBe("Basic " + Buffer.from("app:secret").toString("base64"))
    expect(healthRequests.map((request) => new URL(request.url).pathname)).toEqual(["/global/health"])
    expect(healthRequests[0].headers.get("authorization")).toBe(backend.headers.Authorization)
    expect(await waitForFile(fake.authFile)).toBe("app:secret\n")
    expect(await waitForFile(fake.argsFile)).toContain("serve --hostname=127.0.0.1 --port=0")

    await backend.close()

    await waitForProcessExit(Number(await waitForFile(fake.pidFile)))
  })

  test("kills the backend when health readiness fails", async () => {
    await using fake = await createReadyFakeAxCode()

    await expect(
      startHeadlessBackend({
        timeout: 1_000,
        fetch: (async () => new Response("not ready", { status: 503 })) as typeof fetch,
      }),
    ).rejects.toThrow("ax-code backend health check failed (503): not ready")

    await waitForProcessExit(Number(await waitForFile(fake.pidFile)))
  })

  test("external app smoke uses only public headless exports", async () => {
    await using fake = await createReadyFakeAxCode()
    const calls: string[] = []
    const fetchFn = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      calls.push(`${request.method} ${url.pathname}`)

      if (url.pathname === "/global/health") {
        return jsonResponse({ healthy: true })
      }
      if (request.method === "POST" && url.pathname === "/session") {
        return jsonResponse({ id: "sess-1", title: "App smoke" })
      }
      if (request.method === "POST" && url.pathname === "/session/sess-1/prompt_async") {
        return new Response("", { status: 202 })
      }
      if (request.method === "GET" && url.pathname === "/event") {
        return sseResponse([
          { type: "server.connected", properties: {} },
          { type: "session.created", properties: { info: { id: "sess-1", title: "App smoke" } } },
          { type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } },
        ])
      }
      return new Response("unexpected route", { status: 404 })
    }) as typeof fetch

    const backend = await startHeadlessBackend({ fetch: fetchFn })
    try {
      const client = createHeadlessClient({ baseUrl: backend.url, headers: backend.headers, fetch: fetchFn })
      const state = createHeadlessProjectionState<
        { id: string; title?: string },
        unknown,
        unknown,
        { type: string },
        { id: string; sessionID: string },
        { id: string; messageID: string }
      >()

      const session = await client.createSession({ title: "App smoke" })
      await client.sendPrompt(session.id, { parts: [{ type: "text", text: "hello" }] })

      for await (const event of client.subscribe()) {
        applyHeadlessProjectionEvent(state, event)
      }

      expect(HEADLESS_RUNTIME_SCHEMA_VERSION).toBe(1)
      expect(state.session).toEqual([{ id: "sess-1", title: "App smoke" }])
      expect(state.session_status["sess-1"]).toEqual({ type: "idle" })
      expect(calls).toEqual(["GET /global/health", "POST /session", "POST /session/sess-1/prompt_async", "GET /event"])
    } finally {
      await backend.close()
    }

    await expect(waitForFile(fake.termFile)).resolves.toBe("terminated")
  })
})

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  })
}

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        controller.close()
      },
    }),
    {
      headers: { "content-type": "text/event-stream" },
    },
  )
}

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

async function createReadyFakeAxCode() {
  const dir = await mkdtemp(path.join(tmpdir(), "ax-code-headless-lifecycle-"))
  const bin = path.join(dir, "ax-code")
  const pidFile = path.join(dir, "pid")
  const termFile = path.join(dir, "terminated")
  const authFile = path.join(dir, "auth")
  const argsFile = path.join(dir, "args")
  await writeFile(
    bin,
    [
      "#!/bin/sh",
      'printf "%s\\n" "$$" > "$AX_CODE_FAKE_PID_FILE"',
      'printf "%s:%s\\n" "$AX_CODE_SERVER_USERNAME" "$AX_CODE_SERVER_PASSWORD" > "$AX_CODE_FAKE_AUTH_FILE"',
      'printf "%s\\n" "$*" > "$AX_CODE_FAKE_ARGS_FILE"',
      'trap \'printf "terminated" > "$AX_CODE_FAKE_TERM_FILE"; exit 0\' TERM INT',
      'printf "ax-code server listening on http://127.0.0.1:18456\\n"',
      "while true; do sleep 1; done",
      "",
    ].join("\n"),
  )
  await chmod(bin, 0o755)

  process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`
  process.env.AX_CODE_FAKE_PID_FILE = pidFile
  process.env.AX_CODE_FAKE_TERM_FILE = termFile
  process.env.AX_CODE_FAKE_AUTH_FILE = authFile
  process.env.AX_CODE_FAKE_ARGS_FILE = argsFile

  return {
    pidFile,
    termFile,
    authFile,
    argsFile,
    async [Symbol.asyncDispose]() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function waitForFile(file: string): Promise<string> {
  const deadline = Date.now() + 1_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await readFile(file, "utf8")
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${file}`)
}

async function waitForProcessExit(pid: number) {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for process ${pid} to exit`)
}
