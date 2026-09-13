import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { NativeAddon } from "../native/addon"
import { Log } from "../util/log"
import { parseJsonResult } from "../util/json-value"
import { evidenceCacheMode } from "./mode"

const log = Log.create({ service: "evidence.cache" })
const MAX_VALUE_BYTES = 256 * 1024
const MAX_MEMORY_BYTES = 4 * 1024 * 1024
const MAX_ENTRIES = 128
const TTL_MS = 24 * 60 * 60 * 1000
const Envelope = z.object({
  version: z.literal(1),
  expiresAt: z.number().finite(),
  digest: z.string(),
  payload: z.string(),
})

export interface EvidenceStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  close(): Promise<void>
}

type State = {
  memory: Map<string, string>
  bytes: number
  store?: EvidenceStore
  attempted: boolean
  hits: number
  misses: number
  disposed: boolean
  pending?: Promise<void>
}

export namespace EvidenceCache {
  export function digest(value: string | Uint8Array): string {
    return createHash("sha256").update(value).digest("hex")
  }

  export function key(...identity: (string | number)[]): string {
    return digest(JSON.stringify(["evidence-v1", ...identity]))
  }

  const state = Instance.state<State>(
    () => ({ memory: new Map(), bytes: 0, attempted: false, hits: 0, misses: 0, disposed: false }),
    async (value) => {
      value.disposed = true
      value.memory.clear()
      await value.pending
      try {
        await value.store?.close()
      } catch {
        log.warn("persistent evidence cache close failed")
      }
    },
  )

  // Cache failures are misses, never authority to skip a source/permission check.
  // Do not persist native error text, paths, keys or payloads in diagnostics.
  async function fallback(value: State) {
    try {
      await value.store?.close()
    } catch {}
    value.store = undefined
    log.warn("persistent evidence cache unavailable; using bounded memory")
  }

  async function current(): Promise<State | undefined> {
    if (evidenceCacheMode() === "off") return undefined
    try {
      const value = state()
      if (evidenceCacheMode() !== "rocksdb") return value
      if (!value.attempted) {
        value.attempted = true
        const workspace = Instance.directory
        value.pending = (async () => {
          const open = NativeAddon.fs()?.openEvidenceStore
          if (!open) {
            await fallback(value)
            return
          }
          try {
            let root = path.join(Global.Path.cache, "evidence-v1")
            await fs.mkdir(root, { recursive: true, mode: 0o700 })
            const info = await fs.lstat(root)
            if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid cache directory")
            if (process.platform !== "win32") await fs.chmod(root, 0o700)
            root = await fs.realpath(root)
            const directory = path.join(root, digest(await fs.realpath(workspace)))
            if (value.disposed) return
            const store = await open(directory)
            if (value.disposed) await store.close()
            else value.store = store
          } catch {
            await fallback(value)
          }
        })()
      }
      await value.pending
      if (value.disposed) return undefined
      return value
    } catch {
      // Standalone syntactic extraction may have no active project instance.
      return undefined
    }
  }

  function remember(value: State, key: string, raw: string) {
    const old = value.memory.get(key)
    if (old !== undefined) value.bytes -= Buffer.byteLength(old)
    value.memory.delete(key)
    value.memory.set(key, raw)
    value.bytes += Buffer.byteLength(raw)
    while (value.memory.size > MAX_ENTRIES || value.bytes > MAX_MEMORY_BYTES) {
      const oldest = value.memory.entries().next().value
      if (!oldest) break
      value.memory.delete(oldest[0])
      value.bytes -= Buffer.byteLength(oldest[1])
    }
  }

  export async function get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    const value = await current()
    if (!value) return undefined
    try {
      const raw = value.memory.get(key) ?? (evidenceCacheMode() === "rocksdb" ? await value.store?.get(key) : undefined)
      if (raw && Buffer.byteLength(raw) <= MAX_VALUE_BYTES) {
        const parsed = parseJsonResult(raw)
        const envelope = parsed.ok ? Envelope.safeParse(parsed.value) : undefined
        if (
          envelope?.success &&
          envelope.data.expiresAt > Date.now() &&
          digest(envelope.data.payload) === envelope.data.digest
        ) {
          const payload = parseJsonResult(envelope.data.payload)
          const result = payload.ok ? schema.safeParse(payload.value) : undefined
          if (result?.success) {
            remember(value, key, raw)
            value.hits++
            return result.data
          }
        }
      }
    } catch {
      await fallback(value)
    }
    value.misses++
    return undefined
  }

  export async function put(key: string, payload: unknown): Promise<void> {
    const value = await current()
    if (!value) return
    try {
      const serialized = JSON.stringify(payload)
      const raw = JSON.stringify({
        version: 1,
        expiresAt: Date.now() + TTL_MS,
        digest: digest(serialized),
        payload: serialized,
      })
      if (Buffer.byteLength(raw) > MAX_VALUE_BYTES) return
      remember(value, key, raw)
      if (evidenceCacheMode() === "rocksdb") await value.store?.put(key, raw)
    } catch {
      await fallback(value)
    }
  }

  export async function stats() {
    const value = await current()
    return {
      backend: value?.store && evidenceCacheMode() === "rocksdb" ? "rocksdb" : value ? "memory" : "off",
      hits: value?.hits ?? 0,
      misses: value?.misses ?? 0,
      entries: value?.memory.size ?? 0,
      bytes: value?.bytes ?? 0,
    }
  }
}
