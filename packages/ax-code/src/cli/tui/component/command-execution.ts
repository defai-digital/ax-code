import stripAnsi from "strip-ansi"
import {
  captureCommandContext,
  getCommandRegistry,
  type CliRenderer,
  type CommandContext,
  type CommandResult,
} from "ax-tui"
import type { DialogContext } from "@tui/ui/dialog"
import type { CommandOption } from "./dialog-command"

type Invocation = { route: "keybind" | "trigger" | "slash"; args?: string; scope: string }

/** The product's reactive entries remain the only catalog; the registry executes them. */
export function createCommandExecutor(input: {
  renderer: CliRenderer
  entries: () => readonly CommandOption[]
  scope: () => string
  dialog: DialogContext
  record: (option: CommandOption) => void
}) {
  const registry = getCommandRegistry(input.renderer)
  const invocations = new WeakMap<CommandContext, Invocation>()
  let snapshot: readonly CommandOption[] | undefined
  const ids = new Map<CommandOption, string>()
  let removals: (() => void)[] = []
  let disposed = false

  function clearRegistrations() {
    const callbacks = removals
    removals = []
    ids.clear()
    snapshot = undefined
    const errors: unknown[] = []
    for (const remove of callbacks) {
      try {
        remove()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, "Failed to remove command registrations")
  }

  function sync() {
    const entries = input.entries()
    if (disposed || input.renderer.isDestroyed || entries === snapshot) return
    clearRegistrations()
    const occurrences = new Map<string, number>()
    try {
      for (const option of entries) {
        const value = encodeURIComponent(option.value.toWellFormed())
        const occurrence = occurrences.get(value) ?? 0
        occurrences.set(value, occurrence + 1)
        const id = `ax-code.command/${value}/${occurrence}`
        ids.set(option, id)
        removals.push(
          registry.register({
            id,
            title:
              stripAnsi(option.title)
                .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
                .trim() || id,
            description: option.description,
            keywords: option.slash ? [option.slash.name, ...(option.slash.aliases ?? [])] : [],
            enabled: (context) =>
              !disposed &&
              input.entries().includes(option) &&
              option.enabled !== false &&
              option.disabled !== true &&
              (!invocations.has(context) || invocations.get(context)!.scope === input.scope()),
            run: async (context) => {
              const invocation = invocations.get(context)
              const scope = invocation?.scope ?? input.scope()
              const current = () => !disposed && !input.renderer.isDestroyed && scope === input.scope()
              let ownedDialog = input.dialog.stack.at(-1)
              // Async commands may finish after navigation. They may not replace or
              // clear the new session's dialog; rejected dialog prompts settle as cancelled.
              const dialog = new Proxy(input.dialog, {
                get(target, key, receiver) {
                  const value = Reflect.get(target, key, receiver)
                  if (typeof value !== "function") return value
                  return (...args: unknown[]) => {
                    if (current()) {
                      const result = Reflect.apply(value, target, args)
                      if (key === "replace" || key === "clear") ownedDialog = target.stack.at(-1)
                      return result
                    }
                    if (
                      !disposed &&
                      !input.renderer.isDestroyed &&
                      key === "clear" &&
                      ownedDialog &&
                      target.stack.at(-1) === ownedDialog
                    )
                      return target.clear()
                    if (key === "replace" && typeof args[1] === "function") args[1]()
                    if (key === "registerEscapeHandler") return () => {}
                  }
                },
              })
              if (invocation?.route !== "keybind") input.record(option)
              if (invocation?.args !== undefined) await option.onSlashArguments?.(invocation.args, dialog)
              else await option.onSelect?.(dialog)
            },
          }),
        )
      }
      snapshot = entries
    } catch (error) {
      try {
        clearRegistrations()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Failed to register and clean up commands")
      }
      throw error
    }
  }

  async function execute(option: CommandOption, route: Invocation["route"], args?: string): Promise<CommandResult> {
    const scope = input.scope()
    // Preserve the old asynchronous dispatch boundary, but recheck live entries
    // and application scope before invoking a captured row or shortcut.
    await Promise.resolve()
    if (disposed || input.renderer.isDestroyed) return { status: "disposed" }
    if (args !== undefined && (route !== "slash" || !option.onSlashArguments)) return { status: "disabled" }
    if (scope !== input.scope()) return { status: "stale-context" }
    sync()
    const id = ids.get(option)
    if (!id) return { status: "stale-context" }
    const context = captureCommandContext(input.renderer)
    invocations.set(context, { route, args, scope })
    try {
      return await registry.execute(id, context)
    } finally {
      invocations.delete(context)
    }
  }

  return {
    sync,
    execute,
    dispose() {
      disposed = true
      clearRegistrations()
    },
  }
}
