export namespace Rpc {
  type SerializedError = {
    name?: string
    message: string
    stack?: string
  }

  type Definition = {
    [method: string]: (input: any) => any
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
      message: typeof error === "string" ? error : String(error),
    }
  }

  function hydrateError(error: SerializedError | undefined) {
    const result = new Error(error?.message ?? "RPC request failed")
    if (error?.name) result.name = error.name
    if (error?.stack) result.stack = error.stack
    return result
  }

  export function listen(rpc: Definition) {
    onmessage = async (evt) => {
      // Malformed messages must not crash the worker: onmessage is a raw
      // assignment (not addEventListener), so any throw here kills it and
      // strands every in-flight RPC promise. Parse defensively and drop.
      let parsed: any
      try {
        parsed = JSON.parse(evt.data)
      } catch {
        return
      }
      if (parsed.type === "rpc.request") {
        const handler = rpc[parsed.method]
        if (typeof handler !== "function") return
        try {
          const result = await handler(parsed.input)
          postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
        } catch (error) {
          postMessage(JSON.stringify({ type: "rpc.error", error: serializeError(error), id: parsed.id }))
        }
      }
    }
  }

  export function emit(event: string, data: unknown) {
    postMessage(JSON.stringify({ type: "rpc.event", event, data }))
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

  export function client<T extends Definition>(target: {
    postMessage: (data: string) => void | null
    onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
  }) {
    const pending = new Map<number, PendingEntry>()
    const listeners = new Map<string, Set<(data: any) => void>>()
    let id = 0
    target.onmessage = async (evt) => {
      // See Rpc.listen — drop malformed messages instead of crashing.
      let parsed: any
      try {
        parsed = JSON.parse(evt.data)
      } catch {
        return
      }
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
        const requestId = id++
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
