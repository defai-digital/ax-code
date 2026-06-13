import path from "path"
import fsPromises from "fs/promises"
import { unlinkSync, readFileSync } from "fs"
import { createHash, randomUUID } from "crypto"
import { NamedError } from "@ax-code/util/error"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { encryptField, decryptField, createCanary, verifyCanary } from "./encryption"
import { Lock } from "../util/lock"
import { Log } from "../util/log"
import { sleep } from "../util/timeout"
import {
  createProcessLockBody,
  isSameProcessLockHost,
  parseProcessLockBody,
  type ProcessLockBody,
} from "../util/process-lock"

const log = Log.create({ service: "auth" })

const file = path.join(Global.Path.data, "auth.json")
const lockFile = `${file}.lock`
const LOCK_TIMEOUT_MS = 5_000
const LOCK_POLL_MS = 20
const LOCK_STALE_MS = 60 * 60 * 1000

type AuthLockBody = ProcessLockBody & {
  token: string
}

function normalizeProviderID(providerID: string) {
  return providerID.replace(/[^\w\-.:/]/g, "").replace(/\/+$/, "")
}

function readAuthData() {
  return Filesystem.readJson<Record<string, unknown>>(file).catch(() => ({}) as Record<string, unknown>)
}

async function cleanupAuthLockFile() {
  await fsPromises.unlink(lockFile).catch(() => {})
}

function staleLockClaimFile(text: string) {
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 16)
  return `${lockFile}.stale-${digest}`
}

// Cross-process advisory lock using exclusive file creation.
// Prevents two concurrent ax-code processes (e.g. CLI + desktop app)
// from racing on auth.json. Falls back to in-process Lock.write("auth")
// for same-process mutual exclusion.
//
// Returns a `Disposable` so callers can use `using` syntax. The dispose
// path runs synchronously (`unlinkSync`) — the previous async release
// returned a `() => Promise<void>` that callers invoked without `await`,
// so the unlink raced with subsequent acquires and could leave the
// lockfile on disk after release (BUG-208). With sync dispose, the
// lockfile is gone the moment the `using` block exits.
//
// We still verify the token on release: between acquire and release,
// another process may have stolen the lock (if `maybeSteal` decided this
// process was dead). Deleting their lockfile would be a real bug.
function makeAuthLockDisposable(ownToken: string): Disposable {
  let disposed = false
  return {
    [Symbol.dispose]: () => {
      if (disposed) return
      disposed = true
      try {
        const text = readFileSync(lockFile, "utf-8")
        const parsed = parseProcessLockBody<{ token: string }>(text)
        if (!parsed || parsed.token !== ownToken) return
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return
        // Unreadable / corrupt lockfile: someone else's problem to clean
        // up (or `maybeSteal` will reap it on the next acquire).
        log.warn("auth lock release: failed to read lockfile", { err })
        return
      }
      try {
        unlinkSync(lockFile)
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return
        log.error("auth lock release failed", { err })
      }
    },
  }
}

async function acquireFileLock(): Promise<Disposable> {
  const body: AuthLockBody = { ...createProcessLockBody(), token: randomUUID() }

  async function tryCreate() {
    const fd = await fsPromises.open(lockFile, "wx")
    try {
      await fd.writeFile(JSON.stringify(body))
      return true
    } finally {
      await fd.close()
    }
  }

  async function readSnapshot() {
    const text = await fsPromises.readFile(lockFile, "utf-8").catch(() => undefined)
    if (!text) return undefined
    return {
      text,
      holder: parseProcessLockBody<{ token: string }>(text),
    }
  }

  async function removeStaleSnapshot(snapshot: { text: string }) {
    const claimFile = staleLockClaimFile(snapshot.text)
    let fd: fsPromises.FileHandle | undefined
    try {
      fd = await fsPromises.open(claimFile, "wx")
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false
      throw error
    } finally {
      await fd?.close()
    }

    try {
      const current = await fsPromises.readFile(lockFile, "utf-8").catch(() => undefined)
      if (current === undefined) return true
      if (current !== snapshot.text) return false
      await cleanupAuthLockFile()
      return true
    } finally {
      await fsPromises.unlink(claimFile).catch(() => {})
    }
  }

  async function maybeSteal() {
    const snapshot = await readSnapshot()
    if (!snapshot) return true
    const holder = snapshot.holder
    if (!holder) {
      return removeStaleSnapshot(snapshot)
    }

    const sameHost = isSameProcessLockHost(holder)
    if (sameHost && holder.pid !== process.pid) {
      let alive = true
      try {
        process.kill(holder.pid, 0)
      } catch (error) {
        alive = (error as NodeJS.ErrnoException)?.code !== "ESRCH"
      }
      if (!alive) {
        return removeStaleSnapshot(snapshot)
      }
      return false
    }

    if (!sameHost && Date.now() - holder.startedAt > LOCK_STALE_MS) {
      return removeStaleSnapshot(snapshot)
    }

    return false
  }

  const deadline = Date.now() + LOCK_TIMEOUT_MS
  while (true) {
    try {
      if (await tryCreate()) {
        return makeAuthLockDisposable(body.token)
      }
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e
    }

    if (await maybeSteal()) continue
    if (Date.now() >= deadline) {
      throw new Error("Failed to acquire auth lock: timed out waiting for active holder")
    }
    await sleep(LOCK_POLL_MS)
  }
}

async function invalidateProviderCacheAfterAuthChange() {
  try {
    const { Provider } = await import("../provider/provider")
    await Provider.invalidate()
  } catch {
    // Auth is also used before an Instance context exists. In that case
    // there is no provider cache to invalidate.
  }
}

export namespace Auth {
  export const Oauth = z.object({
    type: z.literal("oauth"),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
    accountId: z.string().optional(),
    enterpriseUrl: z.string().optional(),
  })
  export type Oauth = z.infer<typeof Oauth>

  export const Api = z.object({
    type: z.literal("api"),
    key: z.string(),
  })
  export type Api = z.infer<typeof Api>

  export const WellKnown = z.object({
    type: z.literal("wellknown"),
    key: z.string(),
    token: z.string(),
  })
  export type WellKnown = z.infer<typeof WellKnown>

  const InfoSchema = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export const Info = Object.assign(InfoSchema, { zod: InfoSchema })
  export type Info = z.infer<typeof InfoSchema>

  export const AuthError = NamedError.create(
    "AuthError",
    z.object({
      message: z.string(),
      cause: z.unknown().optional(),
    }),
  )
  export type AuthError = InstanceType<typeof AuthError>

  function authError(message: string, cause: unknown): AuthError {
    return new AuthError({ message, cause })
  }

  function decryptEntry(value: unknown) {
    if (value && typeof value === "object" && "type" in value) {
      const v = value as Record<string, unknown>
      if (v.type === "api") return decryptField(v, "key")
      if (v.type === "wellknown") return decryptField(decryptField(v, "key"), "token")
      if (v.type === "oauth") return decryptField(decryptField(v, "access"), "refresh")
    }
    return value
  }

  function needsReEncrypt(entry: unknown): boolean {
    return !!(entry && typeof entry === "object" && "__needsReEncrypt" in entry)
  }

  function encryptEntry(info: Info): unknown {
    const raw = { ...info } as Record<string, unknown>
    if (info.type === "api") return encryptField(raw, "key")
    if (info.type === "wellknown") return encryptField(encryptField(raw, "key"), "token")
    if (info.type === "oauth") return encryptField(encryptField(raw, "access"), "refresh")
    return info
  }

  export async function get(providerID: string) {
    return (await all())[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    let data: Record<string, unknown>
    try {
      data = await Filesystem.readJson<Record<string, unknown>>(file).catch(() => ({}) as Record<string, unknown>)
    } catch (cause) {
      throw authError("Failed to read auth data", cause)
    }

    // Fast-path: if a canary exists and fails verification, the crypto
    // runtime changed (e.g. compiled binary ↔ bun source upgrade).
    // All encrypted keys are unrecoverable — skip per-key decryption
    // attempts and tell the user which providers need re-entry.
    if (data.__canary && !verifyCanary(data.__canary)) {
      const stale = Object.keys(data).filter((k) => k !== "__canary")
      if (stale.length) {
        log.warn(
          `encryption runtime changed — ${stale.length} provider key(s) need re-entry: ${stale.join(", ")}. ` +
            `Run "ax-code providers" to reconnect.`,
        )
      }
      return {}
    }

    let migrate = false
    const canaryMissing = !data.__canary
    const { __canary: _, ...providerData } = data
    const entries: Record<string, Info> = {}
    const decryptedByKey = new Map<string, unknown>()

    for (const [key, value] of Object.entries(providerData)) {
      const decrypted = decryptEntry(value)
      decryptedByKey.set(key, decrypted)
      if (needsReEncrypt(decrypted)) migrate = true
      const parsed = Info.safeParse(decrypted)
      if (parsed.success) entries[key] = parsed.data
    }

    // Identify providers whose keys failed decryption (field set to undefined)
    const failed: string[] = []
    for (const [key, decrypted] of decryptedByKey) {
      if (decrypted && typeof decrypted === "object" && "type" in decrypted) {
        const d = decrypted as Record<string, unknown>
        const sensitive =
          d.type === "api"
            ? ["key"]
            : d.type === "wellknown"
              ? ["key", "token"]
              : d.type === "oauth"
                ? ["access", "refresh"]
                : []
        if (sensitive.some((f) => d[f] === undefined) && !(key in entries)) {
          failed.push(key)
        }
      }
    }
    if (failed.length) {
      log.warn(
        `${failed.length} provider key(s) could not be decrypted: ${failed.join(", ")}. ` +
          `Run "ax-code providers" to re-enter credentials.`,
      )
    }

    if (migrate || canaryMissing) {
      // Re-encrypt legacy entries with proper 32-byte salt,
      // and write a canary so future upgrades can detect
      // crypto runtime changes without attempting decryption.
      //
      // Preserve the original on-disk values first so providers that
      // failed to decrypt (e.g. a transient install-secret issue or a
      // partially-written field) are kept as-is and can be recovered on
      // a later read — this full-file rewrite must not erase them.
      const updated: Record<string, unknown> = { ...providerData, __canary: createCanary() }
      for (const [key, info] of Object.entries(entries)) {
        updated[key] = encryptEntry(info)
      }
      try {
        using _crossProcess = await acquireFileLock()
        using _inProcess = await Lock.write("auth")
        await Filesystem.writeJson(file, updated, 0o600)
      } catch (cause) {
        throw authError("Failed to migrate auth entries", cause)
      }
    }

    return entries
  }

  export async function set(key: string, info: Info) {
    const norm = normalizeProviderID(key)
    if (!norm || norm.includes("..")) throw new AuthError({ message: "Invalid provider ID" })
    try {
      using _crossProcess = await acquireFileLock()
      using _inProcess = await Lock.write("auth")
      const data = await readAuthData()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      if (!data.__canary || !verifyCanary(data.__canary)) data.__canary = createCanary()
      await Filesystem.writeJson(file, { ...data, [norm]: encryptEntry(info) }, 0o600)
    } catch (cause) {
      if (cause instanceof AuthError) throw cause
      throw authError("Failed to write auth data", cause)
    }
    await invalidateProviderCacheAfterAuthChange()
  }

  export async function remove(key: string) {
    const norm = normalizeProviderID(key)
    try {
      using _crossProcess = await acquireFileLock()
      using _inProcess = await Lock.write("auth")
      const data = await readAuthData()
      delete data[key]
      delete data[norm]
      delete data[norm + "/"]
      await Filesystem.writeJson(file, data, 0o600)
    } catch (cause) {
      throw authError("Failed to write auth data", cause)
    }
    await invalidateProviderCacheAfterAuthChange()
  }
}
