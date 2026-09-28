import { WikiMaintenanceSchema } from "@/wiki/maintenance-schema"
import type { WikiMaintenanceStatus } from "@/wiki/idle-controller"
import { createHash } from "node:crypto"
import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { parseWikiGraph } from "@ax-code/ax-wiki/graph"
import type { WikiGraph } from "@ax-code/ax-wiki/graph"
import { parseJsonStrict } from "@/util/json-value"
import { directoryRequestHeaders } from "./request-headers"

export const WikiVizError = NamedError.create(
  "WikiVizError",
  z.object({
    reason: z.enum(["missing", "invalid", "too_large", "unauthorized", "unsupported", "failed", "context_changed"]),
    message: z.string(),
  }),
)

/** Read the connected runtime's snapshot, never the TUI machine's project files. */
async function readWikiResponse(input: {
  endpoint?: string
  method?: "GET" | "POST"
  body?: unknown
  base: string
  directory?: string
  fetch: typeof fetch
  signal: AbortSignal
}): Promise<unknown> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  input.signal.addEventListener("abort", abort, { once: true })
  if (input.signal.aborted) abort()
  const timer = setTimeout(abort, 10_000)
  const limit = 2 * 1024 * 1024
  try {
    const response = await input.fetch(
      new URL(input.endpoint ?? "experimental/wiki-visualization", input.base.replace(/\/?$/, "/")),
      {
        method: input.method,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        headers: directoryRequestHeaders({
          directory: input.directory,
          accept: "application/json",
          contentType: input.body === undefined ? undefined : "application/json",
        }),
        signal: controller.signal,
        redirect: "error",
      },
    )
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new WikiVizError({ reason: "unauthorized", message: "The connected runtime denied access to this Wiki." })
    }
    if (response.status === 404) {
      await response.body?.cancel()
      throw new WikiVizError({
        reason: "unsupported",
        message: "The connected runtime does not support Wiki visualization. Update that runtime.",
      })
    }
    if (!response.body)
      throw new WikiVizError({ reason: "invalid", message: "The runtime returned an empty Wiki snapshot." })
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body.cancel()
      throw new WikiVizError({ reason: "too_large", message: "Wiki snapshot exceeds the response limit." })
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > limit)
          throw new WikiVizError({ reason: "too_large", message: "Wiki snapshot exceeds the response limit." })
        chunks.push(chunk.value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    const value = parseJsonStrict(Buffer.concat(chunks, size).toString("utf8"))
    if (!response.ok) {
      const code = value && typeof value === "object" && "code" in value ? value.code : undefined
      const reason = code === "missing" || code === "too_large" || code === "invalid" ? code : "failed"
      throw new WikiVizError({ reason, message: "The connected runtime could not provide a Wiki snapshot." })
    }
    return value
  } catch (error) {
    if (input.signal.aborted) throw new DOMException("Wiki visualization was cancelled", "AbortError")
    if (WikiVizError.isInstance(error)) throw error
    throw new WikiVizError({
      reason: "failed",
      message: "Could not load the Wiki snapshot from the connected runtime.",
    })
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener("abort", abort)
  }
}

export async function fetchWikiVisualization(input: {
  base: string
  directory?: string
  fetch: typeof fetch
  signal: AbortSignal
}): Promise<WikiGraph> {
  const value = await readWikiResponse(input)
  try {
    return parseWikiGraph(value)
  } catch {
    throw new WikiVizError({ reason: "invalid", message: "The runtime returned an invalid Wiki snapshot." })
  }
}
export async function requestWikiMaintenance(input: {
  base: string
  directory?: string
  fetch: typeof fetch
  signal: AbortSignal
  action?: "enable" | "refresh"
  agent?: string
  active?: boolean
}): Promise<WikiMaintenanceStatus> {
  const value = await readWikiResponse({
    ...input,
    endpoint: "experimental/wiki-maintenance" + (input.action ? "/" + input.action : ""),
    method: input.action ? "POST" : "GET",
    body: input.action ? { agent: input.agent ?? "build", active: input.active ?? false } : undefined,
  })
  return WikiMaintenanceSchema.parse(value)
}
export async function wikiPollDelay(signal: AbortSignal, ms = 1500) {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException("Wiki poll stopped", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, ms)
    // @scan-suppress race_scan - The executor attaches this listener before the await settles, and once removes it on abort.
    signal.addEventListener("abort", abort, { once: true })
  })
}

export type WikiViewerListener = {
  url: string
  close(): Promise<void>
  update?(status: WikiMaintenanceStatus, graph?: WikiGraph): void
}
type Listener = WikiViewerListener
type Activation = {
  scope: string
  load(signal: AbortSignal): Promise<WikiGraph>
  isCurrent(): boolean
  monitor?: (listener: Listener, signal: AbortSignal) => Promise<void>
  refresh?: (listener: Listener, signal: AbortSignal) => Promise<void>
}

/** One owned bridge across routes; callers supply captured runtime context. */
export function createWikiVisualizationManager(input: {
  serve(graph: WikiGraph): Promise<Listener>
  openBrowser(url: string): Promise<unknown>
}) {
  let current:
    | {
        scope: string
        identity: string
        listener: Listener
        monitor?: { controller: AbortController; promise: Promise<void>; ended: boolean }
      }
    | undefined
  let flight:
    | { scope: string; controller: AbortController; promise: Promise<{ url: string; opened: boolean }> }
    | undefined
  let generation = 0
  let disposed = false
  let disposal: Promise<void> | undefined
  const subscribers = new Set<(opening: boolean) => void>()
  const notify = () => {
    for (const subscriber of subscribers) subscriber(!!flight)
  }
  async function closeCurrent() {
    if (!current) return
    const previous = current
    previous.monitor?.controller.abort()
    await previous.monitor?.promise.catch(() => {})
    await previous.listener.close()
    if (current === previous) current = undefined
  }
  function activate(request: Activation) {
    if (disposed) return Promise.reject(new DOMException("Wiki viewer is disposed", "AbortError"))
    if (flight?.scope === request.scope) return flight.promise
    const previous = flight
    previous?.controller.abort()
    const ticket = ++generation
    const controller = new AbortController()
    const check = () => {
      if (disposed || ticket !== generation || controller.signal.aborted)
        throw new DOMException("Wiki visualization was cancelled", "AbortError")
      if (!request.isCurrent())
        throw new WikiVizError({
          reason: "context_changed",
          message: "Workspace changed. Open the Wiki visualization again.",
        })
    }
    const next = {
      scope: request.scope,
      controller,
      promise: undefined as unknown as Promise<{ url: string; opened: boolean }>,
    }
    next.promise = Promise.resolve(previous?.promise)
      .catch(() => {})
      .then(async () => {
        check()
        const graph = parseWikiGraph(await request.load(controller.signal))
        check()
        const identity = createHash("sha256").update(JSON.stringify(graph)).digest("hex")
        if (
          !current ||
          current.scope !== request.scope ||
          current.identity !== identity ||
          (request.monitor && current.monitor?.ended)
        ) {
          if (current) {
            await closeCurrent()
            check()
          }
          const listener = await input.serve(graph)
          try {
            check()
          } catch (error) {
            await listener.close()
            throw error
          }
          current = { scope: request.scope, identity, listener }
          if (request.monitor) {
            const monitorController = new AbortController()
            const monitor = { controller: monitorController, promise: Promise.resolve(), ended: false }
            monitor.promise = request.monitor(listener, monitorController.signal).finally(() => {
              monitor.ended = true
            })
            current.monitor = monitor
            void monitor.promise.catch(() => {})
          }
        }
        check()
        const url = current.listener.url
        if (request.refresh) {
          void request
            .refresh(current.listener, current.monitor?.controller.signal ?? controller.signal)
            .catch(() => {})
        }
        let opened = true
        let timer: ReturnType<typeof setTimeout> | undefined
        let abort: (() => void) | undefined
        try {
          const cancelled = new Promise<never>((_, reject) => {
            abort = () => reject(new DOMException("Browser launch cancelled", "AbortError"))
            controller.signal.addEventListener("abort", abort, { once: true })
            timer = setTimeout(() => reject(new Error("Browser launch timed out")), 5000)
          })
          await Promise.race([input.openBrowser(url), cancelled])
        } catch {
          opened = false
        } finally {
          clearTimeout(timer)
          if (abort) controller.signal.removeEventListener("abort", abort)
        }
        check()
        return { url, opened }
      })
      .finally(() => {
        if (flight === next) {
          flight = undefined
          notify()
        }
      })
    flight = next
    notify()
    return next.promise
  }
  return {
    activate,
    subscribe(listener: (opening: boolean) => void) {
      subscribers.add(listener)
      listener(!!flight)
      return () => {
        subscribers.delete(listener)
      }
    },
    dispose() {
      if (disposal) return disposal
      disposed = true
      generation++
      flight?.controller.abort()
      disposal = (async () => {
        await flight?.promise.catch(() => {})
        await closeCurrent()
        subscribers.clear()
      })()
      return disposal
    },
  }
}
