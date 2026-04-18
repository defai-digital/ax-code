import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "@tui/ui/dialog-select"
import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { useKeyboard, useRenderer } from "@tui/renderer-adapter/opentui"
import { type KeybindKey, useKeybind } from "@tui/context/keybind"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import type { CommandDispatchOwner } from "../input/command-dispatch"
import { resolveCommandKeyDispatch } from "../input/command-dispatch"
import { resolveFocusOwner } from "../input/focus-manager"

type Context = ReturnType<typeof init>
const ctx = createContext<Context>()

export type Slash = {
  name: string
  aliases?: string[]
}

export type CommandOption = DialogSelectOption<string> & {
  keybind?: KeybindKey
  suggested?: boolean
  slash?: Slash
  hidden?: boolean
  enabled?: boolean
  owners?: readonly CommandDispatchOwner[]
}

function init() {
  const [registrations, setRegistrations] = createSignal<Accessor<CommandOption[]>[]>([])
  const [suspendCount, setSuspendCount] = createSignal(0)
  const dialog = useDialog()
  const keybind = useKeybind()
  const route = useRoute()
  const sync = useSync()
  const renderer = useRenderer()

  const entries = createMemo(() => {
    const all = registrations().flatMap((x) => x())
    return all.map((x) => ({
      ...x,
      footer: x.keybind ? keybind.print(x.keybind) : undefined,
    }))
  })

  const isEnabled = (option: CommandOption) => option.enabled !== false
  const isVisible = (option: CommandOption) => isEnabled(option) && !option.hidden

  const visibleOptions = createMemo(() => entries().filter((option) => isVisible(option)))
  const suggestedOptions = createMemo(() =>
    visibleOptions()
      .filter((option) => option.suggested)
      .map((option) => ({
        ...option,
        value: `suggested:${option.value}`,
        category: "Suggested",
      })),
  )
  const suspended = () => suspendCount() > 0
  function currentFocusOwner() {
    const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
    const session = sessionID ? sync.session.get(sessionID) : undefined
    const permissionSessionID = sessionID && (sync.data.permission[sessionID]?.length ?? 0) > 0 ? sessionID : undefined
    const questionSessionID = sessionID && (sync.data.question[sessionID]?.length ?? 0) > 0 ? sessionID : undefined

    return resolveFocusOwner({
      prompt: {
        visible: route.data.type === "session" && !session?.parentID,
        disabled: !!permissionSessionID || !!questionSessionID,
      },
      selection: renderer.getSelection()?.getSelectedText() ? "transcript" : undefined,
      dialog: dialog.kind,
      permissionSessionID,
      questionSessionID,
    })
  }

  useKeyboard((evt) => {
    if (suspended()) return
    if (evt.defaultPrevented) return

    const decision = resolveCommandKeyDispatch({
      owner: currentFocusOwner(),
      event: evt,
      keymap: keybind.all,
      leader: keybind.leader,
      entries: entries().map((option) => ({
        value: option.value,
        keybind: option.keybind,
        enabled: option.enabled,
        hidden: option.hidden,
        owners: option.owners,
      })),
    })

    if (decision.type === "palette") {
      evt.preventDefault()
      result.show()
      return
    }

    if (decision.type === "command") {
      const option = entries().find((item) => item.value === decision.value)
      if (!option || !isEnabled(option)) return
      evt.preventDefault()
      option.onSelect?.(dialog)
      return
    }
  })

  const result = {
    trigger(name: string) {
      for (const option of entries()) {
        if (option.value === name) {
          if (!isEnabled(option)) return
          option.onSelect?.(dialog)
          return
        }
      }
    },
    slashes() {
      return visibleOptions().flatMap((option) => {
        const slash = option.slash
        if (!slash) return []
        return {
          display: "/" + slash.name,
          description: option.description ?? option.title,
          aliases: slash.aliases?.map((alias) => "/" + alias),
          onSelect: () => result.trigger(option.value),
        }
      })
    },
    trySlash(name: string): boolean {
      for (const option of entries()) {
        if (!option.slash) continue
        if (!isEnabled(option)) continue
        if (option.slash.name === name || option.slash.aliases?.includes(name)) {
          option.onSelect?.(dialog)
          return true
        }
      }
      return false
    },
    keybinds(enabled: boolean) {
      setSuspendCount((count) => count + (enabled ? -1 : 1))
    },
    suspended,
    show() {
      dialog.replaceWithKind("command", () => (
        <DialogCommand options={visibleOptions()} suggestedOptions={suggestedOptions()} />
      ))
    },
    register(cb: () => CommandOption[]) {
      const results = createMemo(cb)
      setRegistrations((arr) => [results, ...arr])
      onCleanup(() => {
        setRegistrations((arr) => arr.filter((x) => x !== results))
      })
    },
  }
  return result
}

export function useCommandDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useCommandDialog must be used within a CommandProvider")
  }
  return value
}

export function CommandProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

function DialogCommand(props: { options: CommandOption[]; suggestedOptions: CommandOption[] }) {
  let ref: DialogSelectRef<string>
  const list = () => {
    if (ref?.filter) return props.options
    return [...props.suggestedOptions, ...props.options]
  }
  return <DialogSelect ref={(r) => (ref = r)} title="Commands" options={list()} />
}
