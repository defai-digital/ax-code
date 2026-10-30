import { PasteEvent, Selection, Timeline, type CliRenderer, type KeyEvent, type TimelineOptions } from "@defai-digital/ax-tui";
import { type OverlayHandle, type OverlayOptions, type Renderable } from "@defai-digital/ax-tui";
import { type KeymapLayer } from "@defai-digital/ax-tui";
export declare const RendererContext: import("solid-js").Context<CliRenderer | undefined>;
export declare const useRenderer: () => CliRenderer;
/** Share renderer routing while disposing only this Solid owner's registrations. */
export declare const useKeymap: () => {
    register(layer: KeymapLayer): () => void;
    getActiveBindings: () => import("@defai-digital/ax-tui").ActiveKeymapBinding[];
    readonly pendingKeys: readonly string[];
    cancelSequence: () => void;
};
/** Show owned overlays and close only this Solid owner's handles on cleanup. */
export declare const useOverlay: () => {
    show: (content: Renderable, options?: OverlayOptions) => OverlayHandle;
};
export declare const onResize: (callback: (width: number, height: number) => void) => void;
export declare const useTerminalDimensions: () => import("solid-js").Accessor<{
    width: number;
    height: number;
}>;
export interface UseKeyboardOptions {
    /** Include release events - callback receives events with eventType: "release" */
    release?: boolean;
}
/**
 * Subscribe to keyboard events.
 *
 * By default, only receives press events (including key repeats with `repeated: true`).
 * Use `options.release` to also receive release events.
 *
 * @example
 * // Basic press handling (includes repeats)
 * useKeyboard((e) => console.log(e.name, e.repeated ? "(repeat)" : ""))
 *
 * // With release events
 * useKeyboard((e) => {
 *   if (e.eventType === "release") keys.delete(e.name)
 *   else keys.add(e.name)
 * }, { release: true })
 */
export declare const useKeyboard: (callback: (key: KeyEvent) => void, options?: UseKeyboardOptions) => void;
export declare const usePaste: (callback: (event: PasteEvent) => void) => void;
/**
 * @deprecated renamed to useKeyboard
 */
export declare const useKeyHandler: typeof useKeyboard;
export declare const onFocus: (callback: () => void) => void;
export declare const onBlur: (callback: () => void) => void;
export declare const useSelectionHandler: (callback: (selection: Selection) => void) => void;
export declare const useTimeline: (options?: TimelineOptions) => Timeline;
