import { createSprite, createTerminalClient, detectCapabilities } from "@ax-code/akitty-sdk"
import type { Environment, Scheduler } from "@ax-code/akitty-sdk"

export type TuiProgramChromeState = Readonly<{
  enabled: boolean
  busy: boolean
  animations: boolean
  statusText: string
}>

// A/X brand poses for the native title-bar mark. Large terminal scenes and the
// footer braille animation retain their own renderers and capability checks.
const poses = [
  [".##.", "#..#", "####", "#..#"],
  ["#..#", ".##.", ".##.", "#..#"],
]
const busySprite = createSprite(
  4,
  4,
  poses.map((rows) =>
    Uint8Array.from(
      rows
        .join("")
        .split("")
        .flatMap((cell) => (cell === "#" ? [102, 204, 255, 255] : [0, 0, 0, 0])),
    ),
  ),
)

export function supportsTuiProgramChrome(env: Environment, isTTY: boolean) {
  return detectCapabilities(env, isTTY).chrome
}

export function createTuiProgramChrome(options: {
  write: (sequence: string) => boolean
  supported: boolean
  schedule?: Scheduler
  onError: (error: unknown) => void
}) {
  let previous: string | undefined
  const client = createTerminalClient({
    capabilities: { title: false, chrome: options.supported },
    write(sequence) {
      try {
        const written = options.write(sequence)
        if (!written) previous = undefined
        return written
      } catch (error) {
        previous = undefined
        throw error
      }
    },
    schedule: options.schedule,
    onError: options.onError,
  })
  return {
    update(state: TuiProgramChromeState) {
      if (!state.enabled || !state.busy) {
        previous = undefined
        return client.clearChrome()
      }
      const key = JSON.stringify([state.statusText, state.animations])
      if (previous === key) return false
      const status = { text: state.statusText, tone: "info" as const }
      const written = state.animations
        ? client.updateChrome({ status, progress: "indeterminate" }) &&
          client.playSprite({ sprite: busySprite, intervalMs: 250 })
        : client.updateChrome({ status, progress: "indeterminate", sprite: busySprite, mark: 0 })
      if (written) previous = key
      return written
    },
    dispose: () => client.dispose(),
  }
}

let active: { owner: object; controller: ReturnType<typeof createTuiProgramChrome> } | undefined

/** Shared by component, renderer and crash teardown, without importing the renderer. */
export function disposeTuiProgramChrome() {
  const previous = active
  active = undefined
  previous?.controller.dispose()
  return Boolean(previous)
}

export function updateTuiProgramChrome(
  state: TuiProgramChromeState,
  options: {
    owner: object
    write: (sequence: string) => boolean
    env: Environment
    isTTY: boolean
    onError: (error: unknown) => void
  },
) {
  if (!state.enabled || !supportsTuiProgramChrome(options.env, options.isTTY)) return disposeTuiProgramChrome()
  if (active && active.owner !== options.owner) disposeTuiProgramChrome()
  active ??= {
    owner: options.owner,
    controller: createTuiProgramChrome({ write: options.write, supported: true, onError: options.onError }),
  }
  return active.controller.update(state)
}
