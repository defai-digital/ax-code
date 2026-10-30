import type { RenderContext, TerminalCapabilities } from "../core/types.js";
import type { RgbaImage } from "./image.js";
export type ImageProtocol = "auto" | "kitty" | "blocks";
export declare const KITTY_PLACEHOLDER = "\uDBFB\uDEEE";
export declare const MAX_KITTY_CELLS: number;
export declare function supportsKittyPlaceholders(capabilities: TerminalCapabilities | null, explicit?: boolean): boolean;
/** Explicit coordinates prevent incorrect inheritance after horizontal clipping or occlusion. */
export declare function kittyPlaceholder(id: number, row: number, column: number): string;
export declare function encodeKittyImage(image: RgbaImage, id: number, columns: number, rows: number): Uint8Array;
/** Per-renderer ownership of uploaded IDs and deferred targeted deletion. */
export declare class KittyImageSession {
    private readonly context;
    private ids;
    private retired;
    private disposed;
    private constructor();
    private invalidate;
    static forContext(context: RenderContext): KittyImageSession;
    allocate(): number | null;
    retire(id: number): void;
    private flushRetired;
    private dispose;
}
