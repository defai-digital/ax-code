import { createMemo, onCleanup } from "solid-js"
import type { Keybind } from "@/util/keybind"
import type { TuiConfig } from "@/config/tui"
import type { ParsedKey, Renderable } from "@tui/renderer-adapter/opentui"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@tui/renderer-adapter/opentui"
import { createSimpleContext } from "./helper"
import { useTuiConfig } from "./tui-config"
import {
  keymapEvent,
  matchKeymapBinding,
  parseKeymapBindings,
  printKeymapBinding,
  type Keymap,
} from "../input/keymap"

export type KeybindKey = keyof NonNullable<TuiConfig.Info["keybinds"]> & string

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const config = useTuiConfig()
    const keybinds = createMemo<Keymap>(() => parseKeymapBindings((config.keybinds ?? {}) as Record<string, string>))
    const [store, setStore] = createStore({
      leader: false,
    })
    const renderer = useRenderer()

    let focus: Renderable | null
    let timeout: NodeJS.Timeout
    function leader(active: boolean) {
      if (active) {
        setStore("leader", true)
        focus = renderer.currentFocusedRenderable
        focus?.blur()
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => {
          if (!store.leader) return
          leader(false)
          if (!focus || focus.isDestroyed) return
          focus.focus()
        }, 2000)
        return
      }

      if (!active) {
        if (focus && !focus.isDestroyed && !renderer.currentFocusedRenderable) {
          focus.focus()
        }
        setStore("leader", false)
      }
    }

    const result = {
      get all() {
        return keybinds()
      },
      get leader() {
        return store.leader
      },
      parse(evt: ParsedKey): Keybind.Info {
        return keymapEvent(
          evt.name === "\x1F"
            ? {
                ...evt,
                name: "_",
                ctrl: true,
              }
            : evt,
          store.leader,
        )
      },
      bindings(key: KeybindKey) {
        return keybinds()[key] ?? []
      },
      match(key: KeybindKey, evt: ParsedKey) {
        return matchKeymapBinding(
          keybinds(),
          key,
          evt.name === "\x1F"
            ? {
                ...evt,
                name: "_",
                ctrl: true,
              }
            : evt,
          store.leader,
        )
      },
      print(key: KeybindKey) {
        return printKeymapBinding(keybinds(), key)
      },
    }

    onCleanup(() => clearTimeout(timeout))

    useKeyboard(async (evt) => {
      if (!store.leader && result.match("leader", evt)) {
        leader(true)
        return
      }

      if (store.leader && evt.name) {
        setImmediate(() => {
          if (focus && !focus.isDestroyed && renderer.currentFocusedRenderable === focus) {
            focus.focus()
          }
          leader(false)
        })
      }
    })
    return result
  },
})
