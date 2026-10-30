import { Renderable } from "../core/renderable.js";
import type { CliRenderer } from "../core/renderer.js";
import type { KeyEvent } from "./key-handler.js";
export interface KeymapBinding {
    id: string;
    /** A chord such as ctrl+k, or a sequence such as ["ctrl+k", "ctrl+c"]. */
    keys: string | readonly string[];
    description?: string;
    handler: (event: KeyEvent) => void;
}
export interface KeymapLayer {
    bindings: readonly KeymapBinding[];
    /** Omit for global bindings. Targets must belong to this renderer. */
    target?: Renderable;
    scope?: "focus" | "focus-within";
    priority?: number;
    enabled?: () => boolean;
}
export interface ActiveKeymapBinding {
    id: string;
    keys: readonly string[];
    description?: string;
    priority: number;
    target?: Renderable;
}
/** Renderer-owned, opt-in keyboard routing. Registrations own no renderables. */
export declare class Keymap {
    private readonly renderer;
    readonly sequenceTimeoutMs: number;
    private layers;
    private serial;
    private disposed;
    private pending?;
    private timer?;
    private constructor();
    static forRenderer(renderer: CliRenderer, options?: {
        sequenceTimeoutMs?: number;
    }): Keymap;
    register(options: KeymapLayer): () => void;
    private distance;
    private activeLayers;
    /** Eligible bindings, in dispatch order. Includes bindings shadowed by earlier layers. */
    getActiveBindings(): ActiveKeymapBinding[];
    get pendingKeys(): readonly string[];
    cancelSequence: () => void;
    private invoke;
    private accept;
    private dispatch;
    dispose: () => void;
}
export declare function getKeymap(renderer: CliRenderer, options?: {
    sequenceTimeoutMs?: number;
}): Keymap;
