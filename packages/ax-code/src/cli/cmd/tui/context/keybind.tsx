import { createMemo, onCleanup } from "solid-js"
import { Keybind } from "@/util/keybind"
import { pipe, mapValues } from "remeda"
import type { TuiConfig } from "@/config/tui"
import type { ParsedKey, Renderable } from "@ax-code/opentui-core"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@ax-code/opentui-solid"
import { createSimpleContext } from "./helper"
import { useTuiConfig } from "./tui-config"
import { scheduleTuiTimeout } from "@tui/util/timer"
import { blurRenderable, focusRenderable } from "@tui/util/renderable-safety"

export type KeybindKey = keyof NonNullable<TuiConfig.Info["keybinds"]> & string

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const config = useTuiConfig()
    const keybinds = createMemo<Record<string, Keybind.Info[]>>(() => {
      return pipe(
        (config.keybinds ?? {}) as Record<string, string>,
        mapValues((value) => Keybind.parse(value)),
      )
    })
    const [store, setStore] = createStore({
      leader: false,
    })
    const renderer = useRenderer()

    let focus: Renderable | null = null
    let cancelLeaderTimeout: (() => void) | undefined
    let disposed = false
    function leader(active: boolean) {
      if (disposed) return
      if (active) {
        setStore("leader", true)
        focus = renderer.currentFocusedRenderable
        blurRenderable(focus, { name: "keybind-leader-blur-focus" })
        cancelLeaderTimeout?.()
        cancelLeaderTimeout = scheduleTuiTimeout(
          () => {
            cancelLeaderTimeout = undefined
            if (!store.leader) return
            leader(false)
            focusRenderable(focus, { name: "keybind-leader-timeout-focus" })
          },
          {
            name: "keybind-leader-timeout",
            delayMs: 2000,
          },
        )
        return
      }

      if (focus && !renderer.currentFocusedRenderable) {
        focusRenderable(focus, { name: "keybind-leader-restore-focus" })
      }
      setStore("leader", false)
    }

    function parse(evt: ParsedKey): Keybind.Info {
      // Ctrl+- on non-kitty terminals: raw mode emits 0x1F, which the parser
      // reports as name "_" with ctrl. Normalize it back to "-" so `ctrl+-`
      // bindings (e.g. the default input_undo) match. (Mirrored in
      // textarea-keybindings.ts for the opentui textarea path.)
      if (evt.ctrl && evt.name === "_") {
        return Keybind.fromParsedKey({ ...evt, name: "-" }, store.leader)
      }
      return Keybind.fromParsedKey(evt, store.leader)
    }

    function match(key: KeybindKey, evt: ParsedKey) {
      const keybind = keybinds()[key]
      if (!keybind) return false
      const parsed: Keybind.Info = parse(evt)
      for (const key of keybind) {
        if (Keybind.match(key, parsed)) {
          return true
        }
      }
      return false
    }

    function print(key: KeybindKey) {
      const first = keybinds()[key]?.at(0)
      if (!first) return ""
      return Keybind.toDisplayString(first, keybinds().leader?.at(0))
    }

    useKeyboard(async (evt) => {
      if (disposed) return
      if (!store.leader && match("leader", evt)) {
        leader(true)
        return
      }

      if (store.leader && evt.name) {
        setImmediate(() => {
          if (disposed) return
          if (focus && renderer.currentFocusedRenderable === focus) {
            focusRenderable(focus, { name: "keybind-leader-key-focus" })
          }
          leader(false)
        })
      }
    })

    onCleanup(() => {
      disposed = true
      cancelLeaderTimeout?.()
    })

    const result = {
      get all() {
        return keybinds()
      },
      get leader() {
        return store.leader
      },
      parse,
      match,
      print,
    }
    return result
  },
})
