export declare const SDK_VERSION = "0.1.0";
export declare const CHROME_CLEAR_SEQUENCE = "\u001B]771;{\"clear\":true}\u0007";
export type Status = Readonly<{
    text: string;
    tone: "info" | "warn" | "error";
    expires?: number;
}>;
export type Mark = "idle" | "busy" | "error" | 0 | 1 | 2 | 3;
export type Progress = number | "indeterminate";
export type Sprite = Readonly<{
    w: number;
    h: number;
    frames: readonly string[];
}>;
export type Chrome = Readonly<{
    status?: Status;
    mark?: Mark;
    progress?: Progress;
    sprite?: Sprite;
}>;
export type ChromePatch = Readonly<{
    status?: Status | null;
    mark?: Mark | null;
    progress?: Progress | null;
    sprite?: Sprite | null;
}>;
export type Capabilities = Readonly<{
    title: boolean;
    chrome: boolean;
}>;
export type Environment = Readonly<Record<string, string | undefined>>;
export type Scheduler = (tick: () => void, intervalMs: number) => () => void;
export type ClientOptions = Readonly<{
    /** True means accepted. Adapt Node stream.write's backpressure boolean at the host. */
    write: (sequence: string) => boolean;
    capabilities: Capabilities;
    reduceMotion?: boolean;
    schedule?: Scheduler;
    /** Animation write errors stop playback, then call this handler (or rethrow). */
    onError?: (error: unknown) => void;
}>;
/** Conservative host identity check, not a graphics probe or acknowledgement. */
export declare function detectCapabilities(env: Environment, isTTY: boolean): Capabilities;
/** Copy bounded RGBA8 frames into an immutable inline sprite; no native or image decoder dependency. */
export declare function createSprite(w: number, h: number, frames: readonly Uint8Array[]): Sprite;
/** OSC 2 followed by OSC 1 preserves explicit tab titles on Apple Terminal. */
export declare function titleSequence(title: string): string;
/** Encode a full replacement document. Use the client for field-preserving updates. */
export declare function chromeSequence(document: Chrome): string;
export interface TerminalClient {
    readonly chrome: Chrome;
    setTitle(title: string): boolean;
    updateChrome(patch: ChromePatch): boolean;
    setStatus(status: Status | null): boolean;
    setProgress(progress: Progress | null): boolean;
    setMark(mark: Mark | null): boolean;
    setSprite(sprite: Sprite | null): boolean;
    playSprite(input: Readonly<{
        sprite: Sprite;
        intervalMs: number;
    }>): boolean;
    stopSprite(): void;
    clearChrome(): boolean;
    dispose(): void;
}
/** The host owns the output queue and capabilities. No PTY, native library or process-global writer is created. */
export declare function createTerminalClient(options: ClientOptions): TerminalClient;
