import path from "path"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { FileWatcher } from "../file/watcher"
import { Instance } from "../project/instance"
import { LANGUAGE_EXTENSIONS } from "../lsp/language"
import { CodeGraphBuilder } from "./builder"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "code-intelligence.watcher" })

// Debounce window for incremental reindex. Rapid saves (IDE auto-save,
// multi-file edits, git operations) coalesce into a single reindex per
// file. 1s is short enough to feel responsive but long enough to swallow
// typical IDE save bursts.
const DEBOUNCE_MS = 1_000

// Cap on concurrent reindex jobs per project. Each job calls LSP which
// has its own concurrency controls, but we don't want to fan out so
// widely that the indexer saturates the LSP server on large refactor
// operations.
const MAX_CONCURRENT_REINDEX = 4

// Backpressure cap for the per-project reindex queue. The per-file
// debounce in `pending` already ensures at most one queued job per
// distinct file, but a `git checkout` switching branches across a
// large monorepo can fire events on hundreds of files at once, and
// each closure captures the project id + file path. Without a cap the
// queue grows proportional to the change set. When the cap is reached
// we drop the oldest queued job so the most recent file changes still
// get indexed promptly; the dropped file will be picked up on its next
// modification or by a full reindex.
const MAX_QUEUE_DEPTH = 256

export namespace CodeGraphWatcher {
  type Pending = {
    timer: ReturnType<typeof setTimeout>
    event: "add" | "change" | "unlink"
  }

  type State = {
    projectID: ProjectID
    pending: Map<string, Pending>
    activeReindex: number
    queue: Array<() => Promise<void>>
    unsubscribe?: () => void
    disposed: boolean
  }

  // Single active watcher per JavaScript process. ax-code's Instance
  // machinery already scopes state per working directory, and we tie
  // the watcher to whichever Instance is currently active. When the
  // user switches directories (rare in practice), start() is called
  // again for the new instance.
  const instances = new Map<ProjectID, State>()

  function shouldIndex(file: string): boolean {
    const ext = path.extname(file)
    return LANGUAGE_EXTENSIONS[ext] !== undefined && LANGUAGE_EXTENSIONS[ext] !== "plaintext"
  }

  async function runNext(state: State): Promise<void> {
    if (state.disposed) return
    while (state.activeReindex < MAX_CONCURRENT_REINDEX && state.queue.length > 0) {
      const job = state.queue.shift()
      if (!job) break
      state.activeReindex++
      job()
        .catch((err) => {
          log.error("reindex job failed", { err })
        })
        .finally(() => {
          state.activeReindex--
          runNext(state)
        })
    }
  }

  function enqueueReindex(state: State, file: string, event: "add" | "change" | "unlink") {
    if (state.disposed) return
    if (state.queue.length >= MAX_QUEUE_DEPTH) {
      // Drop oldest queued job so we keep up with the most recent file
      // events. Each entry is one file's reindex; the dropped file will
      // be picked up on its next change or by a future full reindex.
      state.queue.shift()
      log.warn("reindex queue at cap, dropping oldest job", {
        cap: MAX_QUEUE_DEPTH,
        droppedFor: file,
        droppedEvent: event,
      })
    }
    state.queue.push(async () => {
      if (state.disposed) return
      if (event === "unlink") {
        log.info("purging file from graph", { file })
        CodeGraphBuilder.purgeFile(state.projectID, file)
        return
      }
      log.info("reindexing file", { file, event })
      await CodeGraphBuilder.indexFile(state.projectID, file)
    })
    runNext(state)
  }

  function handleEvent(state: State, file: string, event: "add" | "change" | "unlink") {
    if (state.disposed) return
    // Skip files we can't index at all. Unlinks still go through because
    // we may have indexed the file before the extension changed.
    if (event !== "unlink" && !shouldIndex(file)) return

    // Coalesce rapid events on the same file. The most recent event wins
    // (e.g. add followed by change becomes a single "change"); unlink
    // takes precedence because it's terminal.
    const existing = state.pending.get(file)
    if (existing) {
      clearTimeout(existing.timer)
    }
    const nextEvent = event === "unlink" ? "unlink" : existing?.event === "unlink" ? "unlink" : event
    const timer = setTimeout(() => {
      state.pending.delete(file)
      enqueueReindex(state, file, nextEvent)
    }, DEBOUNCE_MS)
    state.pending.set(file, { timer, event: nextEvent })
  }

  /**
   * Start the code graph watcher for the given project. Idempotent —
   * calling start twice for the same project is a no-op. The watcher
   * lives until stop() is called or the process exits.
   *
   * The watcher subscribes to FileWatcher.Event.Updated on the Bus and
   * fans out file events to incremental reindex jobs, with a 1s debounce
   * per file and a concurrency cap of 4 active reindexes per project.
   */
  export function start(projectID: ProjectID): void {
    if (instances.has(projectID)) return
    const state: State = {
      projectID,
      pending: new Map(),
      activeReindex: 0,
      queue: [],
      disposed: false,
    }
    state.unsubscribe = Bus.subscribe(
      FileWatcher.Event.Updated,
      Instance.bind((event) => {
        const { file, event: kind } = event.properties
        handleEvent(state, file, kind)
      }),
    )
    instances.set(projectID, state)
    log.info("started code graph watcher", { projectID })
  }

  /**
   * Stop the watcher for a project. Clears pending debounce timers and
   * unsubscribes from the Bus. Jobs that are already running continue
   * to completion — we never interrupt an indexing pass partway.
   */
  export function stop(projectID: ProjectID): void {
    const state = instances.get(projectID)
    if (!state) return
    state.disposed = true
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timer)
    }
    state.pending.clear()
    state.queue.length = 0
    state.unsubscribe?.()
    instances.delete(projectID)
    log.info("stopped code graph watcher", { projectID })
  }

  // Test helper: report how many files are currently sitting in the
  // debounce queue for this project. Used by integration tests that
  // want to prove an event was routed through handleEvent without
  // waiting for the reindex job to run.
  export function __pendingCountForTests(projectID: ProjectID): number {
    return instances.get(projectID)?.pending.size ?? 0
  }

  // Test helper: force synchronous drain of pending debounced events.
  // Production code should never call this.
  export async function __drainForTests(projectID: ProjectID): Promise<void> {
    const state = instances.get(projectID)
    if (!state) return
    // Fire all pending timers immediately.
    const pending = [...state.pending.entries()]
    for (const [file, p] of pending) {
      clearTimeout(p.timer)
      state.pending.delete(file)
      enqueueReindex(state, file, p.event)
    }
    // Wait for the queue to drain.
    while (state.queue.length > 0 || state.activeReindex > 0) {
      await new Promise((r) => setTimeout(r, 10))
    }
  }
}
