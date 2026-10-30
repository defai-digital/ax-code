import type { CliRenderer } from "../core/renderer.js";
import { InputRenderable } from "../renderables/Input.js";
import { type CommandRegistry, type CommandResult } from "./commands.js";
import { type OverlayOptions } from "./overlay.js";
export interface CommandPaletteOptions {
    registry?: CommandRegistry;
    query?: string;
    placeholder?: string;
    emptyText?: string;
    overlay?: Omit<OverlayOptions, "focus" | "nonCapturing">;
}
export interface CommandPaletteHandle {
    readonly input: InputRenderable;
    readonly selectedId: string | null;
    /** Resolves after command completion, or null when closed without executing. Never rejects. */
    readonly result: Promise<CommandResult | null>;
    setQuery(query: string): void;
    refresh(): void;
    executeSelected(): Promise<CommandResult | null>;
    close(): void;
}
/** A renderer-owned overlay using the same command registry as application shortcuts. */
export declare function showCommandPalette(renderer: CliRenderer, options?: CommandPaletteOptions): CommandPaletteHandle;
