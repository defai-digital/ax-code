import { createOpencodeClient, type Event } from "@ax-code/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, createSignal, onCleanup, onMount } from "solid-js"

export type EventSource = {
  on: (handler: (event: Event) => void) => () => void
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
    // Reactive SSE health: true while the stream is live and receiving events.
    // External-event-source mode always reports connected (no SSE loop to fail).
    const [sseConnected, setSseConnected] = createSignal(!props.events)

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

    // Stale-connection watchdog: if no SSE event arrives within 60s, the
    // connection is considered hung (half-open TCP, silent proxy drop, etc.)
    // and we abort the per-connection controller to force an immediate reconnect.
    const SSE_WATCHDOG_MS = 60_000

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break
          // Per-connection controller: aborting this forces reconnect without
          // stopping the outer while-loop (ctrl remains live).
          const connCtrl = new AbortController()
          // Propagate outer abort into inner connection.
          const onOuterAbort = () => connCtrl.abort()
          ctrl.signal.addEventListener("abort", onOuterAbort, { once: true })
          let watchdog: ReturnType<typeof setTimeout> | undefined
          const resetWatchdog = () => {
            if (watchdog) clearTimeout(watchdog)
            watchdog = setTimeout(() => connCtrl.abort(), SSE_WATCHDOG_MS)
          }
          try {
            const events = await sdk.event.subscribe({}, { signal: connCtrl.signal })
            setSseConnected(true)
            resetWatchdog()
            for await (const event of events.stream) {
              if (ctrl.signal.aborted) break
              resetWatchdog()
              handleEvent(event)
            }
          } catch {
            setSseConnected(false)
            if (abort.signal.aborted || ctrl.signal.aborted) break
            // Interruptible reconnect delay — wakes immediately if outer abort fires
            await new Promise<void>((resolve) => {
              const id = setTimeout(resolve, 2000)
              const wake = () => { clearTimeout(id); resolve() }
              abort.signal.addEventListener("abort", wake, { once: true })
              ctrl.signal.addEventListener("abort", wake, { once: true })
            })
          } finally {
            if (watchdog) clearTimeout(watchdog)
            ctrl.signal.removeEventListener("abort", onOuterAbort)
          }

          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
        }
      })()
    }

    onMount(() => {
      if (props.events) {
        const unsub = props.events.on(handleEvent)
        onCleanup(unsub)
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
