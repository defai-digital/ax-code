import { describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { MessageID } from "../../src/session/schema"
import { parseJsonResult } from "../../src/util/json-value"
import { RuntimeRegistry } from "../../src/runtime/runtime-registry"
import { Installation } from "../../src/installation"
import { tmpdir } from "../fixture/fixture"

const core = path.resolve(import.meta.dirname, "../..")
const root = path.resolve(core, "../..")
const command = {
  command: process.execPath,
  args: [
    "--import",
    `data:text/javascript,${encodeURIComponent(`globalThis.AX_CODE_VERSION=${JSON.stringify(Installation.VERSION)}`)}`,
    "--import",
    path.join(root, "node_modules/tsx/dist/loader.mjs"),
    "--import",
    path.join(root, "script/solid-loader.mjs"),
    "--conditions=node",
    path.join(core, "src/index-node-tui.ts"),
    "serve",
    "--hostname",
    "127.0.0.1",
    "--port",
    "0",
  ],
}

describe("managed runtime native lifecycle", () => {
  test("accepted follow-ups survive client disconnect and backend restart without duplicate admission", async () => {
    await using tmp = await tmpdir({ git: true })
    let release: (() => void) | undefined
    const prompts: string[] = []
    const modelServer = createServer(async (request, response) => {
      let raw = ""
      for await (const chunk of request) raw += chunk
      const parsed = parseJsonResult(raw)
      const body = parsed.ok ? (parsed.value as { messages?: Array<{ role: string; content: unknown }> }) : undefined
      const last = body?.messages?.filter((message) => message.role === "user").at(-1)?.content
      const text = typeof last === "string" ? last : JSON.stringify(last)
      prompts.push(text ?? "")
      if (text?.includes("HOLD_NATIVE_TURN"))
        await new Promise<void>((resolve) => {
          release = resolve
        })
      if (response.destroyed) return
      response.writeHead(200, { "content-type": "text/event-stream" })
      const chunk = {
        id: "fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: "fixture",
        choices: [{ index: 0, delta: { content: "Fixture completed." }, finish_reason: null }],
      }
      response.write(`data: ${JSON.stringify(chunk)}\n\n`)
      response.end(
        `data: ${JSON.stringify({
          ...chunk,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        })}\n\ndata: [DONE]\n\n`,
      )
    })
    await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve))
    vi.stubEnv(
      "AX_CODE_CONFIG_CONTENT",
      JSON.stringify({
        model: "native-fixture/fixture",
        small_model: "native-fixture/fixture",
        provider: {
          "native-fixture": {
            npm: "@ai-sdk/openai-compatible",
            name: "Native fixture",
            options: {
              baseURL: `http://127.0.0.1:${(modelServer.address() as AddressInfo).port}/v1`,
              apiKey: "fixture-only",
            },
            models: { fixture: { name: "Fixture", limit: { context: 128000, output: 1000 } } },
          },
        },
      }),
    )
    let active: RuntimeRegistry.Record | undefined
    const location = await RuntimeRegistry.location(tmp.path)
    const api = async (route: string, body?: unknown) => {
      const response = await fetch(new URL(route, active!.url), {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...RuntimeRegistry.headers(active!),
          "content-type": "application/json",
          "x-ax-code-directory": tmp.path,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`Fixture API ${route}: ${response.status} ${await response.text()}`)
      return response.json()
    }
    try {
      active = await RuntimeRegistry.start(tmp.path, command)
      const session = await api("/session", { title: "Native persistence fixture" })
      const initial = await api(`/session/${session.id}/prompt_async`, {
        messageID: MessageID.ascending(),
        model: { providerID: "native-fixture", modelID: "fixture" },
        parts: [{ type: "text", text: "HOLD_NATIVE_TURN" }],
      })
      await vi.waitFor(() => expect(release).toBeTypeOf("function"), { timeout: 20_000 })
      const body = {
        messageID: MessageID.ascending(),
        model: { providerID: "native-fixture", modelID: "fixture" },
        parts: [{ type: "text", text: "FOLLOWUP_NATIVE_ONCE" }],
      }
      const route = `/session/${session.id}/prompt_async?followup=true`
      const [one, duplicate] = await Promise.all([api(route, body), api(route, body)])
      expect(one.id).toBe(duplicate.id)
      expect(one.kind).toBe("followup")
      expect(one.status).toBe("waiting_for_idle")
      // Close a real event-stream client while work stays owned by the server.
      const disconnected = new AbortController()
      const stream = await fetch(new URL("/event", active.url), {
        headers: RuntimeRegistry.headers(active),
        signal: disconnected.signal,
      })
      expect(stream.ok).toBe(true)
      disconnected.abort()
      expect(await RuntimeRegistry.probe(active)).toBe(true)
      const oldPID = active.pid
      process.kill(oldPID, "SIGKILL")
      release?.()
      await vi.waitFor(() => expect(() => process.kill(oldPID, 0)).toThrow(), { timeout: 15_000 })
      active = await RuntimeRegistry.start(tmp.path, command)
      await vi.waitFor(async () => expect((await api(`/task-queue/${one.id}`)).status).toBe("completed"), {
        timeout: 30_000,
      })
      const failed = await api(`/task-queue/${initial.id}`)
      expect(failed.status).toBe("failed")
      expect(failed.payload.interruptionReason).toBe("backend_restart")
      expect(prompts.filter((text) => text.includes("FOLLOWUP_NATIVE_ONCE"))).toHaveLength(1)
      const again = await api(route, body)
      expect(again.id).toBe(one.id)
      expect(again.status).toBe("completed")
    } finally {
      release?.()
      active ??= await RuntimeRegistry.read(location.file)
      if (active && (await RuntimeRegistry.probe(active))) await RuntimeRegistry.stop(tmp.path)
      vi.unstubAllEnvs()
      modelServer.closeAllConnections()
      await new Promise<void>((resolve) => modelServer.close(() => resolve()))
    }
  }, 120_000)

  test("concurrent discovery, authenticated identity, backend death and restart", async () => {
    await using tmp = await tmpdir({ git: true })
    const location = await RuntimeRegistry.location(tmp.path)
    let active: RuntimeRegistry.Record | undefined
    try {
      const [first, second] = await Promise.all([
        RuntimeRegistry.start(tmp.path, command),
        RuntimeRegistry.start(tmp.path, command),
      ])
      active = first
      expect(first.id).toBe(second.id)
      expect(first.pid).toBe(second.pid)
      expect(await RuntimeRegistry.probe(first)).toBe(true)
      // The spawning operation has returned; a fresh client still sees the live process.
      expect((await RuntimeRegistry.status(tmp.path)).state).toBe("running")
      const unauthorized = await fetch(new URL("/global/runtime", first.url))
      expect(unauthorized.status).toBe(403)
      const wrongID = await fetch(new URL("/global/runtime/stop", first.url), {
        method: "POST",
        headers: { ...RuntimeRegistry.headers(first), "content-type": "application/json" },
        body: JSON.stringify({ id: randomUUID() }),
      })
      expect(wrongID.status).toBe(404)
      expect(await RuntimeRegistry.probe(first)).toBe(true)

      // A forged discovery identity must not authorize stopping the real PID.
      await fs.writeFile(location.file, JSON.stringify({ ...first, id: randomUUID() }), { mode: 0o600 })
      await expect(RuntimeRegistry.stop(tmp.path)).rejects.toThrow("identity")
      expect(await RuntimeRegistry.probe(first)).toBe(true)
      await fs.writeFile(location.file, JSON.stringify(first), { mode: 0o600 })

      process.kill(first.pid, "SIGKILL")
      await vi.waitFor(
        () => {
          expect(() => process.kill(first.pid, 0)).toThrow()
        },
        { timeout: 15_000, interval: 100 },
      )
      expect((await RuntimeRegistry.status(tmp.path)).state).toBe("unavailable")
      active = await RuntimeRegistry.start(tmp.path, command)
      expect(active.id).not.toBe(first.id)
      expect(await RuntimeRegistry.stop(tmp.path)).toBe(true)
      active = undefined
      expect((await RuntimeRegistry.status(tmp.path)).state).toBe("absent")
    } finally {
      active ??= await RuntimeRegistry.read(location.file)
      if (active && (await RuntimeRegistry.probe(active))) await RuntimeRegistry.stop(tmp.path)
    }
  }, 120_000)
})
