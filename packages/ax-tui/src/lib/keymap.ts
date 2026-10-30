import { Renderable, RenderableEvents } from "../core/renderable.js"
import type { CliRenderer } from "../core/renderer.js"
import type { KeyEvent } from "./key-handler.js"

export interface KeymapBinding {
  id: string
  /** A chord such as ctrl+k, or a sequence such as ["ctrl+k", "ctrl+c"]. */
  keys: string | readonly string[]
  description?: string
  handler: (event: KeyEvent) => void
}

export interface KeymapLayer {
  bindings: readonly KeymapBinding[]
  /** Omit for global bindings. Targets must belong to this renderer. */
  target?: Renderable
  scope?: "focus" | "focus-within"
  priority?: number
  enabled?: () => boolean
}

export interface ActiveKeymapBinding {
  id: string
  keys: readonly string[]
  description?: string
  priority: number
  target?: Renderable
}

interface Chord {
  name: string
  ctrl: boolean
  shift: boolean
  meta: boolean
  super: boolean
  hyper: boolean
}

interface Binding {
  info: ActiveKeymapBinding
  chords: Chord[]
  handler: KeymapBinding["handler"]
}

interface Layer {
  options: KeymapLayer
  bindings: Binding[]
  serial: number
  remove: () => void
}

const managers = new WeakMap<CliRenderer, Keymap>()
const aliases: Record<string, string> = { enter: "return", esc: "escape", space: " ", plus: "+" }

function parseChord(value: string): Chord {
  const parts = value.toLowerCase().split("+")
  const key = parts.pop()!
  if (!key || parts.some((part) => !["ctrl", "shift", "alt", "meta", "super", "hyper"].includes(part))) {
    throw new TypeError(`Invalid keymap chord: ${value}`)
  }
  if (new Set(parts.map((part) => part === "alt" ? "meta" : part)).size !== parts.length) {
    throw new TypeError(`Duplicate keymap modifier: ${value}`)
  }
  return {
    name: aliases[key] ?? key, ctrl: parts.includes("ctrl"), shift: parts.includes("shift"),
    meta: parts.includes("meta") || parts.includes("alt"), super: parts.includes("super"),
    hyper: parts.includes("hyper"),
  }
}

function matches(chord: Chord, event: KeyEvent): boolean {
  return chord.name === (aliases[event.name.toLowerCase()] ?? event.name.toLowerCase()) &&
    chord.ctrl === !!event.ctrl && chord.shift === !!event.shift && chord.meta === !!event.meta &&
    chord.super === !!event.super && chord.hyper === !!event.hyper
}

/** Renderer-owned, opt-in keyboard routing. Registrations own no renderables. */
export class Keymap {
  private layers: Layer[] = []
  private serial = 0
  private disposed = false
  private pending?: { layer: Layer; bindings: Binding[]; index: number; event: KeyEvent }
  private timer?: ReturnType<typeof setTimeout>

  private constructor(private readonly renderer: CliRenderer, readonly sequenceTimeoutMs: number) {
    renderer.keyInput.on("keypress", this.dispatch)
    renderer.keyInput.on("paste", this.cancelSequence)
    renderer.on("focused_renderable", this.cancelSequence)
    renderer.on("blur", this.cancelSequence)
    renderer.once("destroy", this.dispose)
  }

  static forRenderer(renderer: CliRenderer, options: { sequenceTimeoutMs?: number } = {}): Keymap {
    if (renderer.isDestroyed) throw new Error("Cannot create a keymap on a destroyed renderer")
    const timeout = options.sequenceTimeoutMs ?? 750
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) {
      throw new RangeError("Keymap sequence timeout must be an integer from 1 to 60000")
    }
    const existing = managers.get(renderer)
    if (existing) {
      if (options.sequenceTimeoutMs !== undefined && timeout !== existing.sequenceTimeoutMs) {
        throw new Error("This renderer already has a keymap with a different sequence timeout")
      }
      return existing
    }
    const keymap = new Keymap(renderer, timeout)
    managers.set(renderer, keymap)
    return keymap
  }

  register(options: KeymapLayer): () => void {
    if (this.disposed) throw new Error("Keymap is disposed")
    if (options.target && (options.target.isDestroyed || options.target.ctx !== this.renderer)) {
      throw new Error("Keymap target must be a live renderable belonging to this renderer")
    }
    if (!Number.isFinite(options.priority ?? 0)) throw new RangeError("Keymap priority must be finite")
    if (options.scope !== undefined && !["focus", "focus-within"].includes(options.scope)) {
      throw new TypeError("Invalid keymap scope")
    }
    const ids = new Set<string>()
    const sequences = new Set<string>()
    const bindings = options.bindings.map((binding): Binding => {
      const keys = typeof binding.keys === "string" ? [binding.keys] : [...binding.keys]
      if (!binding.id || ids.has(binding.id) || !keys.length || keys.length > 16) {
        throw new TypeError("Keymap bindings need unique nonempty IDs and 1 to 16 chords")
      }
      const chords = keys.map(parseChord)
      const signature = JSON.stringify(chords)
      if (sequences.has(signature)) throw new TypeError("Duplicate keymap sequence in one layer")
      ids.add(binding.id)
      sequences.add(signature)
      return {
        info: { id: binding.id, keys, description: binding.description, priority: options.priority ?? 0,
          target: options.target },
        chords, handler: binding.handler,
      }
    })
    const layer: Layer = { options: { ...options }, bindings, serial: ++this.serial, remove: () => {} }
    layer.remove = () => {
      this.layers = this.layers.filter((item) => item !== layer)
      layer.options.target?.off(RenderableEvents.DESTROYED, layer.remove)
      if (this.pending?.layer === layer) this.cancelSequence()
    }
    options.target?.once(RenderableEvents.DESTROYED, layer.remove)
    this.layers.push(layer)
    this.cancelSequence()
    return layer.remove
  }

  private distance(layer: Layer): number {
    if (!this.layers.includes(layer)) return -1
    let enabled = true
    try {
      enabled = layer.options.enabled?.() !== false
    } catch {
      // A broken predicate disables only its own layer.
      enabled = false
    }
    if (!enabled) return -1
    // User predicates may synchronously unregister or dispose the manager.
    if (this.disposed || !this.layers.includes(layer)) return -1
    const target = layer.options.target
    if (!target) return Number.MAX_SAFE_INTEGER
    // Detached or hidden scopes must never intercept application input.
    let attached = false
    for (let node: Renderable | null = target; node; node = node.parent instanceof Renderable ? node.parent : null) {
      if (node.isDestroyed || !node.visible) return -1
      if (node === this.renderer.root) {
        attached = true
        break
      }
    }
    if (!attached) return -1
    let distance = 0
    for (let node = this.renderer.currentFocusedRenderable; node;
      node = node.parent instanceof Renderable ? node.parent : null) {
      if (node === target) return distance
      if (layer.options.scope === "focus") break
      distance++
    }
    return -1
  }

  private activeLayers(): Layer[] {
    return [...this.layers].map((layer) => ({ layer, distance: this.distance(layer) }))
      .filter(({ distance }) => distance >= 0)
      .sort((a, b) => (b.layer.options.priority ?? 0) - (a.layer.options.priority ?? 0) ||
        a.distance - b.distance || b.layer.serial - a.layer.serial)
      .map(({ layer }) => layer)
  }

  /** Eligible bindings, in dispatch order. Includes bindings shadowed by earlier layers. */
  getActiveBindings(): ActiveKeymapBinding[] {
    return this.activeLayers().flatMap((layer) => layer.bindings.map(({ info }) => ({ ...info, keys: [...info.keys] })))
  }

  get pendingKeys(): readonly string[] {
    return this.pending?.bindings[0]?.info.keys.slice(0, this.pending.index) ?? []
  }

  cancelSequence = (): void => {
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = undefined
  }

  private invoke(layer: Layer, binding: Binding, event: KeyEvent): void {
    this.cancelSequence()
    if (!this.disposed && this.distance(layer) >= 0) binding.handler(event)
  }

  private accept(layer: Layer, bindings: Binding[], index: number, event: KeyEvent): void {
    event.preventDefault()
    event.stopPropagation()
    this.cancelSequence()
    const exact = bindings.find((binding) => binding.chords.length === index)
    if (bindings.every((binding) => binding.chords.length === index)) {
      if (exact) this.invoke(layer, exact, event)
      return
    }
    this.pending = { layer, bindings, index, event }
    this.timer = setTimeout(() => {
      this.cancelSequence()
      // Timeout dispatch has the same error boundary as ordinary keyInput listeners.
      if (exact) {
        try {
          this.invoke(layer, exact, event)
        } catch (error) {
          console.error("[Keymap] Sequence handler failed:", error)
        }
      }
    }, this.sequenceTimeoutMs)
    this.timer.unref?.()
  }

  private dispatch = (event: KeyEvent): void => {
    if (this.disposed || event.defaultPrevented || event.propagationStopped || event.eventType === "release") return
    const pending = this.pending
    if (pending) {
      if (event.name === "escape") {
        this.cancelSequence()
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.repeated) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const next = this.distance(pending.layer) < 0 ? [] : pending.bindings.filter((binding) => {
        const chord = binding.chords[pending.index]
        return chord && matches(chord, event)
      })
      if (next.length) {
        this.accept(pending.layer, next, pending.index + 1, event)
        return
      }
      // Failed prefixes are not replayed into an editor. Retry this key as a new chord.
      this.cancelSequence()
    }
    for (const layer of this.activeLayers()) {
      const matchesFirst = layer.bindings.filter((binding) => matches(binding.chords[0], event))
      if (!matchesFirst.length || this.distance(layer) < 0) continue
      this.accept(layer, matchesFirst, 1, event)
      return
    }
  }

  dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    this.cancelSequence()
    for (const layer of [...this.layers]) layer.remove()
    this.renderer.keyInput.off("keypress", this.dispatch)
    this.renderer.keyInput.off("paste", this.cancelSequence)
    this.renderer.off("focused_renderable", this.cancelSequence)
    this.renderer.off("blur", this.cancelSequence)
    this.renderer.off("destroy", this.dispose)
    managers.delete(this.renderer)
  }
}

export function getKeymap(renderer: CliRenderer, options?: { sequenceTimeoutMs?: number }): Keymap {
  return Keymap.forRenderer(renderer, options)
}
