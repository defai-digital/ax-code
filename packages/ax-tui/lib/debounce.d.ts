type ScopeId = string | number;
/** Debounces asynchronous work within a named scope. Cancelled calls reject with AbortError. */
export declare class DebounceController {
    private scopeId;
    constructor(scopeId: ScopeId);
    /** Replacing a pending call cancels its promise; each promise always settles. */
    debounce<R>(id: ScopeId, ms: number, fn: () => Promise<R>): Promise<R>;
    clearDebounce(id: ScopeId): void;
    clear(): void;
}
export declare function createDebounce(scopeId: ScopeId): DebounceController;
export declare function clearDebounceScope(scopeId: ScopeId): void;
export declare function clearAllDebounces(): void;
export {};
