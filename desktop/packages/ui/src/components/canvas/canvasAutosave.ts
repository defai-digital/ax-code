export type CanvasSaveQueueStatus = "saving" | "saved" | "error"

export type CanvasSaveQueueEntry<TDocument> = {
  scope: number
  directory: string
  document: TDocument
  notify?: boolean
}

export type CanvasSaveQueueOptions<TDocument> = {
  save: (directory: string, document: TDocument) => Promise<void>
  isCurrentScope: (scope: number) => boolean
  isLatestDocument: (document: TDocument) => boolean
  onLatestSaved: (scope: number, document: TDocument) => void
  onStatus: (scope: number, status: CanvasSaveQueueStatus, error?: unknown) => void
}

export class CanvasSaveQueue<TDocument> {
  private readonly queuedByScope = new Map<number, CanvasSaveQueueEntry<TDocument>>()
  private readonly activeByScope = new Map<number, Promise<void>>()

  constructor(private readonly options: CanvasSaveQueueOptions<TDocument>) {}

  enqueue(entry: CanvasSaveQueueEntry<TDocument>): Promise<void> {
    this.queuedByScope.set(entry.scope, entry)

    const active = this.activeByScope.get(entry.scope)
    if (active) {
      return active
    }

    const drainPromise = this.drain(entry.scope).finally(() => {
      this.activeByScope.delete(entry.scope)
    })
    this.activeByScope.set(entry.scope, drainPromise)
    return drainPromise
  }

  hasPending(scope: number): boolean {
    return this.activeByScope.has(scope) || this.queuedByScope.has(scope)
  }

  private async drain(scope: number): Promise<void> {
    while (true) {
      const entry = this.queuedByScope.get(scope)
      if (!entry) {
        return
      }

      this.queuedByScope.delete(scope)
      if (entry.notify !== false) {
        this.options.onStatus(scope, "saving")
      }

      try {
        await this.options.save(entry.directory, entry.document)
        if (
          entry.notify !== false &&
          !this.queuedByScope.has(scope) &&
          this.options.isCurrentScope(scope) &&
          this.options.isLatestDocument(entry.document)
        ) {
          this.options.onLatestSaved(scope, entry.document)
          this.options.onStatus(scope, "saved")
        }
      } catch (error) {
        if (
          entry.notify !== false &&
          !this.queuedByScope.has(scope) &&
          this.options.isCurrentScope(scope) &&
          this.options.isLatestDocument(entry.document)
        ) {
          this.options.onStatus(scope, "error", error)
        }
      }
    }
  }
}
