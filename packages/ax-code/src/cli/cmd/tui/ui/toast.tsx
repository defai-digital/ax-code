import { createContext, onCleanup, useContext, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@ax-code/opentui-solid"
import { RoundedBorder } from "./primitives/card"
import { TextAttributes } from "@ax-code/opentui-core"
import z from "zod"
import { NotificationEvent } from "@/notification/events"
import { scheduleTuiTimeout } from "@tui/util/timer"

export type ToastOptions = z.infer<typeof NotificationEvent.ToastShow.properties>

const VARIANT_ICON: Record<ToastOptions["variant"], string> = {
  error: "▲",
  warning: "▲",
  success: "●",
  info: "●",
}

export function Toast() {
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  return (
    <Show when={toast.currentToast}>
      {(current) => (
        <box
          position="absolute"
          justifyContent="center"
          alignItems="flex-start"
          top={2}
          right={2}
          maxWidth={Math.max(1, Math.min(60, dimensions().width - 6))}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.backgroundPanel}
          borderColor={theme[current().variant]}
          border={["top", "right", "bottom", "left"]}
          customBorderChars={RoundedBorder}
        >
          <Show when={current().title}>
            <text attributes={TextAttributes.BOLD} marginBottom={1} fg={theme.text}>
              <span style={{ fg: theme[current().variant] }}>{VARIANT_ICON[current().variant]}</span> {current().title}
            </text>
          </Show>
          <text fg={theme.text} wrapMode="word" width="100%">
            <Show when={!current().title}>
              <span style={{ fg: theme[current().variant] }}>{VARIANT_ICON[current().variant]}</span>{" "}
            </Show>
            {current().message}
            {toast.currentRepeat > 1 ? ` (×${toast.currentRepeat})` : ""}
          </text>
        </box>
      )}
    </Show>
  )
}

type QueuedToast = { options: ToastOptions; repeat: number }

// An error storm (SSE reconnect loops, sync failures) must not replay dozens
// of stale toasts for minutes: the queue is capped, consecutive duplicates
// collapse into a ×N counter, and a new error flushes queued info toasts.
const MAX_QUEUED_TOASTS = 5

export function sameToast(a: ToastOptions, b: ToastOptions) {
  return a.variant === b.variant && a.title === b.title && a.message === b.message
}

export function createToastStore() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
    currentRepeat: 1,
    queue: [] as QueuedToast[],
  })

  let cancelToastTimeout: (() => void) | undefined

  function scheduleNextToast(entry: QueuedToast) {
    setStore("currentToast", entry.options)
    setStore("currentRepeat", entry.repeat)
    cancelToastTimeout?.()
    cancelToastTimeout = scheduleTuiTimeout(
      () => {
        cancelToastTimeout = undefined
        const [nextToast, ...remaining] = store.queue
        setStore("queue", remaining)
        if (nextToast) {
          scheduleNextToast(nextToast)
          return
        }
        setStore("currentToast", null)
        setStore("currentRepeat", 1)
      },
      {
        name: "toast-auto-dismiss",
        delayMs: entry.options.duration ?? 5000,
        unref: true,
      },
    )
  }

  const toast = {
    show(options: ToastOptions) {
      // Never throw from a toast — show() is called from event/error handlers,
      // and a synchronous zod failure there becomes an unhandled fault that
      // masks the original error being reported.
      const parsed = NotificationEvent.ToastShow.properties.safeParse(options)
      const parsedOptions: ToastOptions = parsed.success
        ? parsed.data
        : {
            variant: "error",
            message: typeof (options as { message?: unknown })?.message === "string" ? options.message : "Unknown error",
          }
      if (store.currentToast && sameToast(store.currentToast, parsedOptions)) {
        setStore("currentRepeat", (repeat) => repeat + 1)
        return
      }
      const lastQueued = store.queue.at(-1)
      if (lastQueued && sameToast(lastQueued.options, parsedOptions)) {
        setStore("queue", store.queue.length - 1, "repeat", (repeat) => repeat + 1)
        return
      }
      if (store.currentToast) {
        setStore("queue", (queue) => {
          // A fresh error supersedes stale informational toasts.
          const kept = parsedOptions.variant === "error" ? queue.filter((t) => t.options.variant !== "info") : queue
          // Cap the backlog: drop the oldest (most stale) entries first.
          return [...kept, { options: parsedOptions, repeat: 1 }].slice(-MAX_QUEUED_TOASTS)
        })
        return
      }
      scheduleNextToast({ options: parsedOptions, repeat: 1 })
    },
    error: (err: any) => {
      if (err instanceof Error)
        return toast.show({
          variant: "error",
          message: err.message,
        })
      toast.show({
        variant: "error",
        message: "An unknown error has occurred",
      })
    },
    get currentToast(): ToastOptions | null {
      return store.currentToast
    },
    get currentRepeat(): number {
      return store.currentRepeat
    },
    dispose() {
      cancelToastTimeout?.()
      cancelToastTimeout = undefined
      setStore("currentToast", null)
      setStore("currentRepeat", 1)
      setStore("queue", [])
    },
  }
  return toast
}

export type ToastContext = ReturnType<typeof createToastStore>

const ctx = createContext<ToastContext>()

export function ToastProvider(props: ParentProps) {
  const value = createToastStore()
  onCleanup(() => value.dispose())
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return value
}
