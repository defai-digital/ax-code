import { EventEmitter } from "events"

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      payload: any
    },
  ]
}>()

// GlobalBus is an intentional broadcast hub — the default max listener
// count of 10 is too low because each SSE client connected to
// /global/event registers a dedicated listener, and the TUI worker,
// workspace-server and tests all add their own on top. Node otherwise
// prints MaxListenersExceededWarning. The warning does not affect event
// delivery; this explicit ceiling reflects the expected number of concurrent
// SSE clients. Individual listeners are still removed via `off` on disconnect.
GlobalBus.setMaxListeners(200)
