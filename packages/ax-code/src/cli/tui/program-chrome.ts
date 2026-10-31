import { createSprite, createTerminalClient, detectCapabilities } from "@ax-code/akitty-sdk"
import type { Environment, Scheduler } from "@ax-code/akitty-sdk"
import { AKITTY_CAT_FRAMES, AKITTY_CAT_FRAME_MS } from "./akitty-cat"
import { AKITTY_CHICK_FRAMES, AKITTY_CHICK_FRAME_MS } from "./akitty-chick"
import { AKITTY_DOG_FRAMES, AKITTY_DOG_FRAME_MS } from "./akitty-dog"
import { AKITTY_DRAGON_FRAMES, AKITTY_DRAGON_FRAME_MS } from "./akitty-dragon"
import { AKITTY_PIXEL_PX } from "./akitty-pixel"
import { AKITTY_RED_PANDA_FRAMES, AKITTY_RED_PANDA_FRAME_MS } from "./akitty-red-panda"

export type TuiProgramChromeState = Readonly<{
  enabled: boolean
  busy: boolean
  animations: boolean
  statusText: string
}>

// AkiTTY's tab activity mark is a pixel animal (akitty-cat.ts, akitty-chick.ts,
// akitty-red-panda.ts, akitty-dragon.ts, akitty-dog.ts), picked at random each
// time a session starts working. AkiTTY sprites hold at most four frames, so
// each frame is its own one-frame sprite and this module, not the SDK, advances
// them.
const animation = (name: string, frames: readonly Uint8Array[], frameMs: number) => ({
  name,
  frameMs,
  sprites: frames.map((frame) => createSprite(AKITTY_PIXEL_PX, AKITTY_PIXEL_PX, [frame])),
})
export const TUI_PROGRAM_CHROME_ANIMATIONS = [
  animation("cat", AKITTY_CAT_FRAMES, AKITTY_CAT_FRAME_MS),
  animation("chick", AKITTY_CHICK_FRAMES, AKITTY_CHICK_FRAME_MS),
  animation("red panda", AKITTY_RED_PANDA_FRAMES, AKITTY_RED_PANDA_FRAME_MS),
  animation("dragon", AKITTY_DRAGON_FRAMES, AKITTY_DRAGON_FRAME_MS),
  animation("dog", AKITTY_DOG_FRAMES, AKITTY_DOG_FRAME_MS),
] as const
type Animation = (typeof TUI_PROGRAM_CHROME_ANIMATIONS)[number]

const scheduleInterval: Scheduler = (tick, intervalMs) => {
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

export function supportsTuiProgramChrome(env: Environment, isTTY: boolean) {
  return detectCapabilities(env, isTTY).chrome
}

export function createTuiProgramChrome(options: {
  write: (sequence: string) => boolean
  supported: boolean
  schedule?: Scheduler
  random?: () => number
  onError: (error: unknown) => void
}) {
  let previous: string | undefined
  let animationsEnabled = false
  let frame = 0
  // Chosen when a busy period starts and kept through status changes, so a
  // retry does not swap animals mid-run.
  let current: Animation | undefined
  let generation = 0
  let stopTimer: (() => void) | undefined
  const stop = () => {
    generation++
    const cancel = stopTimer
    stopTimer = undefined
    cancel?.()
  }
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
    onError: options.onError,
  })
  // A failed frame stops playback and forgets the state, so the next update
  // starts it again instead of deduplicating against a document never shown.
  const tick = () => {
    if (!current) return
    frame = (frame + 1) % current.sprites.length
    try {
      if (client.updateChrome({ sprite: current.sprites[frame]!, mark: 0 })) return
    } catch (error) {
      options.onError(error)
    }
    stop()
    previous = undefined
  }
  return {
    update(state: TuiProgramChromeState) {
      if (!state.enabled || !state.busy) {
        stop()
        previous = undefined
        current = undefined
        return client.clearChrome()
      }
      const key = JSON.stringify([state.statusText, state.animations])
      if (previous === key) return false
      // A status or locale change should not rewind a live animation or
      // postpone its next frame. Motion preference changes still reset it.
      const continuing = previous !== undefined && animationsEnabled === state.animations
      if (!continuing) {
        stop()
        frame = 0
      }
      const animations = TUI_PROGRAM_CHROME_ANIMATIONS
      current ??=
        animations[Math.min(animations.length - 1, Math.floor((options.random ?? Math.random)() * animations.length))]!
      const status = { text: state.statusText, tone: "info" as const }
      let written = false
      try {
        written = client.updateChrome({
          status,
          progress: "indeterminate",
          sprite: current.sprites[frame]!,
          mark: 0,
        })
      } finally {
        if (!written) {
          stop()
          previous = undefined
        }
      }
      if (!written) return false
      previous = key
      animationsEnabled = state.animations
      if (state.animations && !continuing) {
        const token = generation
        const cancel = (options.schedule ?? scheduleInterval)(() => {
          if (token === generation) tick()
        }, current.frameMs)
        if (token === generation) stopTimer = cancel
        else cancel()
      }
      return true
    },
    dispose: () => {
      stop()
      client.dispose()
    },
  }
}

type ProgramChromeOptions = {
  owner: object
  write: (sequence: string) => boolean
  env: Environment
  isTTY: boolean
  onError: (error: unknown) => void
}

let active: { owner: object; controller: ReturnType<typeof createTuiProgramChrome> } | undefined
let requested: { state: TuiProgramChromeState; options: ProgramChromeOptions } | undefined
const suspensions = new Set<symbol>()

function clearActiveChrome() {
  const previous = active
  active = undefined
  previous?.controller.dispose()
  return Boolean(previous)
}

/** Shared by component, renderer and crash teardown, without importing the renderer. */
export function disposeTuiProgramChrome() {
  requested = undefined
  return clearActiveChrome()
}

/** Yield the tab activity mark to an external editor and restore only the latest live state. */
export function suspendTuiProgramChrome() {
  const token = Symbol()
  suspensions.add(token)
  try {
    clearActiveChrome()
  } catch (error) {
    suspensions.delete(token)
    throw error
  }
  return () => {
    if (!suspensions.delete(token) || suspensions.size || !requested) return
    updateTuiProgramChrome(requested.state, requested.options)
  }
}

export function updateTuiProgramChrome(state: TuiProgramChromeState, options: ProgramChromeOptions) {
  requested = { state, options }
  if (suspensions.size) return false
  if (!state.enabled || !supportsTuiProgramChrome(options.env, options.isTTY)) return disposeTuiProgramChrome()
  if (active && active.owner !== options.owner) clearActiveChrome()
  active ??= {
    owner: options.owner,
    controller: createTuiProgramChrome({ write: options.write, supported: true, onError: options.onError }),
  }
  return active.controller.update(state)
}
