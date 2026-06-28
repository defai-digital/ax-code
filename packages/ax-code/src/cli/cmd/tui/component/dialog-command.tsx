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
import { useKeyboard } from "@ax-code/opentui-solid"
import { type KeybindKey, useKeybind } from "@tui/context/keybind"
import { useToast } from "@tui/ui/toast"
import { useKV } from "@tui/context/kv"
import { recordSlashUse, topSlashRecents, type SlashFrecencyMap } from "./slash-frecency"
import { Log } from "@/util/log"

const SLASH_FRECENCY_KV_KEY = "slash_command_frecency"
const RECENT_MIN_ENTRIES = 2
const RECENT_LIMIT = 3

const log = Log.create({ service: "tui.dialog-command" })

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
}

function init() {
  const [registrations, setRegistrations] = createSignal<Accessor<CommandOption[]>[]>([])
  const [suspendCount, setSuspendCount] = createSignal(0)
  const dialog = useDialog()
  const keybind = useKeybind()
  const toast = useToast()
  const kv = useKV()

  const entries = createMemo(() => {
    const all = registrations().flatMap((x) => x())
    return all.map((x) => ({
      ...x,
      footer: x.keybind ? keybind.print(x.keybind) : undefined,
    }))
  })

  const isEnabled = (option: CommandOption) => option.enabled !== false
  const isVisible = (option: CommandOption) => isEnabled(option) && !option.hidden

  // Wrap each visible option's onSelect so picks made via the dialog UI
  // (which calls onSelect directly, bypassing runCommandAction) are still
  // recorded into frecency. Keyboard/keybind paths still go through
  // runCommandAction and are recorded there.
  const visibleOptions = createMemo(() =>
    entries()
      .filter((option) => isVisible(option))
      .map((option) => {
        const original = option.onSelect
        if (!original) return option
        return {
          ...option,
          onSelect: (dialogApi: any) => {
            recordUsage(option)
            return original(dialogApi)
          },
        }
      }),
  )
  const suggestedOptions = createMemo(() =>
    visibleOptions()
      .filter((option) => option.suggested)
      .map((option) => ({
        ...option,
        value: `suggested:${option.value}`,
        category: "Suggested",
      })),
  )
  // Real-usage-based "Recent" section. Only includes commands the user
  // has actually triggered via the picker — keybind invocations are not
  // recorded because they're already fast.
  const recentOptions = createMemo<CommandOption[]>(() => {
    const map = kv.get(SLASH_FRECENCY_KV_KEY) as SlashFrecencyMap | undefined
    if (!map) return []
    // Only options with a slash field are eligible — sidebar buttons and
    // other programmatic triggers (sidebar `dashboard`, `view all`) go
    // through the same trigger() path and would otherwise pollute the
    // Recent section with actions the user never invoked from the picker.
    const slashOptions = visibleOptions().filter((option) => option.slash)
    const available = new Set(slashOptions.map((option) => option.value))
    const top = topSlashRecents(map, available, RECENT_LIMIT)
    if (top.length < RECENT_MIN_ENTRIES) return []
    const byValue = new Map(slashOptions.map((option) => [option.value, option]))
    const out: CommandOption[] = []
    for (const value of top) {
      const option = byValue.get(value)
      if (!option) continue
      out.push({ ...option, value: `recent:${option.value}`, category: "Recent" } as CommandOption)
    }
    return out
  })
  const suspended = () => suspendCount() > 0

  function recordUsage(option: CommandOption) {
    // Only options surfaceable as slash commands count toward frecency —
    // sidebar buttons (e.g. session.quality "view all") also flow through
    // trigger() and would otherwise grow the map with non-pickable values.
    if (!option.slash) return
    try {
      const current = kv.get(SLASH_FRECENCY_KV_KEY) as SlashFrecencyMap | undefined
      kv.set(SLASH_FRECENCY_KV_KEY, recordSlashUse(current, option.value))
    } catch (error) {
      log.warn("failed to record slash command usage", { error, value: option.value })
    }
  }

  function runCommandAction(option: CommandOption, route: "keybind" | "trigger" | "slash") {
    if (route === "trigger" || route === "slash") recordUsage(option)
    void Promise.resolve()
      .then(() => option.onSelect?.(dialog))
      .catch((error) => {
        log.warn("command action failed", {
          error,
          route,
          value: option.value,
        })
        toast.show({
          message: error instanceof Error ? error.message : `Failed to run ${option.title}`,
          variant: "error",
        })
      })
  }

  useKeyboard((evt) => {
    if (suspended()) return
    if (dialog.stack.length > 0) return
    for (const option of entries()) {
      if (!isEnabled(option)) continue
      if (option.keybind && keybind.match(option.keybind, evt)) {
        evt.preventDefault()
        runCommandAction(option, "keybind")
        return
      }
    }
  })

  const result = {
    trigger(name: string) {
      for (const option of entries()) {
        if (option.value === name) {
          if (!isEnabled(option)) return
          runCommandAction(option, "trigger")
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
          value: "/" + slash.name,
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
          runCommandAction(option, "slash")
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
      dialog.replace(() => (
        <DialogCommand
          options={visibleOptions()}
          suggestedOptions={suggestedOptions()}
          recentOptions={recentOptions()}
        />
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
  const dialog = useDialog()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (value.suspended()) return
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return
    if (keybind.match("command_list", evt)) {
      evt.preventDefault()
      value.show()
      return
    }
  })

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

function DialogCommand(props: {
  options: CommandOption[]
  suggestedOptions: CommandOption[]
  recentOptions: CommandOption[]
}) {
  let ref: DialogSelectRef<string>
  const list = () => {
    // Once the user starts filtering, fall back to the full alphabetical
    // list — same behavior the existing Suggested section already has.
    if (ref?.filter) return props.options
    return [...props.recentOptions, ...props.suggestedOptions, ...props.options]
  }
  return <DialogSelect ref={(r) => (ref = r)} title="Commands" options={list()} />
}
