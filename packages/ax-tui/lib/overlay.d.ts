import { Renderable } from "../core/renderable.js";
import type { CliRenderer } from "../core/renderer.js";
export type OverlaySize = number | `${number}%`;
export type OverlayAnchor = "center" | "top-left" | "top-center" | "top-right" | "left-center" | "right-center" | "bottom-left" | "bottom-center" | "bottom-right";
export interface OverlayOptions {
    width?: OverlaySize;
    height?: OverlaySize;
    anchor?: OverlayAnchor;
    margin?: number;
    offsetX?: number;
    offsetY?: number;
    /** A focusable descendant of the supplied content. Defaults to the content when focusable. */
    focus?: Renderable;
    nonCapturing?: boolean;
    /** Evaluated when shown and on renderer resize. */
    visible?: (width: number, height: number) => boolean;
}
export interface OverlayHandle {
    /** Remove the overlay permanently and destroy its owned content. Idempotent. */
    close(): void;
    setHidden(hidden: boolean): void;
    isHidden(): boolean;
    /** Focus and raise a visible overlay. Does not reveal a hidden overlay. */
    focus(): void;
    isFocused(): boolean;
}
/** One manager per renderer. Overlays own their content; ordinary application focus is never trapped. */
export declare class OverlayManager {
    private readonly renderer;
    private entries;
    private disposed;
    private disposing;
    private serial;
    private constructor();
    static forRenderer(renderer: CliRenderer): OverlayManager;
    show(content: Renderable, options?: OverlayOptions): OverlayHandle;
    private eligible;
    private focus;
    private restore;
    private layout;
    private order;
    private remove;
    private resize;
    private trackFocus;
    /** Destroy all owned overlays and remove renderer listeners. Safe during renderer teardown. */
    dispose: () => void;
}
export declare function getOverlayManager(renderer: CliRenderer): OverlayManager;
