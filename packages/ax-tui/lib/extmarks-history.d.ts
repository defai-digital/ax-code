import type { Extmark } from "./extmarks.js";
export interface ExtmarksSnapshot {
    extmarks: Map<number, Extmark>;
    nextId: number;
    metadata: Map<number, any>;
}
export declare class ExtmarksHistory {
    private undoStack;
    private redoStack;
    saveSnapshot(extmarks: Map<number, Extmark>, nextId: number, metadata: Map<number, any>): void;
    /** Drop the snapshot just recorded for an edit that turned out to be a no-op. */
    discardLastSnapshot(): void;
    undo(): ExtmarksSnapshot | null;
    redo(): ExtmarksSnapshot | null;
    pushRedo(snapshot: ExtmarksSnapshot): void;
    pushUndo(snapshot: ExtmarksSnapshot): void;
    clear(): void;
    canUndo(): boolean;
    canRedo(): boolean;
}
