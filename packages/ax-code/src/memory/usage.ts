// Per-project usage record for memory entries and skills (ADR-249).
//
// The record feeds the read-only curation proposals (`memory curate`,
// `skill curate`). It is a best-effort side file: recording never throws, and a
// corrupt record degrades to "no usage known" rather than failing injection.
import syncFs from "node:fs"
import path from "path"
import z from "zod"
import { Filesystem } from "@/util/filesystem"
import { Hash } from "@/util/hash"
import { parseJsonResult } from "@/util/json-value"
import { Global } from "@/global"
import { Log } from "@/util/log"

export namespace UsageRecord {
  const log = Log.create({ service: "usage-record" })

  /** Hard bounds so the side file cannot grow without limit. */
  export const MAX_ENTRIES = 2000
  /** Pending in-memory updates are flushed after this many or on exit. */
  const FLUSH_THRESHOLD = 16

  export const Entry = z.object({
    last_used_at: z.string(),
    use_count: z.number().int().nonnegative(),
  })
  export type Entry = z.infer<typeof Entry>

  export const Data = z.object({
    version: z.literal(1),
    entries: z.record(z.string(), Entry),
  })
  export type Data = z.infer<typeof Data>

  const directories = new Map<string, string>()

  /** Directory holding per-project usage records and curation undo records. */
  export function directory(projectRoot: string): string {
    const root = path.resolve(projectRoot)
    const cached = directories.get(root)
    if (cached) return cached
    const dir = path.join(Global.Path.state, "curation", Hash.fast(root))
    directories.set(root, dir)
    return dir
  }

  export function file(projectRoot: string): string {
    return path.join(directory(projectRoot), "usage.json")
  }

  /** Key format is `<category>:<id>`; skills use `skill:<name>`. */
  export function memoryKey(kind: string, name: string): string {
    return `memory:${kind}/${name.trim().toLowerCase()}`
  }

  export function skillKey(name: string): string {
    return `skill:${name.trim()}`
  }

  export async function read(projectRoot: string): Promise<Data> {
    const empty: Data = { version: 1, entries: {} }
    const text = await Filesystem.readText(file(projectRoot)).catch(() => undefined)
    if (text === undefined) return empty
    const parsed = parseJsonResult(text)
    if (!parsed.ok) return empty
    const result = Data.safeParse(parsed.value)
    return result.success ? result.data : empty
  }

  /** Bounded merge: keep the most recently used entries within MAX_ENTRIES. */
  function bound(entries: Record<string, Entry>): Record<string, Entry> {
    const keys = Object.keys(entries)
    if (keys.length <= MAX_ENTRIES) return entries
    const kept = keys
      .sort((a, b) => (entries[b]!.last_used_at < entries[a]!.last_used_at ? -1 : 1))
      .slice(0, MAX_ENTRIES)
    return Object.fromEntries(kept.map((key) => [key, entries[key]!]))
  }

  const pending = new Map<string, Map<string, number>>()

  // Safety net for queued events that never reached a flush point (for
  // example a single skill invocation). Synchronous to be safe in `exit`.
  let hooked = false
  function hookExit() {
    if (hooked) return
    hooked = true
    process.once("exit", () => {
      for (const projectRoot of pending.keys()) void flushSync(projectRoot)
    })
  }

  function flushSync(projectRoot: string): void {
    const queue = pending.get(projectRoot)
    if (!queue || queue.size === 0) return
    pending.delete(projectRoot)
    const target = file(projectRoot)
    let fd: number | undefined
    try {
      const fs = syncFs
      let text = "{}"
      try {
        fd = fs.openSync(target, "r+")
        text = fs.readFileSync(fd, "utf8")
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined
        if (code !== "ENOENT") throw error
        fd = undefined
      }
      const parsed = parseJsonResult(text)
      // Only merge into a well-formed record; a corrupt file is left for the
      // next async flush to rebuild rather than overwritten on exit.
      if (!parsed.ok) return
      const current = Data.safeParse(parsed.value)
      const data: Data = current.success ? current.data : { version: 1, entries: {} }
      for (const [key, stamp] of queue) {
        const previous = data.entries[key]
        const iso = new Date(stamp).toISOString()
        const last = previous && previous.last_used_at > iso ? previous.last_used_at : iso
        data.entries[key] = { last_used_at: last, use_count: (previous?.use_count ?? 0) + 1 }
      }
      data.entries = bound(data.entries)
      const payload = JSON.stringify(data, null, 2)
      if (fd === undefined) {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fd = fs.openSync(target, "wx")
      } else {
        fs.ftruncateSync(fd, 0)
      }
      // Position 0: readFileSync left the descriptor at EOF.
      fs.writeSync(fd, payload, 0, "utf8")
    } catch {
      // Advisory only.
    } finally {
      if (fd !== undefined) {
        try {
          syncFs.closeSync(fd)
        } catch {
          // Advisory only.
        }
      }
    }
  }

  /**
   * Record that an entry was used. Never throws and never awaits the write
   * beyond a best-effort flush, so callers on the injection path stay cheap.
   */
  export function record(projectRoot: string, keys: string[], now: () => Date = () => new Date()): void {
    try {
      if (keys.length === 0) return
      hookExit()
      const stamp = now().getTime()

      let queue = pending.get(projectRoot)
      if (!queue) {
        queue = new Map()
        pending.set(projectRoot, queue)
      }
      for (const key of keys) queue.set(key, stamp)
      if (queue.size >= FLUSH_THRESHOLD) void flush(projectRoot).catch(() => {})
    } catch {
      // Usage tracking is advisory; never break the caller.
    }
  }

  /**
   * Serialize writes per project so two concurrent flushes cannot read the
   * same record and clobber each other's entries.
   */
  const queues = new Map<string, Promise<void>>()

  /** Resolve once queued usage for this project is persisted (best effort). */
  export function flush(projectRoot: string): Promise<void> {
    const previous = queues.get(projectRoot) ?? Promise.resolve()
    const next = previous.then(() => drain(projectRoot)).catch(() => {})
    queues.set(projectRoot, next)
    // Drop the chain entry once this write settles and nothing queued behind it.
    void next.then(() => {
      if (queues.get(projectRoot) === next) queues.delete(projectRoot)
    })
    return next
  }

  async function drain(projectRoot: string): Promise<void> {
    const queue = pending.get(projectRoot)
    if (!queue || queue.size === 0) return
    pending.delete(projectRoot)
    try {
      const data = await read(projectRoot)
      for (const [key, stamp] of queue) {
        const entry = data.entries[key]
        const iso = new Date(stamp).toISOString()
        const last = entry && entry.last_used_at > iso ? entry.last_used_at : iso
        data.entries[key] = { last_used_at: last, use_count: (entry?.use_count ?? 0) + 1 }
      }
      data.entries = bound(data.entries)
      await Filesystem.writeJson(file(projectRoot), data)
    } catch (error) {
      log.debug("failed to persist usage record", { projectRoot, error })
    }
  }
}
