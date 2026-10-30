import { Renderable } from "../core/renderable.js";
import type { CliRenderer } from "../core/renderer.js";
export interface FocusScopeOptions {
    /** Reorder these descendants before the remaining nodes in current tree order. */
    order?: readonly Renderable[];
    /** Contain Tab navigation in this scope. Programmatic focus is never redirected. */
    modal?: boolean;
    enabled?: () => boolean;
}
/** Opt-in tree-order navigation. OverlayManager remains the sole owner of focus restoration. */
export declare class FocusManager {
    private readonly renderer;
    private scopes;
    private disposed;
    private moving;
    private serial;
    private constructor();
    static forRenderer(renderer: CliRenderer): FocusManager;
    registerScope(root: Renderable, options?: FocusScopeOptions): () => void;
    private attached;
    private candidates;
    focusNext(): boolean;
    focusPrevious(): boolean;
    private move;
    private dispatch;
    dispose: () => void;
}
export declare function getFocusManager(renderer: CliRenderer): FocusManager;
