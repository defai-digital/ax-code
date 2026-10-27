import path from "path"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { FileWatcher } from "../file/watcher"
import { Instance } from "../project/instance"
import { LANGUAGE_EXTENSIONS } from "@ax-code/ax-code-intel/language"
import { KeyedSerialQueue } from "../util/queue"
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

// Backpressure cap for the per-project reindex queue. Queue entries are
// batch jobs (one per flush window), so the cap is rarely approached, but
// a runaway event source could still grow the queue without it. When the
// cap is reached we drop the oldest queued job so the most recent file
// changes still get indexed promptly; dropped files will be picked up on
// their next modification or by a full reindex.
const MAX_QUEUE_DEPTH = 256

// After a file's debounce expires it joins the current batch; the batch
// flushes after this window. Burst events (git checkout firing hundreds of
// per-file timers within the same second) coalesce into one indexFiles()
// call instead of one LSP round-trip per file, while a single file save
// only pays this much extra latency on top of the debounce.
const BATCH_FLUSH_MS = 100

export namespace CodeGraphWatcher {
  type Pending = {
    timer: ReturnType<typeof setTimeout>
    event: "add" | "change" | "unlink"
  }

  type State = {
    projectID: ProjectID
    pending: Map<string, Pending>
    ripe: Map<string, "add" | "change" | "unlink">
    flushTimer?: ReturnType<typeof setTimeout>
    activeReindex: number
    queue: Array<() => Promise<void>>
    // Per-file-path serialization for graph mutations. Purge and
    // reindex jobs for the SAME path run one-at-a-time in arrival
    // order (so a purge cannot overlap a still-running reindex of the
    // file it deletes), while different paths stay fully concurrent —
    // the whole project is never serialized. The job queue above still
    // caps how many jobs (batches) run at once; this queue orders work
    // within a path across jobs.
    serial: KeyedSerialQueue
    unsubscribe?: () => void
    disposed: boolean
  }

  // Single active watcher per JavaScript process. ax-code's Instance
  // machinery already scopes state per working directory, and we tie
  // the watcher to whichever Instance is currently active. When the
  // user switches directories (rare in practice), start() is called
  // again for the new instance.
  const instances = new Map<ProjectID, State>()

  Instance.onLifecycle((event) => {
    if (event.kind !== "dispose.start" || !event.projectID) return
    stop(event.projectID as ProjectID)
  })

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

  function enqueue(state: State, job: () => Promise<void>) {
    if (state.disposed) return
    if (state.queue.length >= MAX_QUEUE_DEPTH) {
      // Drop oldest queued job so we keep up with the most recent file
      // events; dropped files will be picked up on their next change or
      // by a future full reindex.
      state.queue.shift()
      log.warn("reindex queue at cap, dropping oldest job", { cap: MAX_QUEUE_DEPTH })
    }
    state.queue.push(job)
    runNext(state)
  }

  function flushRipe(state: State) {
    if (state.disposed || state.ripe.size === 0) return
    const entries = [...state.ripe.entries()]
    state.ripe.clear()
    const unlinked = entries.filter(([, event]) => event === "unlink").map(([file]) => file)
    const changed = entries.filter(([, event]) => event !== "unlink").map(([file]) => file)

    if (unlinked.length > 0) {
      enqueue(state, async () => {
        if (state.disposed) return
        // Each purge holds only its own file's lane, so purges for
        // different files stay concurrent. A purge for a file whose
        // reindex is still in flight waits for that reindex to settle
        // instead of racing it.
        await Promise.all(
          unlinked.map((file) =>
            state.serial.run(file, async () => {
              log.info("purging file from graph", { file })
              await CodeGraphBuilder.purgeFile(state.projectID, file)
            }),
          ),
        )
      })
    }
    if (changed.length > 0) {
      enqueue(state, async () => {
        if (state.disposed) return
        // Hold every changed file's lane for the duration of the batch
        // reindex (still ONE indexFiles call for the whole burst), so a
        // later purge or reindex batch touching any of these files
        // queues behind this batch instead of interleaving with it.
        // Lanes are acquired in sorted order: two overlapping batches
        // with overlapping file sets can then never wait on each other
        // in opposite orders (single-key purge jobs cannot form a
        // cycle either), and files outside the batch are unaffected.
        const ordered = [...changed].sort()
        let pending = ordered.length
        let markAcquired!: () => void
        const acquired = new Promise<void>((resolve) => (markAcquired = resolve))
        let release!: () => void
        const lanes = new Promise<void>((resolve) => (release = resolve))
        for (const file of ordered) {
          state.serial.run(file, () => {
            if (--pending === 0) markAcquired()
            return lanes
          })
        }
        try {
          await acquired
          log.info("reindexing files", { count: changed.length })
          await CodeGraphBuilder.indexFiles(state.projectID, changed, {
            concurrency: Math.min(changed.length, MAX_CONCURRENT_REINDEX),
            lock: "none",
            pruneOrphans: false,
          })
        } finally {
          release()
        }
      })
    }
  }

  function scheduleFlush(state: State) {
    if (state.disposed || state.flushTimer) return
    state.flushTimer = setTimeout(() => {
      state.flushTimer = undefined
      flushRipe(state)
    }, BATCH_FLUSH_MS)
  }

  function handleEvent(state: State, file: string, event: "add" | "change" | "unlink") {
    if (state.disposed) return
    // Skip files we can't index at all. Unlinks still go through because
    // we may have indexed the file before the extension changed.
    if (event !== "unlink" && !shouldIndex(file)) return

    // Coalesce rapid events on the same file. The most recent event wins
    // (e.g. add followed by change becomes a single "change"). That includes
    // a re-add after an unlink: editors and git rename over a path, so a
    // sticky unlink would purge a file that exists again and never reindex it.
    const existing = state.pending.get(file)
    if (existing) {
      clearTimeout(existing.timer)
    }
    const timer = setTimeout(() => {
      state.pending.delete(file)
      state.ripe.set(file, event)
      scheduleFlush(state)
    }, DEBOUNCE_MS)
    state.pending.set(file, { timer, event })
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
      ripe: new Map(),
      activeReindex: 0,
      queue: [],
      serial: new KeyedSerialQueue(),
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
    if (state.flushTimer) clearTimeout(state.flushTimer)
    state.flushTimer = undefined
    state.ripe.clear()
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
      state.ripe.set(file, p.event)
    }
    // Flush the batch immediately instead of waiting for the flush timer.
    if (state.flushTimer) {
      clearTimeout(state.flushTimer)
      state.flushTimer = undefined
    }
    flushRipe(state)
    // Wait for the queue to drain.
    while (state.queue.length > 0 || state.activeReindex > 0) {
      await new Promise((r) => setTimeout(r, 10))
    }
  }
}
