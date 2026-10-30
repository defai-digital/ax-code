import { Renderable } from "../core/renderable.js"
import type { RenderContext } from "../core/types.js"
import { VirtualListModel, type VirtualListAnchor, type VirtualListKey } from "../lib/virtual-list.js"
import { BoxRenderable } from "./Box.js"
import { ScrollBoxRenderable, type ScrollBoxOptions } from "./ScrollBox.js"

export interface VirtualListOptions<T>
  extends Omit<ScrollBoxOptions, "contentOptions" | "scrollX" | "stickyScroll" | "stickyStart"> {
  items: readonly T[]
  getKey: (item: T) => VirtualListKey
  /** Return an unattached renderable. The list owns and destroys each mounted row. */
  renderItem: (item: T, index: number, context: RenderContext) => Renderable
  estimateHeight?: number
  /** Extra terminal rows above and below the viewport, not an item count. */
  overscan?: number
}

interface MountedRow<T> {
  item: T
  index: number
  box: BoxRenderable
  measured: boolean
}

function contains(root: Renderable, target: Renderable | null): boolean {
  for (let node = target; node; node = node.parent instanceof Renderable ? node.parent : null) {
    if (node === root) return true
  }
  return false
}

/** Variable-height, vertical list with bounded mounted rows and stable-key scroll anchoring. */
export class VirtualListRenderable<T> extends ScrollBoxRenderable {
  private readonly model: VirtualListModel<T>
  private readonly renderItem: VirtualListOptions<T>["renderItem"]
  private readonly overscan: number
  private readonly rows = new Map<VirtualListKey, MountedRow<T>>()
  private lastWidth = -1
  private lastTotal = -1
  private scheduled = false
  private refreshing = false
  private anchor?: VirtualListAnchor
  private seek?: { key: VirtualListKey; align: "start" | "center" | "end"; offset?: number }

  constructor(context: RenderContext, options: VirtualListOptions<T>) {
    const { items, getKey, renderItem, estimateHeight, overscan = 3, ...scrollOptions } = options
    const model = new VirtualListModel(getKey, estimateHeight)
    model.setItems(items)
    if (!Number.isSafeInteger(overscan) || overscan < 0 || overscan > 10_000) {
      throw new RangeError("Virtual list overscan must be an integer from 0 to 10000")
    }
    super(context, { ...scrollOptions, scrollX: false, contentOptions: { height: model.totalHeight, minHeight: 0 } })
    this.model = model
    this.renderItem = renderItem
    this.overscan = overscan
    this.viewport.on("resize", this.schedule)
    this._ctx.on("focused_renderable", this.schedule)
    this.schedule()
  }

  get items(): readonly T[] {
    return this.model.items
  }

  set items(items: readonly T[]) {
    this.setItems(items)
  }

  get mountedCount(): number {
    return this.rows.size
  }

  get totalHeight(): number {
    return this.model.totalHeight
  }

  setItems(items: readonly T[]): void {
    if (this.isDestroyed) return
    const anchor = this.anchor ?? this.model.anchor(this.scrollTop)
    this.model.setItems(items)
    this.anchor = anchor
    this.schedule()
  }

  /** Uses estimates until the target is measured; alignment settles with native layout. */
  scrollToIndex(index: number, align: "start" | "center" | "end" = "start"): void {
    if (this.isDestroyed) return
    if (!Number.isInteger(index) || index < 0 || index >= this.model.count) throw new RangeError("Invalid virtual row index")
    if (!["start", "center", "end"].includes(align)) throw new TypeError("Invalid virtual row alignment")
    this.seek = { key: this.model.keyAt(index)!, align }
    this.anchor = undefined
    this.refresh()
    this.schedule()
  }

  private schedule = (): void => {
    if (this.scheduled || this.isDestroyed) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (this.isDestroyed) return
      if (this.refresh()) this.requestRender()
    })
  }

  protected onUpdate(deltaTime: number): void {
    super.onUpdate(deltaTime)
    // Yoga already calculated this frame. Mount only after the traversal ends;
    // newly attached percentage-sized children otherwise have undefined geometry.
    this.schedule()
  }

  private drop(key: VirtualListKey, row: MountedRow<T>): void {
    this.rows.delete(key)
    if (contains(row.box, this._ctx.currentFocusedRenderable)) this.focus()
    row.box.destroyRecursively()
  }

  private refresh(): boolean {
    if (this.refreshing || this.isDestroyed || !this.model) return false
    this.refreshing = true
    let dirty = false
    try {
      // User scroll input takes precedence over an estimate-based jump still settling.
      if (this.seek?.offset !== undefined && this.scrollTop !== this.seek.offset) this.seek = undefined
      const width = this.viewport.width
      const viewport = this.viewport.height
      const anchor = this.anchor ?? this.model.anchor(this.scrollTop)
      let changed = !!this.anchor
      this.anchor = undefined
      if (width !== this.lastWidth) {
        this.lastWidth = width
        this.model.resetMeasurements()
        for (const row of this.rows.values()) row.measured = false
        changed = true
      } else {
        for (const [key, row] of this.rows) {
          const index = this.model.indexOf(key)
          if (row.measured && index >= 0 && Object.is(this.model.items[index], row.item)) {
            changed = this.model.measure(index, Math.max(1, Math.ceil(row.box.height))) || changed
          }
        }
      }
      if (this.lastTotal !== this.model.totalHeight) {
        this.lastTotal = this.model.totalHeight
        this.content.height = this.model.totalHeight
        dirty = true
      }
      this.verticalScrollBar.scrollSize = this.model.totalHeight
      this.verticalScrollBar.viewportSize = viewport
      let offset = changed ? this.model.resolveAnchor(anchor) : this.scrollTop
      if (this.seek) {
        const index = this.model.indexOf(this.seek.key)
        if (index >= 0) {
          const extra = viewport - this.model.heightAt(index)
          offset = this.model.offsetAt(index) - (this.seek.align === "center" ? Math.floor(extra / 2) :
            this.seek.align === "end" ? extra : 0)
          if (this.rows.get(this.seek.key)?.measured && !changed) this.seek = undefined
        } else this.seek = undefined
      }
      const nextTop = Math.max(0, Math.min(offset, Math.max(0, this.model.totalHeight - viewport)))
      if (this.scrollTop !== nextTop) {
        this.scrollTop = nextTop
        dirty = true
      }
      if (this.seek) this.seek.offset = this.scrollTop
      const range = this.model.range(this.scrollTop, viewport, this.overscan)
      for (const [key, row] of this.rows) {
        const index = this.model.indexOf(key)
        const obsolete = index < 0 || index !== row.index || !Object.is(row.item, this.model.items[index])
        const outside = index < range.start || index >= range.end
        // Keep at most one extra focused row mounted while it remains in the data.
        if (obsolete || (outside && !contains(row.box, this._ctx.currentFocusedRenderable))) {
          this.drop(key, row)
          dirty = true
        }
      }
      for (let index = range.start; index < range.end; index++) {
        const key = this.model.keyAt(index)!
        if (this.rows.has(key)) continue
        const item = this.model.items[index]
        const content = this.renderItem(item, index, this._ctx)
        if (content.isDestroyed || content.parent || content.ctx !== this._ctx) {
          throw new Error("Virtual rows must be unattached live renderables belonging to this renderer")
        }
        const box = new BoxRenderable(this._ctx, {
          id: `${this.id}-virtual-${index}`, position: "absolute", left: 0, top: this.model.offsetAt(index),
          width, flexDirection: "column", flexShrink: 0,
        })
        const row: MountedRow<T> = { item, index, box, measured: false }
        box.add(content)
        box.on("resize", () => {
          row.measured = true
          this.schedule()
        })
        this.content.add(box)
        this.rows.set(key, row)
        dirty = true
        // Even a one-row item may retain the initial 1x1 dimensions and emit no resize.
        box.renderAfter = () => {
          if (!row.measured) {
            row.measured = true
            this.schedule()
          }
        }
      }
      for (const [key, row] of this.rows) {
        const top = this.model.offsetAt(this.model.indexOf(key))
        if (row.box.top !== top) {
          row.box.top = top
          dirty = true
        }
        if (row.box.width !== width) {
          row.box.width = width
          dirty = true
        }
      }
    } finally {
      this.refreshing = false
    }
    return dirty
  }

  protected destroySelf(): void {
    this.viewport.off("resize", this.schedule)
    this._ctx.off("focused_renderable", this.schedule)
    for (const [key, row] of this.rows) this.drop(key, row)
    super.destroySelf()
  }
}
