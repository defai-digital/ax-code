import type { ActiveKeymapBinding } from "./keymap.js";
/** Display-only metadata; no handlers or renderable targets are retained. */
export type KeymapHelpBinding = Pick<ActiveKeymapBinding, "id" | "keys" | "description">;
export interface KeymapHelpEntry {
    id: string;
    shortcut: string;
    description: string;
}
/** Format AX chord names for display. This does not validate or register bindings. */
export declare function formatKeymapKeys(keys: string | readonly string[]): string;
/** Preserve snapshot order and duplicates, including shadowed eligible bindings. */
export declare function createKeymapHelpEntries(bindings: readonly KeymapHelpBinding[], query?: string): KeymapHelpEntry[];
