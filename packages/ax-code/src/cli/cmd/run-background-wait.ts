import type { AxCodeClient } from "@ax-code/sdk/v2"

export class RunBackgroundWaitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RunBackgroundWaitError"
  }
}

/** Wait only for task-tool children created by this invocation. Project automation owns another lifecycle. */
export async function waitForRunBackground(input: {
  sdk: AxCodeClient
  sessionID: string
  startedAt: number
  seconds: number
  signal: AbortSignal
}): Promise<string | undefined> {
  const deadline = Date.now() + input.seconds * 1000
  const deadlineError = () =>
    new RunBackgroundWaitError(`Background work did not settle within ${input.seconds} seconds.`)
  async function read<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw deadlineError()
    const timeout = new AbortController()
    const signal = AbortSignal.any([input.signal, timeout.signal])
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    try {
      return await Promise.race([
        operation(signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = deadlineError()
            reject(error)
            timeout.abort(error)
          }, remaining)
          onAbort = () => reject(input.signal.reason ?? new Error("Background wait was cancelled."))
          input.signal.addEventListener("abort", onAbort, { once: true })
          if (input.signal.aborted) onAbort()
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
      if (onAbort) input.signal.removeEventListener("abort", onAbort)
    }
  }
  let observed = false
  for (;;) {
    if (input.signal.aborted) return undefined
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw deadlineError()
    const queue = await read((signal) => input.sdk.taskQueue.list(undefined, { throwOnError: true, signal }))
    const children = (queue.data ?? []).filter(
      (item) =>
        item.kind === "subagent" &&
        item.payload["source"] === "task" &&
        item.payload["parentSessionID"] === input.sessionID &&
        item.time.created >= input.startedAt,
    )
    if (children.length === 0 && !observed) return undefined
    observed ||= children.length > 0

    const allDelivered = children.every(
      (item) =>
        (item.status === "completed" || item.status === "failed" || item.status === "cancelled") &&
        item.payload["deliveryStatus"] === "delivered",
    )
    if (allDelivered) {
      const messages = await read((signal) =>
        input.sdk.session.messages({ sessionID: input.sessionID }, { throwOnError: true, signal }),
      )
      const history = messages.data ?? []
      const owned = new Set(children.map((item) => item.id))
      const handoff = (message: (typeof history)[number]) =>
        message.info.role === "user" &&
        message.parts.some(
          (part) =>
            part.type === "text" &&
            part.synthetic === true &&
            part.metadata?.["source"] === "background_subagent_handoff" &&
            owned.has(String(part.metadata?.["taskQueueID"])),
        )
      const lastHandoff = history.findLastIndex(handoff)
      const firstHandoff = history.findIndex(handoff)
      const followupTurns = new Set(
        history
          .slice(Math.max(firstHandoff, 0) + 1)
          .flatMap((message) =>
            message.info.role === "assistant" && message.info.time.completed !== undefined
              ? [message.info.parentID]
              : [],
          ),
      )
      if (followupTurns.size > 10) throw new RunBackgroundWaitError("Background follow-up turn limit reached (10).")
      const lastAssistant = history
        .slice(lastHandoff + 1)
        .findLast((message) => message.info.role === "assistant" && message.info.time.completed !== undefined)
      if (lastHandoff >= 0 && lastAssistant) {
        const status = await read((signal) => input.sdk.session.status(undefined, { throwOnError: true, signal }))
        if (!status.data?.[input.sessionID] || status.data[input.sessionID]?.type === "idle")
          return lastAssistant.info.id
      }
    }
    if (Date.now() >= deadline) throw deadlineError()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, Math.min(1000, deadline - Date.now()))
      function done() {
        input.signal.removeEventListener("abort", aborted)
        resolve()
      }
      function aborted() {
        clearTimeout(timer)
        input.signal.removeEventListener("abort", aborted)
        reject(input.signal.reason)
      }
      input.signal.addEventListener("abort", aborted, { once: true })
    })
  }
}
