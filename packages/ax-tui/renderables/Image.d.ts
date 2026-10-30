import { Renderable, type RenderableOptions } from "../core/renderable.js";
import type { OptimizedBuffer } from "../core/buffer.js";
import type { RenderContext } from "../core/types.js";
import { type RgbaImage } from "../lib/image.js";
import { type ImageProtocol } from "../lib/kitty-image.js";
import { RGBA, type ColorInput } from "../lib/rgba.js";
export type ImageSource = RgbaImage | Uint8Array | ((signal: AbortSignal) => Promise<RgbaImage | Uint8Array>);
export type ImageFit = "contain" | "cover" | "fill";
export interface ImageOptions extends RenderableOptions<ImageRenderable> {
    source?: ImageSource;
    alt?: string;
    fit?: ImageFit;
    protocol?: ImageProtocol;
    /** Terminal cell height divided by width; defaults to 2. */
    cellAspectRatio?: number;
    backgroundColor?: ColorInput;
    onLoad?: () => void;
    onError?: (error: unknown) => void;
}
export declare class ImageRenderable extends Renderable {
    private _source?;
    private pixels;
    private controller?;
    private loadGeneration;
    private placement;
    private _alt;
    private _fit;
    private _protocol;
    private _cellAspectRatio;
    private _backgroundColor;
    private readonly kittySession;
    onLoad?: () => void;
    onError?: (error: unknown) => void;
    loadPromise: Promise<void>;
    loadError: unknown;
    constructor(context: RenderContext, options?: ImageOptions);
    private cleanAlt;
    get source(): ImageSource | undefined;
    set source(source: ImageSource | undefined);
    get alt(): string;
    set alt(value: string);
    get fit(): ImageFit;
    set fit(value: ImageFit);
    get protocol(): ImageProtocol;
    set protocol(value: ImageProtocol);
    get cellAspectRatio(): number;
    set cellAspectRatio(value: number);
    get backgroundColor(): RGBA;
    set backgroundColor(value: ColorInput);
    get effectiveProtocol(): "kitty" | "blocks";
    private retirePlacement;
    protected renderSelf(buffer: OptimizedBuffer): void;
    protected destroySelf(): void;
}
