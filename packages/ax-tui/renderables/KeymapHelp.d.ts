import type { RenderContext } from "../core/types.js";
import { type KeymapHelpBinding } from "../lib/keymap-help.js";
import { TextRenderable, type TextOptions } from "./Text.js";
export interface KeymapHelpOptions extends Omit<TextOptions, "content"> {
    /** Eligible bindings, normally obtained from getActiveBindings(). Updated explicitly by the caller. */
    bindings?: readonly KeymapHelpBinding[];
    query?: string;
    emptyText?: string;
}
/** Searchable, display-only help. Owns no keymap, input handlers, focus, or refresh timers. */
export declare class KeymapHelpRenderable extends TextRenderable {
    private _bindings;
    private _query;
    private _emptyText;
    private _matchCount;
    constructor(context: RenderContext, options?: KeymapHelpOptions);
    get bindings(): readonly KeymapHelpBinding[];
    set bindings(value: readonly KeymapHelpBinding[] | undefined);
    get query(): string;
    set query(value: string | undefined);
    get emptyText(): string;
    set emptyText(value: string | undefined);
    get matchCount(): number;
    private updateHelp;
}
