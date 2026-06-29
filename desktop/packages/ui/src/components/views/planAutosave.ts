export type PlanSaveQueueEntry = {
  path: string
  content: string
}

export type PlanSaveQueueOptions = {
  save: (path: string, content: string) => Promise<void>
  isLatestEntry: (entry: PlanSaveQueueEntry) => boolean
  onLatestSaved?: (entry: PlanSaveQueueEntry) => void
  onLatestError: (entry: PlanSaveQueueEntry, error: unknown) => void
}

export class PlanSaveQueue {
  private readonly queuedByPath = new Map<string, PlanSaveQueueEntry>()
  private readonly activeByPath = new Map<string, Promise<void>>()

  constructor(private readonly options: PlanSaveQueueOptions) {}

  enqueue(entry: PlanSaveQueueEntry): Promise<void> {
    this.queuedByPath.set(entry.path, entry)

    const active = this.activeByPath.get(entry.path)
    if (active) {
      return active
    }

    const drainPromise = this.drain(entry.path).finally(() => {
      this.activeByPath.delete(entry.path)
    })
    this.activeByPath.set(entry.path, drainPromise)
    return drainPromise
  }

  hasPending(path: string): boolean {
    return this.activeByPath.has(path) || this.queuedByPath.has(path)
  }

  private async drain(path: string): Promise<void> {
    while (true) {
      const entry = this.queuedByPath.get(path)
      if (!entry) {
        return
      }

      this.queuedByPath.delete(path)

      try {
        await this.options.save(entry.path, entry.content)
        if (!this.queuedByPath.has(path) && this.options.isLatestEntry(entry)) {
          this.options.onLatestSaved?.(entry)
        }
      } catch (error) {
        if (!this.queuedByPath.has(path) && this.options.isLatestEntry(entry)) {
          this.options.onLatestError(entry, error)
        }
      }
    }
  }
}
