export interface RgbaImage {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
}
export declare const MAX_IMAGE_PIXELS = 4194304;
export declare const MAX_PNG_BYTES: number;
export declare function validateImageDimensions(width: number, height: number): void;
/** Copy caller-owned pixels so later mutation cannot change a cached image or its upload. */
export declare function copyRgbaImage(image: RgbaImage): RgbaImage;
/** Bounded, noninterlaced 8-bit PNG decoder. Unsupported sample depths fail explicitly. */
export declare function decodePng(bytes: Uint8Array): RgbaImage;
