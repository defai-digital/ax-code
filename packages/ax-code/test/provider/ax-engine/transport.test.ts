import { afterEach, describe, expect, test, vi } from "vitest"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type { Provider } from "../../../src/provider/provider"
import { ProviderID } from "../../../src/provider/schema"
import { AX_ENGINE_DEFAULT_MODEL_ID } from "../../../src/provider/ax-engine/constants"
import { probeAxEngineConnection } from "../../../src/provider/ax-engine/connection"
import { fetchAxEngineModelContracts } from "../../../src/provider/ax-engine/model-card"
import { axEngineLoader, noteActiveAxEngineServer } from "../../../src/provider/ax-engine/provider-loader"
import { isServerReady } from "../../../src/provider/ax-engine/server"

const managed = "http://127.0.0.1:31418/v1"

function provider(baseURL?: string): Provider.Info {
  return {
    id: ProviderID.make("ax-engine"),
    name: "AX Engine",
    source: "custom",
    env: [],
    options: baseURL ? { connectionMode: "attach", baseURL } : { connectionMode: "managed" },
    models: {},
  }
}

function modelResponse(id = "local-model") {
  return Response.json({ data: [{ id, capabilities: { toolcall: true } }] })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  noteActiveAxEngineServer(undefined)
})

describe("ax-engine transport isolation", () => {
  test("attached providers keep their own endpoint after another provider resolves a model", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => modelResponse())
    vi.stubGlobal("fetch", fetchSpy)
    const firstURL = "http://127.0.0.1:31421/v1"
    const secondURL = "http://127.0.0.1:31422/v1"
    const first = await axEngineLoader()(provider(firstURL))
    const second = await axEngineLoader()(provider(secondURL))
    const local = await axEngineLoader()(provider())
    const sdk = { languageModel: vi.fn() }
    noteActiveAxEngineServer("http://127.0.0.1:31420/v1")

    await first.getModel!(sdk, "local-model")
    await second.getModel!(sdk, "local-model")
    fetchSpy.mockClear()
    await first.options!.fetch(`${firstURL}/chat/completions`)
    await second.options!.fetch(`${secondURL}/chat/completions`)
    await local.options!.fetch(`${managed}/chat/completions`)
    expect(fetchSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      `${firstURL}/chat/completions`,
      `${secondURL}/chat/completions`,
      "http://127.0.0.1:31420/v1/chat/completions",
    ])
  })

  test("preserves Request authorization, content type, body, and cancellation when rewriting", async () => {
    let received: Request | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        received = new Request(input, init)
        return modelResponse()
      }),
    )
    const loader = await axEngineLoader()(provider())
    const controller = new AbortController()
    noteActiveAxEngineServer("http://127.0.0.1:31420/v1")
    await loader.options!.fetch(
      new Request(`${managed}/chat/completions`, {
        method: "POST",
        headers: { authorization: "Bearer request-key", "content-type": "application/json" },
        body: JSON.stringify({ model: "local-model" }),
        signal: controller.signal,
      }),
    )
    expect(received?.url).toBe("http://127.0.0.1:31420/v1/chat/completions")
    expect(received?.headers.get("authorization")).toBe("Bearer request-key")
    expect(received?.headers.get("content-type")).toBe("application/json")
    expect(await received?.json()).toEqual({ model: "local-model" })
    controller.abort()
    expect(received?.signal.aborted).toBe(true)
  })

  test("does not follow chat or health redirects away from the validated endpoint", async () => {
    const forwarded: string[] = []
    const server = createServer((req, res) => {
      if (req.url === "/forwarded") {
        forwarded.push(req.method ?? "")
        res.end("{}")
        return
      }
      res.writeHead(307, { location: "/forwarded" })
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
      const loader = await axEngineLoader()(provider(baseURL))
      await expect(
        loader.options!.fetch(`${baseURL}/chat/completions`, {
          method: "POST",
          body: "private prompt",
          redirect: "follow",
        }),
      ).rejects.toThrow()
      expect(await isServerReady(baseURL)).toBe(false)
      expect(forwarded).toEqual([])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  test("rejects requests outside the configured endpoint before adding credentials", async () => {
    const fetchSpy = vi.fn(async () => modelResponse())
    vi.stubGlobal("fetch", fetchSpy)
    const loader = await axEngineLoader()(provider("http://127.0.0.1:31421/v1"))

    await expect(loader.options!.fetch("http://127.0.0.1:31422/v1/chat/completions")).rejects.toThrow(
      "escaped its configured endpoint",
    )
    await expect(loader.options!.fetch("http://127.0.0.1:31421/private")).rejects.toThrow(
      "escaped its configured endpoint",
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("ax-engine probe contracts", () => {
  test.each(["discovery", "connection"])("%s keeps a deadline with a caller signal", async (kind) => {
    const deadline = new AbortController()
    const caller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal)
    let requestSignal: AbortSignal | null | undefined
    const entered = Promise.withResolvers<void>()
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal
        entered.resolve()
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
        })
      }),
    )
    const probe = kind === "discovery" ? fetchAxEngineModelContracts : probeAxEngineConnection
    const outcome = probe({ baseURL: managed, signal: caller.signal }).catch((error: unknown) => error)
    await entered.promise
    const reason = new DOMException("Probe deadline expired", "TimeoutError")
    deadline.abort(reason)
    try {
      expect(timeout).toHaveBeenCalledWith(kind === "discovery" ? 2_000 : 5_000)
      expect(requestSignal?.aborted).toBe(true)
      expect(await outcome).toBe(reason)
      expect(caller.signal.aborted).toBe(false)
    } finally {
      caller.abort()
      await outcome
    }
  })

  test.each([200, 503])("releases unused health response bodies for HTTP %s", async (status) => {
    const cancel = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new ReadableStream({ cancel }), { status })),
    )
    expect(await isServerReady(managed)).toBe(status === 200)
    expect(cancel).toHaveBeenCalledOnce()
  })

  test.each(["custom-small-model", AX_ENGINE_DEFAULT_MODEL_ID])("bounds fallback output for %s", async (id) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ id, limit: { context: 1_024 }, capabilities: { toolcall: true } }],
        }),
      ),
    )
    const configured = provider(managed)
    const loader = await axEngineLoader()(configured)
    const models = await loader.discoverModels!(configured)
    expect(models[id].limit.context).toBe(1_024)
    expect(models[id].limit.output).toBeLessThanOrEqual(1_024)
    expect(models[id].limit.input).toBeGreaterThan(0)
  })
})
