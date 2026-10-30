import { getCommandRegistry, getFocusManager, RenderableEvents, showCommandPalette,
  type CommandDefinition, type CommandPaletteHandle, type CommandPaletteOptions, type FocusScopeOptions,
  type Renderable } from "@defai-digital/ax-tui"
import { onCleanup } from "solid-js"
import { useRenderer } from "./hooks.js"

export function useFocusManager() {
  const manager = getFocusManager(useRenderer())
  const scopes = new Set<() => void>()
  let disposed = false
  onCleanup(() => {
    disposed = true
    for (const remove of [...scopes]) remove()
  })
  return {
    registerScope(root: Renderable, options?: FocusScopeOptions): () => void {
      if (disposed) throw new Error("Focus scope owner is disposed")
      const unregister = manager.registerScope(root, options)
      const remove = () => {
        scopes.delete(remove)
        root.off(RenderableEvents.DESTROYED, remove)
        unregister()
      }
      scopes.add(remove)
      root.once(RenderableEvents.DESTROYED, remove)
      return remove
    },
    focusNext: () => !disposed && manager.focusNext(),
    focusPrevious: () => !disposed && manager.focusPrevious(),
  }
}

export function useCommands() {
  const registry = getCommandRegistry(useRenderer())
  const registrations = new Set<() => void>()
  let disposed = false
  onCleanup(() => {
    disposed = true
    for (const remove of [...registrations]) remove()
  })
  return {
    register(command: CommandDefinition, target?: Renderable): () => void {
      if (disposed) throw new Error("Command owner is disposed")
      const unregister = registry.register(command, target)
      const remove = () => {
        registrations.delete(remove)
        target?.off(RenderableEvents.DESTROYED, remove)
        unregister()
      }
      registrations.add(remove)
      target?.once(RenderableEvents.DESTROYED, remove)
      return remove
    },
    execute: registry.execute.bind(registry),
    search: registry.search.bind(registry),
  }
}

export function useCommandPalette() {
  const renderer = useRenderer()
  const palettes = new Set<CommandPaletteHandle>()
  let disposed = false
  onCleanup(() => {
    disposed = true
    for (const palette of [...palettes]) palette.close()
    palettes.clear()
  })
  return {
    show(options?: CommandPaletteOptions): CommandPaletteHandle {
      if (disposed) throw new Error("Command palette owner is disposed")
      const palette = showCommandPalette(renderer, options)
      const scoped = { ...palette, get selectedId() { return palette.selectedId },
        close() {
          palettes.delete(scoped)
          palette.close()
        },
      }
      palettes.add(scoped)
      void palette.result.then(() => palettes.delete(scoped))
      return scoped
    },
  }
}
