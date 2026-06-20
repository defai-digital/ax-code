import { afterEach, describe, expect, test } from "vitest"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  applyHeadlessProjectionEvent,
  createHeadlessClient,
  createHeadlessProjectionState,
  HEADLESS_RUNTIME_SCHEMA_VERSION,
  HeadlessBackendStartupError,
  startHeadlessBackend,
} from "../src/headless.js"
import { startAxCodeGrpcHeadlessBackend } from "../src/grpc"
import { createIpcTransport } from "../src/headless-ipc.js"

const originalPath = process.env.PATH
const originalPidFile = process.env.AX_CODE_FAKE_PID_FILE
const originalTermFile = process.env.AX_CODE_FAKE_TERM_FILE
const originalAuthFile = process.env.AX_CODE_FAKE_AUTH_FILE
const originalArgsFile = process.env.AX_CODE_FAKE_ARGS_FILE
const originalExtraEnvFile = process.env.AX_CODE_FAKE_EXTRA_ENV_FILE

afterEach(() => {
  process.env.PATH = originalPath
  setEnv("AX_CODE_FAKE_PID_FILE", originalPidFile)
  setEnv("AX_CODE_FAKE_TERM_FILE", originalTermFile)
  setEnv("AX_CODE_FAKE_AUTH_FILE", originalAuthFile)
  setEnv("AX_CODE_FAKE_ARGS_FILE", originalArgsFile)
  setEnv("AX_CODE_FAKE_EXTRA_ENV_FILE", originalExtraEnvFile)
})

describe("headless backend lifecycle", () => {
  test("starts with generated auth, verifies health, and terminates the backend", async () => {
    await using fake = await createReadyFakeAxCode()
    const workspace = path.join(fake.dir, "workspace-測試")
    await mkdir(workspace)
    const healthRequests: Request[] = []

    const backend = await startHeadlessBackend({
      directory: workspace,
      auth: { username: "app", password: "secret" },
      reservePort: async () => 18456,
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
    expect(backend.headers["x-ax-code-directory"]).toBe(encodeURIComponent(workspace))
    expect(backend.headers["x-opencode-directory"]).toBe(encodeURIComponent(workspace))
    expect(backend.diagnostics).toMatchObject({
      binary: "ax-code",
      args: ["serve", "--hostname=127.0.0.1", "--port=18456"],
      cwd: workspace,
      hostname: "127.0.0.1",
      port: 18456,
      authUsername: "app",
      readyUrl: "http://127.0.0.1:18456",
      health: { ok: true, status: 200, body: { healthy: true } },
    })
    expect(healthRequests.map((request) => new URL(request.url).pathname)).toEqual(["/global/health"])
    expect(healthRequests[0].headers.get("authorization")).toBe(backend.headers.Authorization)
    expect(healthRequests[0].headers.get("x-ax-code-directory")).toBe(encodeURIComponent(workspace))
    expect(healthRequests[0].headers.get("x-opencode-directory")).toBe(encodeURIComponent(workspace))
    expect(await waitForFile(fake.authFile)).toBe("app:secret\n")
    const args = await waitForFile(fake.argsFile)
    expect(args).toContain("serve --hostname=127.0.0.1 --port=")
    expect(args).not.toContain("--port=0")

    let closed = false
    void backend.closed.then(() => {
      closed = true
    })
    await backend.close()
    await backend.closed
    expect(closed).toBe(true)

    await waitForProcessExit(Number(await waitForFile(fake.pidFile)))
  })

  test("preserves an explicit backend port", async () => {
    await using fake = await createReadyFakeAxCode()

    const backend = await startHeadlessBackend({
      port: 18457,
      fetch: (async () => jsonResponse({ healthy: true })) as typeof fetch,
    })

    expect(await waitForFile(fake.argsFile)).toContain("serve --hostname=127.0.0.1 --port=18457")

    await backend.close()
  })

  test("supports explicit backend binary, args, env, and structured diagnostics", async () => {
    await using fake = await createReadyFakeAxCode()

    const backend = await startHeadlessBackend({
      binary: fake.bin,
      args: ["serve", "--hostname=127.0.0.1", "--port=18456", "--desktop-managed"],
      env: { AX_CODE_FAKE_EXTRA_ENV_VALUE: "desktop" },
      reservePort: async () => 18456,
      fetch: (async () => jsonResponse({ healthy: true, version: "9.9.9" })) as typeof fetch,
    })

    expect(await waitForFile(fake.argsFile)).toContain("serve --hostname=127.0.0.1 --port=18456 --desktop-managed")
    expect(await waitForFile(fake.extraEnvFile)).toBe("desktop\n")
    expect(backend.diagnostics).toMatchObject({
      binary: fake.bin,
      args: ["serve", "--hostname=127.0.0.1", "--port=18456", "--desktop-managed"],
      envKeys: ["AX_CODE_FAKE_EXTRA_ENV_VALUE"],
      readyUrl: "http://127.0.0.1:18456",
      health: { ok: true, status: 200, body: { healthy: true, version: "9.9.9" } },
    })
    expect(backend.diagnostics.capturedOutput).toBeUndefined()

    await backend.close()
  })

  test("refuses network HTTP binds unless explicitly allowed", async () => {
    await expect(
      startHeadlessBackend({
        hostname: "0.0.0.0",
        reservePort: async () => 18456,
        fetch: (async () => jsonResponse({ healthy: true })) as typeof fetch,
      }),
    ).rejects.toThrow("startHeadlessBackend only binds the HTTP API to loopback hostnames by default")
  })

  test("refuses malformed IPv4 loopback-looking hostnames", async () => {
    for (const hostname of ["127..0.1", "127.0.0.", "127.0.0.1."]) {
      await expect(
        startHeadlessBackend({
          hostname,
          reservePort: async () => 18456,
          fetch: (async () => jsonResponse({ healthy: true })) as typeof fetch,
        }),
      ).rejects.toThrow("startHeadlessBackend only binds the HTTP API to loopback hostnames by default")
    }
  })

  test("allows explicit network HTTP binds for secured service integrations", async () => {
    await using fake = await createReadyFakeAxCode()

    const backend = await startHeadlessBackend({
      hostname: "0.0.0.0",
      allowNetworkBind: true,
      reservePort: async () => 18458,
      fetch: (async () => jsonResponse({ healthy: true })) as typeof fetch,
    })

    expect(await waitForFile(fake.argsFile)).toContain("serve --hostname=0.0.0.0 --port=18458")

    await backend.close()
  })

  test("reports an actionable error when random port reservation fails", async () => {
    await expect(
      startHeadlessBackend({
        reservePort: async () => {
          throw new Error("permission denied")
        },
        fetch: (async () => jsonResponse({ healthy: true })) as typeof fetch,
      }),
    ).rejects.toThrow("Failed to reserve loopback port for ax-code backend on 127.0.0.1: permission denied")
  })

  test("kills the backend when health readiness fails", async () => {
    await using fake = await createReadyFakeAxCode()

    let caught: unknown
    try {
      await startHeadlessBackend({
        timeout: 1_000,
        reservePort: async () => 18456,
        fetch: (async () => new Response("not ready", { status: 503 })) as typeof fetch,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(HeadlessBackendStartupError)
    expect((caught as HeadlessBackendStartupError).message).toContain(
      "ax-code backend health check failed (503): not ready",
    )
    expect((caught as HeadlessBackendStartupError).diagnostics).toMatchObject({
      binary: "ax-code",
      args: ["serve", "--hostname=127.0.0.1", "--port=18456"],
      readyUrl: "http://127.0.0.1:18456",
      health: {
        ok: false,
        status: 0,
        error: "ax-code backend health check failed (503): not ready",
      },
    })

    await waitForProcessExit(Number(await waitForFile(fake.pidFile)))
  })

  test("startup failures expose diagnostics and partial stdout output", async () => {
    await using fake = await createPartialOutputFakeAxCode()

    let caught: unknown
    try {
      await startHeadlessBackend({
        timeout: 250,
        reservePort: async () => 18456,
        fetch: (async () => jsonResponse({ healthy: true })) as typeof fetch,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(HeadlessBackendStartupError)
    expect((caught as HeadlessBackendStartupError).message).toContain("ax-code backend did not become ready")
    expect((caught as HeadlessBackendStartupError).diagnostics).toMatchObject({
      binary: "ax-code",
      args: ["serve", "--hostname=127.0.0.1", "--port=18456"],
      capturedOutput: "partial ready line without newline",
    })

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
        return jsonResponse({
          healthy: true,
          version: "9.9.9",
          readiness: {
            processAlive: true,
            apiReady: true,
            providersReady: "unknown",
            indexReady: "unknown",
          },
        })
      }
      if (url.pathname === "/global/capabilities") {
        return jsonResponse({
          schemaVersion: 1,
          product: "ax-code",
          version: "9.9.9",
          compatibility: {
            minDesktopVersion: null,
            sdkHeadless: {
              schemaVersion: 1,
              supportsManagedLifecycle: true,
              supportsExplicitBinary: true,
              supportsExplicitArgs: true,
              supportsStructuredDiagnostics: true,
              authSchemes: ["basic"],
              defaultTransport: "http-sse",
            },
          },
          endpoints: {
            health: "/global/health",
            events: "/global/event",
            config: "/global/config",
            capabilityCatalog: "/capability",
            fileSearch: "/find/file",
            sessions: "/session",
            providers: "/config/providers",
            agents: "/agent",
          },
          features: {
            sessions: true,
            asyncPrompt: true,
            globalEvents: true,
            fileSearch: true,
            skills: true,
            plugins: true,
            mcp: true,
            worktrees: true,
            providerManagement: true,
            usage: true,
          },
          events: {
            heartbeat: "server.heartbeat",
            connected: "server.connected",
            sessionCreated: "session.created",
            sessionStatus: "session.status",
            sessionError: "session.error",
            permission: "permission",
            question: "question",
          },
        })
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

    const backend = await startHeadlessBackend({ reservePort: async () => 18456, fetch: fetchFn })
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

      expect(await client.health()).toMatchObject({ healthy: true, version: "9.9.9" })
      expect(await client.capabilities()).toMatchObject({
        schemaVersion: 1,
        compatibility: {
          sdkHeadless: {
            supportsExplicitBinary: true,
            supportsExplicitArgs: true,
            supportsStructuredDiagnostics: true,
          },
        },
      })
      const session = await client.createSession({ title: "App smoke" })
      await client.sendPrompt(session.id, { parts: [{ type: "text", text: "hello" }] })

      for await (const event of client.subscribe()) {
        applyHeadlessProjectionEvent(state, event)
      }

      expect(HEADLESS_RUNTIME_SCHEMA_VERSION).toBe(1)
      expect(state.session).toEqual([{ id: "sess-1", title: "App smoke" }])
      expect(state.session_status["sess-1"]).toEqual({ type: "idle" })
      expect(calls).toEqual([
        "GET /global/health",
        "GET /global/health",
        "GET /global/capabilities",
        "POST /session",
        "POST /session/sess-1/prompt_async",
        "GET /event",
      ])
    } finally {
      await backend.close()
    }

    await expect(waitForFile(fake.termFile)).resolves.toBe("terminated")
  })

  test("gRPC headless backend helper hides HTTP endpoint details from the GUI client", async () => {
    await using fake = await createReadyFakeAxCode()

    const backend = await startAxCodeGrpcHeadlessBackend({
      auth: { username: "app", password: "secret" },
      reservePort: async () => 18456,
      fetch: (async () => jsonResponse({ healthy: true })) as typeof fetch,
    })
    try {
      expect("url" in backend).toBe(false)
      expect("headers" in backend).toBe(false)
      expect(await backend.client.health()).toEqual({ status: "SERVING", transport: "http-bridge" })
      expect(await waitForFile(fake.authFile)).toBe("app:secret\n")
      expect(await waitForFile(fake.argsFile)).toContain("serve --hostname=127.0.0.1 --port=18456")
    } finally {
      await backend.close()
    }

    await waitForProcessExit(Number(await waitForFile(fake.pidFile)))
  })

  test("starts backend over IPC transport", async () => {
    await using fake = await createIpcFakeAxCode()
    const socketPath = path.join(fake.dir, "ipc.sock")

    const backend = await startHeadlessBackend({
      transport: "ipc",
      ipcSocketPath: socketPath,
      binary: fake.bin,
    })

    try {
      expect(backend.socketPath).toBe(socketPath)
      expect(backend.url).toBe(`ipc://${socketPath}`)
      expect(backend.diagnostics.args).toEqual(["serve", `--ipc-socket=${socketPath}`, "--port=0"])

      const transport = createIpcTransport({ socketPath })
      try {
        const health = await transport.requestJson<{ healthy: boolean }>({
          path: "/global/health",
          method: "GET",
        })
        expect(health).toEqual({ healthy: true })
      } finally {
        await transport.close?.()
      }
    } finally {
      await backend.close()
    }

    await waitForProcessExit(Number(await waitForFile(fake.pidFile)))
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
  const extraEnvFile = path.join(dir, "extra-env")
  await writeFile(
    bin,
    [
      "#!/bin/sh",
      'printf "%s\\n" "$$" > "$AX_CODE_FAKE_PID_FILE"',
      'printf "%s:%s\\n" "$AX_CODE_SERVER_USERNAME" "$AX_CODE_SERVER_PASSWORD" > "$AX_CODE_FAKE_AUTH_FILE"',
      'printf "%s\\n" "$*" > "$AX_CODE_FAKE_ARGS_FILE"',
      'if [ -n "$AX_CODE_FAKE_EXTRA_ENV_FILE" ]; then printf "%s\\n" "$AX_CODE_FAKE_EXTRA_ENV_VALUE" > "$AX_CODE_FAKE_EXTRA_ENV_FILE"; fi',
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
  process.env.AX_CODE_FAKE_EXTRA_ENV_FILE = extraEnvFile

  return {
    dir,
    bin,
    pidFile,
    termFile,
    authFile,
    argsFile,
    extraEnvFile,
    async [Symbol.asyncDispose]() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function createIpcFakeAxCode() {
  const dir = await mkdtemp(path.join(tmpdir(), "ax-code-headless-ipc-lifecycle-"))
  const bin = path.join(dir, "ax-code")
  const pidFile = path.join(dir, "pid")
  const argsFile = path.join(dir, "args")
  const termFile = path.join(dir, "terminated")
  const nodeScript = path.join(dir, "ipc-fake.js")
  const msgpackPath = require.resolve("@msgpack/msgpack")
  await writeFile(
    nodeScript,
    [
      "const net = require('node:net')",
      "const fs = require('node:fs')",
      `const { encode: msgpackEncode, decode: msgpackDecode } = require(${JSON.stringify(msgpackPath)})`,
      "",
      "const socketArg = process.argv.find((a) => a.startsWith('--ipc-socket='))",
      "const socketPath = socketArg ? socketArg.slice('--ipc-socket='.length) : undefined",
      "if (!socketPath) { console.error('missing --ipc-socket'); process.exit(1) }",
      "",
      "const pidFile = process.env.AX_CODE_FAKE_PID_FILE",
      "const argsFile = process.env.AX_CODE_FAKE_ARGS_FILE",
      "if (pidFile) fs.writeFileSync(pidFile, String(process.pid))",
      "if (argsFile) fs.writeFileSync(argsFile, process.argv.slice(2).join(' '))",
      "",
      "try { fs.unlinkSync(socketPath) } catch (e) { if (e.code !== 'ENOENT') throw e }",
      "",
      "function encode(msg) {",
      "  const bytes = msgpackEncode(msg)",
      "  const frame = Buffer.allocUnsafe(4 + bytes.length)",
      "  frame.writeUInt32BE(bytes.length, 0)",
      "  frame.set(bytes, 4)",
      "  return frame",
      "}",
      "",
      "const server = net.createServer((socket) => {",
      "  let buffer = Buffer.alloc(0)",
      "  socket.on('data', (chunk) => {",
      "    buffer = Buffer.concat([buffer, chunk])",
      "    while (buffer.length >= 4) {",
      "      const length = buffer.readUInt32BE(0)",
      "      if (buffer.length < 4 + length) break",
      "      const msg = msgpackDecode(buffer.subarray(4, 4 + length))",
      "      buffer = buffer.subarray(4 + length)",
      "      if (msg.type === 'request') {",
      "        let body = true",
      "        if (msg.path === '/global/health') body = { healthy: true }",
      "        socket.write(encode({ type: 'response', id: msg.id, status: 200, body }))",
      "      }",
      "    }",
      "  })",
      "})",
      "",
      "server.listen(socketPath, () => {",
      "  console.log(`ax-code server ipc listening on ${socketPath}`)",
      "})",
      "",
      "function shutdown() {",
      "  try { fs.writeFileSync(process.env.AX_CODE_FAKE_TERM_FILE, 'terminated') } catch {}",
      "  server.close(() => process.exit(0))",
      "}",
      "process.on('SIGTERM', shutdown)",
      "process.on('SIGINT', shutdown)",
      "",
    ].join("\n"),
  )
  await writeFile(
    bin,
    [
      "#!/bin/sh",
      `exec "${process.execPath}" "${nodeScript}" "$@"`,
      "",
    ].join("\n"),
  )
  await chmod(bin, 0o755)

  process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`
  process.env.AX_CODE_FAKE_PID_FILE = pidFile
  process.env.AX_CODE_FAKE_ARGS_FILE = argsFile
  process.env.AX_CODE_FAKE_TERM_FILE = termFile

  return {
    dir,
    bin,
    pidFile,
    argsFile,
    termFile,
    async [Symbol.asyncDispose]() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function createPartialOutputFakeAxCode() {
  const dir = await mkdtemp(path.join(tmpdir(), "ax-code-headless-partial-output-"))
  const bin = path.join(dir, "ax-code")
  const pidFile = path.join(dir, "pid")
  const termFile = path.join(dir, "terminated")
  await writeFile(
    bin,
    [
      "#!/bin/sh",
      'printf "%s\\n" "$$" > "$AX_CODE_FAKE_PID_FILE"',
      'trap \'printf "terminated" > "$AX_CODE_FAKE_TERM_FILE"; exit 0\' TERM INT',
      'printf "partial ready line without newline"',
      "while true; do sleep 1; done",
      "",
    ].join("\n"),
  )
  await chmod(bin, 0o755)

  process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`
  process.env.AX_CODE_FAKE_PID_FILE = pidFile
  process.env.AX_CODE_FAKE_TERM_FILE = termFile

  return {
    pidFile,
    termFile,
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
