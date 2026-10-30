import type { Extmark } from "./extmarks.js"

export interface ExtmarksSnapshot {
  extmarks: Map<number, Extmark>
  nextId: number
  metadata: Map<number, any>
}

export class ExtmarksHistory {
  private undoStack: ExtmarksSnapshot[] = []
  private redoStack: ExtmarksSnapshot[] = []

  saveSnapshot(extmarks: Map<number, Extmark>, nextId: number, metadata: Map<number, any>): void {
    const snapshot: ExtmarksSnapshot = {
      extmarks: new Map(Array.from(extmarks.entries()).map(([id, extmark]) => [id, { ...extmark }])),
      nextId,
      metadata: new Map(metadata),
    }
    this.undoStack.push(snapshot)
    this.redoStack = []
  }

  /** Drop the snapshot just recorded for an edit that turned out to be a no-op. */
  discardLastSnapshot(): void {
    this.undoStack.pop()
  }

  undo(): ExtmarksSnapshot | null {
    if (this.undoStack.length === 0) return null
    return this.undoStack.pop()!
  }

  redo(): ExtmarksSnapshot | null {
    if (this.redoStack.length === 0) return null
    return this.redoStack.pop()!
  }

  pushRedo(snapshot: ExtmarksSnapshot): void {
    this.redoStack.push(snapshot)
  }

  pushUndo(snapshot: ExtmarksSnapshot): void {
    this.undoStack.push(snapshot)
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }
}
