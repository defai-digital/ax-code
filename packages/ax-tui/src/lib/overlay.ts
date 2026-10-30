import { BoxRenderable } from "../renderables/Box.js"
import { Renderable, RenderableEvents } from "../core/renderable.js"
import type { CliRenderer } from "../core/renderer.js"

export type OverlaySize = number | `${number}%`
export type OverlayAnchor =
  | "center"
  | "top-left"
  | "top-center"
  | "top-right"
  | "left-center"
  | "right-center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"

export interface OverlayOptions {
  width?: OverlaySize
  height?: OverlaySize
  anchor?: OverlayAnchor
  margin?: number
  offsetX?: number
  offsetY?: number
  /** A focusable descendant of the supplied content. Defaults to the content when focusable. */
  focus?: Renderable
  nonCapturing?: boolean
  /** Evaluated when shown and on renderer resize. */
  visible?: (width: number, height: number) => boolean
}

export interface OverlayHandle {
  /** Remove the overlay permanently and destroy its owned content. Idempotent. */
  close(): void
  setHidden(hidden: boolean): void
  isHidden(): boolean
  /** Focus and raise a visible overlay. Does not reveal a hidden overlay. */
  focus(): void
  isFocused(): boolean
}

interface OverlayEntry {
  container: BoxRenderable
  content: Renderable
  target: Renderable | undefined
  previous: Renderable | null
  options: OverlayOptions
  hidden: boolean
  removed: boolean
  lastBlurred: Renderable | null
  onDestroyed: () => void
}

function contains(parent: Renderable, child: Renderable | null | undefined): boolean {
  for (let node = child; node; node = node.parent instanceof Renderable ? node.parent : null) {
    if (node === parent) return true
  }
  return false
}

function dimension(value: OverlaySize, available: number): number {
  const cells = typeof value === "number" ? value : available * Number(value.slice(0, -1)) / 100
  if (
    !Number.isFinite(cells) || cells < 0 ||
    (typeof value === "string" && !/^\d+(?:\.\d+)?%$/u.test(value))
  ) throw new RangeError("Invalid overlay size")
  return Math.min(available, Math.floor(cells))
}

/** One manager per renderer. Overlays own their content; ordinary application focus is never trapped. */
export class OverlayManager {
  private entries: OverlayEntry[] = []
  private disposed = false
  private disposing = false
  private serial = 0

  private constructor(private readonly renderer: CliRenderer) {
    if (renderer.isDestroyed) throw new Error("Cannot create overlays on a destroyed renderer")
    renderer.on("resize", this.resize)
    renderer.on("focused_renderable", this.trackFocus)
    renderer.once("destroy", this.dispose)
  }

  static forRenderer(renderer: CliRenderer): OverlayManager {
    let manager = managers.get(renderer)
    if (!manager) {
      manager = new OverlayManager(renderer)
      managers.set(renderer, manager)
    }
    return manager
  }

  show(content: Renderable, options: OverlayOptions = {}): OverlayHandle {
    if (this.disposed || this.disposing || this.renderer.isDestroyed) throw new Error("Overlay manager is disposed")
    if (content.isDestroyed || content.parent || content.ctx !== this.renderer) {
      throw new Error("Overlay content must be an unattached live renderable belonging to this renderer")
    }
    const target = options.focus ?? (content.focusable ? content : undefined)
    if (target && (!contains(content, target) || target.isDestroyed || !target.focusable)) {
      throw new Error("Overlay focus target must be a live focusable descendant of its content")
    }
    for (const value of [options.margin ?? 0, options.offsetX ?? 0, options.offsetY ?? 0]) {
      if (!Number.isSafeInteger(value)) throw new RangeError("Overlay offsets and margin must be finite integers")
    }
    if ((options.margin ?? 0) < 0) throw new RangeError("Overlay margin cannot be negative")
    const anchors: OverlayAnchor[] = [
      "center", "top-left", "top-center", "top-right", "left-center", "right-center",
      "bottom-left", "bottom-center", "bottom-right",
    ]
    if (options.anchor !== undefined && !anchors.includes(options.anchor)) throw new Error("Invalid overlay anchor")
    dimension(options.width ?? 60, this.renderer.width)
    dimension(options.height ?? 10, this.renderer.height)
    // Evaluate user code before adopting ownership, so a throwing predicate leaves content untouched.
    const visible = options.visible?.(this.renderer.width, this.renderer.height) ?? true
    const container = new BoxRenderable(this.renderer, {
      id: `ax-tui-overlay-${++this.serial}`,
      position: "absolute",
      overflow: "hidden",
      flexShrink: 0,
      visible,
    })
    const entry: OverlayEntry = {
      container, content, target, previous: this.renderer.currentFocusedRenderable,
      options: { ...options }, hidden: false, removed: false, lastBlurred: null,
      onDestroyed: () => this.remove(entry),
    }
    container.add(content)
    this.renderer.root.add(container)
    this.entries.push(entry)
    content.once(RenderableEvents.DESTROYED, entry.onDestroyed)
    container.once(RenderableEvents.DESTROYED, entry.onDestroyed)
    if (target && target !== content) target.once(RenderableEvents.DESTROYED, entry.onDestroyed)
    try {
      this.layout(entry, visible)
      this.order()
      if (!options.nonCapturing && visible) this.focus(entry)
    } catch (error) {
      // No handle escapes when creation fails, so release all adopted content here.
      try {
        this.remove(entry)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Overlay creation failed")
      }
      throw error
    }
    return {
      close: () => this.remove(entry),
      setHidden: (hidden) => {
        if (entry.removed || hidden === entry.hidden) return
        entry.hidden = hidden
        this.layout(entry)
      },
      isHidden: () => entry.removed || !entry.container.visible,
      focus: () => this.focus(entry),
      isFocused: () => !entry.removed && contains(entry.container, this.renderer.currentFocusedRenderable),
    }
  }

  private eligible(target: Renderable | null | undefined): target is Renderable {
    if (!target || target.isDestroyed || !target.focusable) return false
    for (let node: Renderable | null = target; node; node = node.parent instanceof Renderable ? node.parent : null) {
      if (node.isDestroyed || !node.visible) return false
      if (node === this.renderer.root) return true
    }
    return false
  }

  private focus(entry: OverlayEntry): void {
    if (entry.removed || !entry.container.visible || !this.eligible(entry.target)) return
    const current = this.renderer.currentFocusedRenderable
    if (!contains(entry.container, current)) {
      // Raising a lower overlay must not create a cycle in the restoration chain.
      // Splice its old position out before recording the newly covered focus target.
      for (const candidate of this.entries) {
        if (candidate !== entry && contains(entry.container, candidate.previous)) candidate.previous = entry.previous
      }
      entry.previous = current
    }
    this.entries = this.entries.filter((candidate) => candidate !== entry)
    this.entries.push(entry)
    this.order()
    entry.target.focus()
  }

  private restore(entry: OverlayEntry): void {
    if (this.disposed || this.renderer.isDestroyed) return
    // Closing an unrelated overlay must not steal focus from application UI.
    const current = this.renderer.currentFocusedRenderable
    // Editors release focus before emitting destroyed. Remember that transition
    // without performing any reentrant focus work in the renderer event itself.
    const destroyedFocus = !current && entry.lastBlurred?.isDestroyed
    if (!contains(entry.container, current) && !destroyedFocus) return
    current?.blur()
    // Blur listeners may choose another application target or destroy the renderer.
    const redirected = this.renderer.currentFocusedRenderable
    if (this.renderer.isDestroyed || (redirected && !contains(entry.container, redirected))) return
    let previous = entry.previous
    const visited = new Set<Renderable>()
    while (previous && !this.eligible(previous) && !visited.has(previous)) {
      visited.add(previous)
      previous = this.entries.find((candidate) => contains(candidate.container, previous))?.previous ?? null
    }
    if (this.eligible(previous)) {
      previous.focus()
      return
    }
    for (const candidate of [...this.entries].reverse()) {
      if (candidate !== entry && !candidate.options.nonCapturing && this.eligible(candidate.target)) {
        candidate.target.focus()
        return
      }
    }
  }

  private layout(entry: OverlayEntry, visible?: boolean): void {
    const { width, height } = this.renderer
    const options = entry.options
    const show = !entry.hidden && (visible ?? options.visible?.(width, height) ?? true)
    if (entry.removed) return
    try {
      if (!show) this.restore(entry)
    } finally {
      // A failing focus callback must not leave a logically hidden overlay visible.
      if (!entry.removed) entry.container.visible = show
    }
    if (entry.removed) return
    const marginX = Math.min(options.margin ?? 0, Math.floor(width / 2))
    const marginY = Math.min(options.margin ?? 0, Math.floor(height / 2))
    const availableWidth = Math.max(0, width - marginX * 2)
    const availableHeight = Math.max(0, height - marginY * 2)
    const w = dimension(options.width ?? 60, availableWidth)
    const h = dimension(options.height ?? 10, availableHeight)
    const anchor = options.anchor ?? "center"
    const x = anchor.includes("left") ? 0 : anchor.includes("right") ? availableWidth - w : (availableWidth - w) / 2
    const y = anchor.includes("top") ? 0 : anchor.includes("bottom") ? availableHeight - h : (availableHeight - h) / 2
    entry.container.width = w
    entry.container.height = h
    entry.container.left = marginX + Math.max(0, Math.min(availableWidth - w, Math.floor(x) + (options.offsetX ?? 0)))
    entry.container.top = marginY + Math.max(0, Math.min(availableHeight - h, Math.floor(y) + (options.offsetY ?? 0)))
  }

  private order(): void {
    const own = new Set(this.entries.map((entry) => entry.container))
    const base = Math.max(0, ...this.renderer.root.getChildren().filter((child) => !own.has(child as BoxRenderable))
      .map((child) => child instanceof Renderable ? child.zIndex : 0))
    this.entries.forEach((entry, index) => { entry.container.zIndex = base + index + 1 })
  }

  private remove(entry: OverlayEntry): void {
    if (entry.removed) return
    entry.removed = true
    this.entries = this.entries.filter((candidate) => candidate !== entry)
    // Preserve restoration chains when a background overlay closes before the active one.
    for (const candidate of this.entries) {
      if (contains(entry.container, candidate.previous)) candidate.previous = entry.previous
    }
    try {
      this.restore(entry)
    } finally {
      entry.content.off(RenderableEvents.DESTROYED, entry.onDestroyed)
      entry.container.off(RenderableEvents.DESTROYED, entry.onDestroyed)
      entry.target?.off(RenderableEvents.DESTROYED, entry.onDestroyed)
      try {
        if (!entry.container.isDestroyed) entry.container.destroyRecursively()
      } finally {
        this.order()
      }
    }
  }

  private resize = (): void => {
    const errors: unknown[] = []
    for (const entry of [...this.entries]) {
      if (entry.removed) continue
      try {
        this.layout(entry)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, "Overlay resize failed")
  }

  private trackFocus = (current: Renderable | null, previous: Renderable | null): void => {
    for (const entry of this.entries) {
      entry.lastBlurred = !current && contains(entry.container, previous) ? previous : null
    }
  }

  /** Destroy all owned overlays and remove renderer listeners. Safe during renderer teardown. */
  dispose = (): void => {
    if (this.disposed || this.disposing) return
    this.disposing = true
    const errors: unknown[] = []
    // Restore the application target before suppressing focus changes during destruction.
    try {
      for (const entry of [...this.entries].reverse()) {
        try {
          this.remove(entry)
        } catch (error) {
          errors.push(error)
        }
      }
    } finally {
      this.disposed = true
      this.disposing = false
      this.renderer.off("resize", this.resize)
      this.renderer.off("focused_renderable", this.trackFocus)
      this.renderer.off("destroy", this.dispose)
      managers.delete(this.renderer)
    }
    if (errors.length) throw new AggregateError(errors, "Overlay disposal failed")
  }
}

const managers = new WeakMap<CliRenderer, OverlayManager>()

export function getOverlayManager(renderer: CliRenderer): OverlayManager {
  return OverlayManager.forRenderer(renderer)
}
