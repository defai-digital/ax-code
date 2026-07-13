import { toErrorMessage } from "./error-message"
import { parseJsonPayload } from "./json-value"

export namespace Rpc {
  type SerializedError = {
    name?: string
    message: string
    stack?: string
  }

  type Definition = {
    [method: string]: (input: any) => any
  }

  type MessageTarget = {
    postMessage: (data: string) => void | null
    onmessage: ((ev: MessageEvent<any>) => any) | null
    /**
     * Optional fast-fail hook. The wire (e.g. process-stdio transport
     * in `cli/cmd/tui/thread.ts createProcessWire`) calls this when it
     * detects it can no longer deliver messages — broken stdin pipe,
     * child exit, stdout error, etc. The RPC client registers a
     * handler here that immediately rejects every pending call,
     * instead of letting each one wait the full 60s `RPC_TIMEOUT_MS`.
     * Without this, a backend crash makes the TUI appear frozen for
     * up to a minute while in-flight calls drain one by one.
     */
    onWireDeath?: (() => void) | null
    /**
     * Indicates the physical transport closed before the RPC client attached
     * its `onWireDeath` handler. This preserves the startup failure signal so
     * the first client call fails immediately instead of timing out.
     */
    wireClosed?: boolean
  }

  export type WireMessage = Record<string, any> & {
    type?: unknown
  }

  let emitMessage: ((data: string) => void) | undefined

  export function decodeWireMessage(value: unknown): WireMessage | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    return value as WireMessage
  }

  export function parseWireMessage(data: string): WireMessage | undefined {
    const parsed = parseJsonPayload(data)
    if (parsed === undefined) return undefined
    return decodeWireMessage(parsed)
  }

  // Defensive double-init guard. The current architecture calls exactly
  // one of `listen()` or `listenStdio()` per process (the TUI backend
  // picks worker vs stdio at startup and they're mutually exclusive
  // branches), so `emitMessage` is naturally a singleton. If a future
  // change ever called both — e.g. a debug mode that mirrors RPC to
  // both stdout and a worker — the second call would silently hijack
  // the first transport's outbound channel and the first transport's
  // results would land in the wrong place. Throw loudly here so the
  // mistake is caught at startup rather than as a phantom delivery
  // failure later.
  function bindEmitMessage(next: (data: string) => void, source: "listen" | "listenStdio") {
    if (emitMessage) {
      throw new Error(
        `Rpc.${source} called but an emit channel is already bound — listen() and listenStdio() are mutually exclusive in the same process`,
      )
    }
    emitMessage = next
  }

  /**
   * Test-only reset for the bound emit channel. Tests legitimately
   * exercise `listen()` and `listenStdio()` in sequence within the same
   * process; production code calls exactly one and never resets. Do not
   * call this from non-test code — the guard above exists to catch
   * exactly that mistake.
   */
  export function _resetEmitMessageForTest(): void {
    emitMessage = undefined
  }

  function serializeError(error: unknown): SerializedError {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    }
    return {
      message: toErrorMessage(error),
    }
  }

  function stringifyEventMessage(message: unknown): string {
    const seen = new WeakSet<object>()
    try {
      return JSON.stringify(message, (_key, value) => {
        if (typeof value === "bigint") return value.toString()
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]"
          seen.add(value)
        }
        return value
      })
    } catch (error) {
      return JSON.stringify({
        type: "rpc.event",
        event: "rpc.serialization_error",
        data: { error: toErrorMessage(error) },
      })
    }
  }

  function hydrateError(error: SerializedError | undefined) {
    const result = new Error(error?.message ?? "RPC request failed")
    if (error?.name) result.name = error.name
    if (error?.stack) result.stack = error.stack
    return result
  }

  export function listen(rpc: Definition) {
    bindEmitMessage((data) => postMessage(data), "listen")
    onmessage = async (evt) => {
      // Malformed messages must not crash the worker: onmessage is a raw
      // assignment (not addEventListener), so any throw here kills it and
      // strands every in-flight RPC promise. Parse defensively and drop.
      const parsed = parseWireMessage(evt.data)
      if (!parsed) return
      if (parsed.type === "rpc.request") {
        const handler = rpc[parsed.method]
        if (typeof handler !== "function") return
        // Route responses through `emitMessage` so the same indirection
        // applies to both rpc.result/rpc.error and rpc.event frames.
        // Calling postMessage directly here was the same as
        // emitMessage today (it's set on the line above) but diverged
        // from `emit()` and `listenStdio`'s `safeWrite`-based path,
        // which made future wrapping (logging, buffering) fragile.
        try {
          const result = await handler(parsed.input)
          emitMessage?.(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
        } catch (error) {
          emitMessage?.(JSON.stringify({ type: "rpc.error", error: serializeError(error), id: parsed.id }))
        }
      }
    }
  }

  export function emit(event: string, data: unknown) {
    emitMessage?.(stringifyEventMessage({ type: "rpc.event", event, data }))
  }

  export async function listenStdio(
    rpc: Definition,
    io: {
      stdin?: Pick<NodeJS.ReadStream, "on" | "setEncoding">
      stdout?: Pick<NodeJS.WriteStream, "write" | "on">
    } = {},
  ) {
    const stdin = io.stdin ?? process.stdin
    const stdout = io.stdout ?? process.stdout
    let stdoutBroken = false
    // Without an "error" handler, an EPIPE on stdout (parent closed our
    // stdin pipe during shutdown) crashes the backend. Mark the pipe
    // dead and skip subsequent writes so handleLine doesn't keep
    // throwing on each request.
    stdout.on?.("error", (error: unknown) => {
      stdoutBroken = true
      // eslint-disable-next-line no-console
      console.error("rpc listenStdio stdout error", toErrorMessage(error))
    })
    const safeWrite = (data: string) => {
      if (stdoutBroken) return
      try {
        stdout.write(data)
      } catch (error) {
        stdoutBroken = true
        // eslint-disable-next-line no-console
        console.error("rpc listenStdio stdout write threw", toErrorMessage(error))
      }
    }
    bindEmitMessage((data) => {
      safeWrite(data + "\n")
    }, "listenStdio")

    stdin.setEncoding("utf8")
    let buffer = ""
    const handleLine = async (line: string) => {
      if (!line.trim()) return
      const parsed = parseWireMessage(line)
      if (!parsed) return
      if (parsed.type !== "rpc.request") return
      const handler = rpc[parsed.method]
      if (typeof handler !== "function") return
      try {
        const result = await handler(parsed.input)
        safeWrite(JSON.stringify({ type: "rpc.result", result, id: parsed.id }) + "\n")
      } catch (error) {
        safeWrite(JSON.stringify({ type: "rpc.error", error: serializeError(error), id: parsed.id }) + "\n")
      }
    }

    // Wrap `void handleLine(...)` paths so a thrown handler doesn't
    // become a silently-lost rejection. Any unexpected throw here is
    // surfaced via console; the protocol-level errors are already
    // converted to `rpc.error` frames inside handleLine itself.
    const dispatch = (line: string) =>
      handleLine(line).catch((error) => {
        // eslint-disable-next-line no-console
        console.error("rpc listenStdio handler threw", toErrorMessage(error))
      })

    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      stdin.on("data", (chunk) => {
        buffer += String(chunk)
        while (true) {
          const index = buffer.indexOf("\n")
          if (index < 0) break
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          void dispatch(line)
        }
      })
      stdin.on("end", () => {
        const line = buffer
        buffer = ""
        void dispatch(line).finally(finish)
      })
      stdin.on("close", () => finish())
    })
  }

  // Timeout for a single RPC call. If the worker crashes, drops the
  // response, or never gets the message (broken channel), the caller
  // would otherwise hang forever and leak its entry in `pending`.
  // 60s matches the TUI's typical request envelope and is generous
  // enough for any legitimate intra-process RPC. See BUG-77.
  const RPC_TIMEOUT_MS = 60_000

  type PendingEntry = {
    resolve: (value: any) => void
    reject: (reason: Error) => void
    timer: ReturnType<typeof setTimeout>
  }

  export function client<T extends Definition>(target: MessageTarget) {
    const pending = new Map<number, PendingEntry>()
    const listeners = new Map<string, Set<(data: any) => void>>()
    // Wrap before Number.MAX_SAFE_INTEGER. Past that point `id++` loses
    // precision and can collide, dropping a response and stranding the
    // caller until the 60s timeout. Long-lived TUI sessions can route
    // a lot of RPC traffic through here; the bound is defensive.
    const ID_WRAP = Number.MAX_SAFE_INTEGER - 1
    let id = 0
    let wireClosed = false
    const wireClosedError = () => new Error("RPC wire closed")
    // Fast-fail every pending call when the wire signals it's dead.
    // Without this hook, a backend crash leaves callers waiting up to
    // RPC_TIMEOUT_MS each before they reject — which is what made the
    // TUI appear frozen for ~60s after a backend exit.
    const handleWireDeath = () => {
      if (wireClosed) return
      wireClosed = true
      const error = wireClosedError()
      for (const [pendingId, entry] of pending) {
        clearTimeout(entry.timer)
        entry.reject(error)
        pending.delete(pendingId)
      }
    }
    target.onWireDeath = handleWireDeath
    // A process transport can exit while the TUI is still constructing its
    // client. Honor that already-observed failure after installing the handler.
    if (target.wireClosed) handleWireDeath()
    target.onmessage = async (evt) => {
      // See Rpc.listen — drop malformed messages instead of crashing.
      const parsed = parseWireMessage(evt.data)
      if (!parsed) return
      if (parsed.type === "rpc.result" || parsed.type === "rpc.error") {
        const entry = pending.get(parsed.id)
        if (entry) {
          clearTimeout(entry.timer)
          pending.delete(parsed.id)
          if (parsed.type === "rpc.error") {
            entry.reject(hydrateError(parsed.error))
          } else {
            entry.resolve(parsed.result)
          }
        }
      }
      if (parsed.type === "rpc.event") {
        const handlers = listeners.get(parsed.event)
        if (handlers) {
          for (const handler of handlers) {
            handler(parsed.data)
          }
        }
      }
    }
    return {
      call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
        if (wireClosed) return Promise.reject(wireClosedError())
        const requestId = id
        id = id >= ID_WRAP ? 0 : id + 1
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(requestId)
            reject(new Error(`RPC call "${String(method)}" timed out after ${RPC_TIMEOUT_MS}ms`))
          }, RPC_TIMEOUT_MS)
          pending.set(requestId, { resolve, reject, timer })
          target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
        })
      },
      on<Data>(event: string, handler: (data: Data) => void) {
        let handlers = listeners.get(event)
        if (!handlers) {
          handlers = new Set()
          listeners.set(event, handlers)
        }
        handlers.add(handler)
        return () => {
          const current = listeners.get(event)
          if (current) current.delete(handler)
        }
      },
    }
  }
}
