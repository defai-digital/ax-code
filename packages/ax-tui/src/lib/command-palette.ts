import type { CliRenderer } from "../core/renderer.js"
import { RenderableEvents } from "../core/renderable.js"
import { BoxRenderable } from "../renderables/Box.js"
import { InputRenderable, InputRenderableEvents } from "../renderables/Input.js"
import { TextRenderable } from "../renderables/Text.js"
import { VirtualListRenderable } from "../renderables/VirtualList.js"
import { captureCommandContext, getCommandRegistry, type CommandMetadata, type CommandRegistry,
  type CommandResult } from "./commands.js"
import { getFocusManager } from "./focus.js"
import { getKeymap } from "./keymap.js"
import { getOverlayManager, type OverlayHandle, type OverlayOptions } from "./overlay.js"

export interface CommandPaletteOptions {
  registry?: CommandRegistry
  query?: string
  placeholder?: string
  emptyText?: string
  overlay?: Omit<OverlayOptions, "focus" | "nonCapturing">
}

export interface CommandPaletteHandle {
  readonly input: InputRenderable
  readonly selectedId: string | null
  /** Resolves after command completion, or null when closed without executing. Never rejects. */
  readonly result: Promise<CommandResult | null>
  setQuery(query: string): void
  refresh(): void
  executeSelected(): Promise<CommandResult | null>
  close(): void
}

interface PaletteRow { command: CommandMetadata; selected: boolean }

/** A renderer-owned overlay using the same command registry as application shortcuts. */
export function showCommandPalette(renderer: CliRenderer, options: CommandPaletteOptions = {}): CommandPaletteHandle {
  const registry = options.registry ?? getCommandRegistry(renderer)
  if (registry.renderer !== renderer || renderer.isDestroyed) {
    throw new Error("Command palette requires a registry belonging to this live renderer")
  }
  const context = captureCommandContext(renderer)
  const content = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column",
    border: true, backgroundColor: "#161b22" })
  let input: InputRenderable
  let list: VirtualListRenderable<PaletteRow>
  let empty: TextRenderable
  let overlay: OverlayHandle | undefined
  let removeKeys = () => {}
  let removeScope = () => {}
  let closed = false
  let executing = false
  let settled = false
  let refreshing = false
  let entries: readonly CommandMetadata[] = []
  let selectedId: string | null = null
  const completion = Promise.withResolvers<CommandResult | null>()
  const finish = (result: CommandResult | null) => {
    if (settled) return
    settled = true
    completion.resolve(result)
  }
  const close = () => {
    if (closed) return
    closed = true
    registry.off("change", refresh)
    removeKeys()
    removeScope()
    input?.off(InputRenderableEvents.INPUT, refresh)
    content.off(RenderableEvents.DESTROYED, close)
    input?.off(RenderableEvents.DESTROYED, close)
    try {
      overlay?.close()
    } finally {
      content.destroyRecursively()
      if (!executing) finish(null)
    }
  }
  function refresh(): void {
    if (closed || refreshing) return
    refreshing = true
    try {
      entries = registry.search(input.value, context)
      if (closed || content.isDestroyed) return
      if (!entries.some((entry) => entry.id === selectedId)) selectedId = entries[0]?.id ?? null
      const rows = entries.map((command) => ({ command, selected: command.id === selectedId }))
      list.items = rows
      empty.visible = rows.length === 0
      list.visible = rows.length > 0
      const index = entries.findIndex((entry) => entry.id === selectedId)
      if (index >= 0) list.scrollToIndex(index)
    } finally {
      refreshing = false
    }
  }
  const select = (direction: number) => {
    if (closed || !entries.length) return
    const index = entries.findIndex((entry) => entry.id === selectedId)
    selectedId = entries[(index + direction + entries.length) % entries.length]!.id
    refresh()
  }
  const executeSelected = async (): Promise<CommandResult | null> => {
    if (closed || executing || !selectedId) return null
    const id = selectedId
    const entry = entries.find((candidate) => candidate.id === id)
    if (!entry?.enabled) return { status: "disabled" }
    executing = true
    // OverlayManager restores the original focus before enabled/run callbacks execute.
    try {
      close()
      const result = await registry.execute(id, context)
      finish(result)
      return result
    } catch (error) {
      const result: CommandResult = { status: "error", error }
      finish(result)
      return result
    }
  }

  try {
    input = new InputRenderable(renderer, { width: "100%", value: options.query ?? "", maxLength: 256,
      placeholder: options.placeholder ?? "Search commands..." })
    content.add(input)
    list = new VirtualListRenderable<PaletteRow>(renderer, { width: "100%", flexGrow: 1, minHeight: 0,
      items: [], getKey: (row) => row.command.id, estimateHeight: 1,
      renderItem: (row, _index, ctx) => new TextRenderable(ctx, {
        height: 1, width: "100%", wrapMode: "none",
        content: `${row.selected ? ">" : " "} ${row.command.title}${row.command.enabled ? "" : " (unavailable)"}`,
        fg: row.command.enabled ? "#ffffff" : "#8b949e", bg: row.selected ? "#264f78" : "transparent",
        onMouseDown() {
          if (!closed) {
            selectedId = row.command.id
            refresh()
          }
        },
      }),
    })
    content.add(list)
    empty = new TextRenderable(renderer, { height: 1, content: options.emptyText ?? "No matching commands." })
    content.add(empty)
    content.once(RenderableEvents.DESTROYED, close)
    input.once(RenderableEvents.DESTROYED, close)
    input.on(InputRenderableEvents.INPUT, refresh)
    registry.on("change", refresh)
    overlay = getOverlayManager(renderer).show(content, {
      width: 64, height: 12, margin: 1, ...options.overlay, focus: input,
    })
    removeScope = getFocusManager(renderer).registerScope(content, { modal: true })
    removeKeys = getKeymap(renderer).register({ target: content, priority: 1000, bindings: [
      { id: "palette.next", keys: "down", handler: () => select(1) },
      { id: "palette.previous", keys: "up", handler: () => select(-1) },
      { id: "palette.execute", keys: "enter", handler: () => { void executeSelected() } },
      { id: "palette.close", keys: "escape", handler: close },
    ] })
    refresh()
  } catch (error) {
    close()
    throw error
  }
  return { input, get selectedId() { return selectedId }, result: completion.promise,
    setQuery(query) { if (!closed) input.value = query }, refresh, executeSelected, close }
}
