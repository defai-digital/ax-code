import { createOpencodeClient, type Event } from "@ax-code/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, createSignal, onCleanup, onMount } from "solid-js"
import { runResilientStream, type StreamConnectionStatus } from "../util/resilient-stream"

export type EventSource = {
  on: (handler: (event: Event) => void) => () => void
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
      return createOpencodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: workspaceID() ?? props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    let sdk = createSDK()

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    let queue: Event[] = []
    let timer: Timer | undefined
    let last = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit(event.type, event)
        }
      })
    }

    const handleEvent = (event: Event) => {
      setSseConnected(true)
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      const outer = new AbortController()
      const abortOuter = () => outer.abort()
      abort.signal.addEventListener("abort", abortOuter, { once: true })
      ctrl.signal.addEventListener("abort", abortOuter, { once: true })
      void runResilientStream<Event>({
        signal: outer.signal,
        subscribe: (signal) => sdk.event.subscribe({}, { signal }),
        onEvent: handleEvent,
        onStatus: (status) => setSseConnected(status.connected),
      }).finally(() => {
        abort.signal.removeEventListener("abort", abortOuter)
        ctrl.signal.removeEventListener("abort", abortOuter)
        if (timer) clearTimeout(timer)
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
          unsub()
          unsubStatus?.()
        })
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
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
