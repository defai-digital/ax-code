import { Renderable } from "../core/renderable.js";
import type { RenderContext } from "../core/types.js";
import { type VirtualListKey } from "../lib/virtual-list.js";
import { ScrollBoxRenderable, type ScrollBoxOptions } from "./ScrollBox.js";
export interface VirtualListOptions<T> extends Omit<ScrollBoxOptions, "contentOptions" | "scrollX" | "stickyScroll" | "stickyStart"> {
    items: readonly T[];
    getKey: (item: T) => VirtualListKey;
    /** Return an unattached renderable. The list owns and destroys each mounted row. */
    renderItem: (item: T, index: number, context: RenderContext) => Renderable;
    estimateHeight?: number;
    /** Extra terminal rows above and below the viewport, not an item count. */
    overscan?: number;
}
/** Variable-height, vertical list with bounded mounted rows and stable-key scroll anchoring. */
export declare class VirtualListRenderable<T> extends ScrollBoxRenderable {
    private readonly model;
    private readonly renderItem;
    private readonly overscan;
    private readonly rows;
    private lastWidth;
    private lastTotal;
    private scheduled;
    private refreshing;
    private anchor?;
    private seek?;
    constructor(context: RenderContext, options: VirtualListOptions<T>);
    get items(): readonly T[];
    set items(items: readonly T[]);
    get mountedCount(): number;
    get totalHeight(): number;
    setItems(items: readonly T[]): void;
    /** Uses estimates until the target is measured; alignment settles with native layout. */
    scrollToIndex(index: number, align?: "start" | "center" | "end"): void;
    private schedule;
    protected onUpdate(deltaTime: number): void;
    private drop;
    private refresh;
    protected destroySelf(): void;
}
