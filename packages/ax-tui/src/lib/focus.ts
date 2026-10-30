import { Renderable, RenderableEvents } from "../core/renderable.js"
import type { CliRenderer } from "../core/renderer.js"
import type { KeyEvent } from "./key-handler.js"
import { getKeymap } from "./keymap.js"

export interface FocusScopeOptions {
  /** Reorder these descendants before the remaining nodes in current tree order. */
  order?: readonly Renderable[]
  /** Contain Tab navigation in this scope. Programmatic focus is never redirected. */
  modal?: boolean
  enabled?: () => boolean
}

interface FocusScope {
  root: Renderable
  options: FocusScopeOptions
  serial: number
  remove: () => void
}

const managers = new WeakMap<CliRenderer, FocusManager>()

function contains(root: Renderable, node: Renderable | null): boolean {
  for (; node; node = node.parent instanceof Renderable ? node.parent : null) {
    if (node === root) return true
  }
  return false
}

/** Opt-in tree-order navigation. OverlayManager remains the sole owner of focus restoration. */
export class FocusManager {
  private scopes: FocusScope[] = []
  private disposed = false
  private moving = false
  private serial = 0

  private constructor(private readonly renderer: CliRenderer) {
    // Give existing scoped key bindings first refusal, independent of registration order.
    getKeymap(renderer)
    renderer.keyInput.on("keypress", this.dispatch)
    renderer.once("destroy", this.dispose)
  }

  static forRenderer(renderer: CliRenderer): FocusManager {
    if (renderer.isDestroyed) throw new Error("Cannot navigate focus on a destroyed renderer")
    let manager = managers.get(renderer)
    if (!manager) {
      manager = new FocusManager(renderer)
      managers.set(renderer, manager)
    }
    return manager
  }

  registerScope(root: Renderable, options: FocusScopeOptions = {}): () => void {
    if (this.disposed || root.isDestroyed || root.ctx !== this.renderer) {
      throw new Error("Focus scope must belong to this live renderer")
    }
    const order = [...(options.order ?? [])]
    if (new Set(order).size !== order.length || order.some((node) => !contains(root, node))) {
      throw new Error("Focus order must contain unique descendants of the scope")
    }
    const scope: FocusScope = { root, options: { ...options, order }, serial: ++this.serial, remove: () => {} }
    scope.remove = () => {
      this.scopes = this.scopes.filter((candidate) => candidate !== scope)
      root.off(RenderableEvents.DESTROYED, scope.remove)
    }
    this.scopes.push(scope)
    root.once(RenderableEvents.DESTROYED, scope.remove)
    return scope.remove
  }

  private attached(node: Renderable): boolean {
    for (let ancestor: Renderable | null = node; ancestor;
      ancestor = ancestor.parent instanceof Renderable ? ancestor.parent : null) {
      if (ancestor.isDestroyed || !ancestor.visible) return false
      if (ancestor === this.renderer.root) return true
    }
    return false
  }

  private candidates(scope: FocusScope): Renderable[] {
    const nodes: Renderable[] = []
    const visit = (node: Renderable) => {
      if (node.isDestroyed || !node.visible) return
      if (node.focusable) nodes.push(node)
      for (const child of node.getChildren()) visit(child)
    }
    visit(scope.root)
    const order = new Map(scope.options.order?.map((node, index) => [node, index]))
    return nodes.sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
  }

  focusNext(): boolean { return this.move(1) }
  focusPrevious(): boolean { return this.move(-1) }

  private move(direction: 1 | -1): boolean {
    if (this.disposed || this.moving || this.renderer.isDestroyed) return false
    this.moving = true
    try {
      const initialFocus = this.renderer.currentFocusedRenderable
      const active = [...this.scopes].filter((scope) => {
        let enabled = true
        try {
          enabled = scope.options.enabled?.() !== false
        } catch {
          // A broken predicate disables only its own scope; Tab must still work.
          enabled = false
        }
        return enabled && !this.disposed && this.scopes.includes(scope) && this.attached(scope.root)
      })
      if (this.disposed || this.renderer.currentFocusedRenderable !== initialFocus) return false
      const current = this.renderer.currentFocusedRenderable
      const depth = (scope: FocusScope) => {
        let count = 0
        for (let node = scope.root.parent; node; node = node.parent) count++
        return count
      }
      const modal = active.filter((scope) => scope.options.modal)
        .sort((a, b) => depth(b) - depth(a) || b.serial - a.serial)[0]
      const scopes = modal ? [modal] : active.filter((scope) => !current || contains(scope.root, current))
        .sort((a, b) => depth(b) - depth(a) || b.serial - a.serial)
      for (const scope of scopes) {
        if (!this.scopes.includes(scope) || !this.attached(scope.root)) continue
        const nodes = this.candidates(scope)
        if (!nodes.length) {
          // A modal scope with no focusable descendants still owns Tab.
          // Letting the event through could move focus outside the modal.
          if (scope.options.modal) return true
          continue
        }
        const index = current ? nodes.indexOf(current) : -1
        let next = index < 0 ? (direction === 1 ? 0 : nodes.length - 1) : index + direction
        const wraps = scope.options.modal || scope.root === this.renderer.root
        if (next < 0 || next >= nodes.length) {
          if (!wraps) continue
          next = (next + nodes.length) % nodes.length
        }
        const target = nodes[next]!
        if (target === current) return !!scope.options.modal
        if (!this.scopes.includes(scope) || !this.attached(target) || !target.focusable) continue
        target.focus()
        // User focus listeners may redirect or destroy the candidate. Do not undo that decision.
        return this.renderer.currentFocusedRenderable !== current
      }
      return false
    } finally {
      this.moving = false
    }
  }

  private dispatch = (event: KeyEvent): void => {
    if (event.defaultPrevented || event.propagationStopped || event.eventType === "release" ||
      event.name !== "tab" || event.ctrl || event.meta || event.super || event.hyper) return
    if (event.shift ? this.focusPrevious() : this.focusNext()) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    for (const scope of [...this.scopes]) scope.remove()
    this.renderer.keyInput.off("keypress", this.dispatch)
    this.renderer.off("destroy", this.dispose)
    managers.delete(this.renderer)
  }
}

export function getFocusManager(renderer: CliRenderer): FocusManager {
  return FocusManager.forRenderer(renderer)
}
