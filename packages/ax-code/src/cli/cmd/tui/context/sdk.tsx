import { createAxCodeClient, type Event } from "@ax-code/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, createSignal, onCleanup, onMount } from "solid-js"
import { runResilientStream, type StreamConnectionStatus } from "../util/resilient-stream"
import { NotificationEvent } from "@/notification/events"
import type { z } from "zod"

import { Log } from "@/util/log"
import { toErrorMessage } from "@/util/error-message"
import { registerTuiEventListener, runTuiCleanup } from "../util/lifecycle"
import { scheduleTuiTimeout } from "../util/timer"

const log = Log.create({ service: "tui.sdk" })

export type TuiRuntimeEvent =
  | Event
  | {
      type: typeof NotificationEvent.ToastShow.type
      properties: z.infer<typeof NotificationEvent.ToastShow.properties>
    }

export type EventSource = {
  on: (handler: (event: TuiRuntimeEvent) => void) => () => void
  onStatus?: (handler: (status: StreamConnectionStatus) => void) => () => void
  status?: () => StreamConnectionStatus | undefined
  setWorkspace?: (workspaceID?: string) => void
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    const [workspaceID, setWorkspaceID] = createSignal<string | undefined>()
    let sse: AbortController | undefined
    // Reactive stream health: true once the current event stream is connected.
    const [sseConnected, setSseConnected] = createSignal(props.events?.status?.()?.connected ?? false)

    function createSDK() {
      return createAxCodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: workspaceID() ?? props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    let sdk = createSDK()

    const emitter = createGlobalEmitter<{
      [key in TuiRuntimeEvent["type"]]: Extract<TuiRuntimeEvent, { type: key }>
    }>()

    let queue: TuiRuntimeEvent[] = []
    let cancelFlushTimer: (() => void) | undefined
    let last = 0
    let sseGeneration = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      cancelFlushTimer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render.
      // If an emission throws, log and continue — a single bad event must not
      // poison the queue or leave the TUI permanently out of sync.
      try {
        batch(() => {
          for (const event of events) {
            emitter.emit(event.type, event)
          }
        })
      } catch (error) {
        log.warn("event batch emission failed", { error: toErrorMessage(error), dropped: events.length })
      }
    }

    const handleEvent = (event: TuiRuntimeEvent) => {
      setSseConnected(true)
      queue.push(event)
      const elapsed = Date.now() - last

      if (cancelFlushTimer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        cancelFlushTimer = scheduleTuiTimeout(flush, {
          name: "sdk-event-batch-flush",
          delayMs: 16,
        })
        return
      }
      flush()
    }

    function startSSE() {
      cancelFlushTimer?.()
      cancelFlushTimer = undefined
      if (queue.length > 0) flush()
      sse?.abort()
      const ctrl = new AbortController()
      const generation = ++sseGeneration
      sse = ctrl
      const outer = new AbortController()
      const abortOuter = () => outer.abort()
      const removeRootAbortListener = registerTuiEventListener(abort.signal, "abort", abortOuter, {
        name: "sdk-root-abort-forward",
        options: { once: true },
      })
      const removeStreamAbortListener = registerTuiEventListener(ctrl.signal, "abort", abortOuter, {
        name: "sdk-stream-abort-forward",
        options: { once: true },
      })
      const isCurrentStream = () => generation === sseGeneration && sse === ctrl
      void runResilientStream<TuiRuntimeEvent>({
        signal: outer.signal,
        subscribe: (signal) => sdk.event.subscribe({}, { signal }),
        onEvent: (event) => {
          if (!isCurrentStream()) return
          handleEvent(event)
        },
        onStatus: (status) => {
          if (!isCurrentStream()) return
          setSseConnected(status.connected)
        },
        onError: (error, status) => {
          if (!isCurrentStream()) return
          log.warn("SSE stream error, reconnecting", {
            error: toErrorMessage(error),
            reason: status.reason,
            attempt: status.attempt,
          })
        },
      }).finally(() => {
        removeRootAbortListener()
        removeStreamAbortListener()
        if (!isCurrentStream()) return
        cancelFlushTimer?.()
        cancelFlushTimer = undefined
        if (queue.length > 0) flush()
      })
    }

    onMount(() => {
      if (props.events) {
        const unsub = props.events.on(handleEvent)
        const unsubStatus = props.events.onStatus?.((status) => {
          setSseConnected(status.connected)
        })
        if (!props.events.onStatus) setSseConnected(true)
        onCleanup(() => {
          runTuiCleanup(unsub, { name: "sdk-external-event-unsubscribe" })
          if (unsubStatus) runTuiCleanup(unsubStatus, { name: "sdk-external-status-unsubscribe" })
        })
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      cancelFlushTimer?.()
    })

    return {
      get client() {
        return sdk
      },
      get sseConnected() {
        return sseConnected()
      },
      baseDirectory: props.directory,
      get directory() {
        return workspaceID() ?? props.directory
      },
      event: emitter,
      fetch: props.fetch ?? fetch,
      setWorkspace(next?: string) {
        if (workspaceID() === next) return
        setWorkspaceID(next)
        sdk = createSDK()
        props.events?.setWorkspace?.(next)
        if (!props.events) startSSE()
      },
      url: props.url,
    }
  },
})
