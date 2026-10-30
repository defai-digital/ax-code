import type { RenderContext } from "../core/types.js"
import { createKeymapHelpEntries, type KeymapHelpBinding, type KeymapHelpEntry } from "../lib/keymap-help.js"
import { TextRenderable, type TextOptions } from "./Text.js"

export interface KeymapHelpOptions extends Omit<TextOptions, "content"> {
  /** Eligible bindings, normally obtained from getActiveBindings(). Updated explicitly by the caller. */
  bindings?: readonly KeymapHelpBinding[]
  query?: string
  emptyText?: string
}

function snapshot(bindings: readonly KeymapHelpBinding[]): KeymapHelpBinding[] {
  return bindings.map(({ id, keys, description }) => ({ id, keys: [...keys], description }))
}

function helpContent(entries: readonly KeymapHelpEntry[], emptyText: string): string {
  return entries.length ? entries.map((entry) => `${entry.shortcut}  ${entry.description}`).join("\n") : emptyText
}

/** Searchable, display-only help. Owns no keymap, input handlers, focus, or refresh timers. */
export class KeymapHelpRenderable extends TextRenderable {
  private _bindings: readonly KeymapHelpBinding[]
  private _query: string
  private _emptyText: string
  private _matchCount: number

  constructor(context: RenderContext, options: KeymapHelpOptions = {}) {
    const { bindings = [], query = "", emptyText = "No matching shortcuts.", ...textOptions } = options
    const copied = snapshot(bindings)
    const entries = createKeymapHelpEntries(copied, query)
    super(context, { ...textOptions, content: helpContent(entries, emptyText) })
    this._bindings = copied
    this._query = query
    this._emptyText = emptyText
    this._matchCount = entries.length
  }

  get bindings(): readonly KeymapHelpBinding[] {
    return snapshot(this._bindings)
  }

  set bindings(value: readonly KeymapHelpBinding[] | undefined) {
    if (this.isDestroyed) return
    const next = snapshot(value ?? [])
    const entries = createKeymapHelpEntries(next, this._query)
    this._bindings = next
    this.updateHelp(entries)
  }

  get query(): string {
    return this._query
  }

  set query(value: string | undefined) {
    if (this.isDestroyed) return
    const next = value ?? ""
    const entries = createKeymapHelpEntries(this._bindings, next)
    this._query = next
    this.updateHelp(entries)
  }

  get emptyText(): string {
    return this._emptyText
  }

  set emptyText(value: string | undefined) {
    if (this.isDestroyed) return
    this._emptyText = value ?? "No matching shortcuts."
    if (!this._matchCount) this.content = this._emptyText
  }

  get matchCount(): number {
    return this._matchCount
  }

  private updateHelp(entries: readonly KeymapHelpEntry[]): void {
    this._matchCount = entries.length
    this.content = helpContent(entries, this._emptyText)
  }
}
