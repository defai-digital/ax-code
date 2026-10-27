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
const LOCK_MALFORMED_GRACE_MS = LOCK_TIMEOUT_MS

type AuthLockBody = ProcessLockBody & {
  token: string
}

function normalizeProviderID(providerID: string) {
  return providerID.replace(/[^\w\-.:/]/g, "").replace(/\/+$/, "")
}

function readAuthData() {
  return Filesystem.readJson<Record<string, unknown>>(file).catch((error) => {
    if (Filesystem.isEnoent(error)) return {} as Record<string, unknown>
    throw error
  })
}

async function cleanupAuthLockFile() {
  await fsPromises.unlink(lockFile).catch((error) => {
    if (Filesystem.isEnoent(error)) return
    throw error
  })
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

  async function readLockFile() {
    return fsPromises.readFile(lockFile, "utf-8").catch((error) => {
      if (Filesystem.isEnoent(error)) return undefined
      throw error
    })
  }

  async function readSnapshot() {
    const stat = await fsPromises.stat(lockFile).catch((error) => {
      if (Filesystem.isEnoent(error)) return undefined
      throw error
    })
    if (!stat) return undefined
    const text = await readLockFile()
    if (text === undefined) return undefined
    return {
      text,
      holder: parseProcessLockBody<{ token: string }>(text),
      mtimeMs: stat.mtimeMs,
    }
  }

  async function removeStaleSnapshot(snapshot: { text: string; mtimeMs: number }) {
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
      const current = await readLockFile()
      if (current === undefined) return true
      if (current !== snapshot.text) return false
      const currentStat = await fsPromises.stat(lockFile).catch((error) => {
        if (Filesystem.isEnoent(error)) return undefined
        throw error
      })
      if (!currentStat) return true
      if (currentStat.mtimeMs !== snapshot.mtimeMs) return false
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
      // Exclusive creation happens before the owner writes the JSON body. A
      // concurrent reader can therefore observe an empty or partial body for
      // a brief window; never reap that in-progress lock as corrupt. Truly
      // abandoned malformed locks become recoverable after one acquire window.
      if (Date.now() - snapshot.mtimeMs <= LOCK_MALFORMED_GRACE_MS) return false
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
    // Credentials are global; provider state is cached per project directory.
    // Invalidate every live Instance so connecting a key in project A is
    // visible when switching to project B without reconnecting.
    await Provider.invalidateAll()
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

  // ADR-246: a non-secret credential-source reference. Stored next to the
  // other auth entries so `ax-code auth export/import` can round-trip the
  // reference exactly. No encryption is applied — the type is structurally
  // non-secret, and the only field that could grow sensitive is `kind` (we
  // reject additions that don't pass a re-review of this invariant).
  export const CredentialSource = z
    .object({
      type: z.literal("credential_source"),
      // Shape only; the source schema lives in src/provider/credential-source.ts
      // and is validated on read in `all()`. We keep the on-disk shape
      // permissive here so the auth store can survive a bump in
      // CredentialSource.Source without forcing a migration.
      source: z
        .object({
          kind: z.string(),
        })
        .catchall(z.unknown()),
    })
    .meta({ ref: "CredentialSource" })
  export type CredentialSource = z.infer<typeof CredentialSource>

  const InfoSchema = z.discriminatedUnion("type", [Oauth, Api, WellKnown, CredentialSource]).meta({ ref: "Auth" })
  export const Info = Object.assign(InfoSchema, { zod: InfoSchema })
  export type Info = z.infer<typeof InfoSchema>

  // Config and provider initialization read auth concurrently. Coalesce the
  // first read so both callers share the same canary migration and cannot race
  // on the auth lock during a fresh install.
  let allPending: Promise<Record<string, Info>> | undefined

  // Provider IDs whose stored credentials failed to decrypt on the most recent
  // read. Kept so callers (ensemble tools, provider status surfaces) can tell
  // "no credential" apart from "credential present but unrecoverable" instead
  // of reporting an authed provider as simply unknown.
  let lastDecryptionFailures: readonly string[] = []

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

  async function loadAll(): Promise<Record<string, Info>> {
    let data: Record<string, unknown>
    try {
      data = await readAuthData()
    } catch (cause) {
      throw authError("Failed to read auth data", cause)
    }

    // A canary that fails verification usually means the crypto runtime
    // changed (e.g. compiled binary ↔ bun source upgrade) — but a corrupt or
    // partially-written canary fails the same check, and treating that as a
    // runtime change would mask every stored credential (#392). Fall through
    // to per-entry decryption: entries that genuinely fail are dropped and
    // recorded below; intact entries stay usable. The invalid canary is
    // rewritten during migration so later reads can trust it again.
    const canaryValid = data.__canary ? verifyCanary(data.__canary) : false
    if (data.__canary && !canaryValid) {
      const atRisk = Object.keys(data).filter((k) => k !== "__canary")
      if (atRisk.length) {
        log.warn(
          `encryption canary failed verification — attempting per-key decryption for ${atRisk.length} provider key(s): ${atRisk.join(", ")}. ` +
            `Run "ax-code providers" to re-enter any that fail.`,
        )
      }
    }

    let migrate = false
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
    lastDecryptionFailures = failed
    if (failed.length) {
      log.warn(
        `${failed.length} provider key(s) could not be decrypted: ${failed.join(", ")}. ` +
          `Run "ax-code providers" to re-enter credentials.`,
      )
    }

    if (migrate || !canaryValid) {
      // Re-encrypt legacy entries with proper 32-byte salt,
      // and (re)write a canary so future upgrades can detect
      // crypto runtime changes without attempting decryption.
      //
      // Preserve the original on-disk values first so providers that
      // failed to decrypt (e.g. a transient install-secret issue or a
      // partially-written field) are kept as-is and can be recovered on
      // a later read — this full-file rewrite must not erase them.
      try {
        using _crossProcess = await acquireFileLock()
        using _inProcess = await Lock.write("auth")
        // The initial read happens before the lock so ordinary reads remain
        // cheap. Re-read under the write lock before a migration rewrite:
        // Auth.set/remove may have committed newer credentials meanwhile.
        const latest = await readAuthData()
        const updated: Record<string, unknown> = { ...latest }
        if (!updated.__canary || !verifyCanary(updated.__canary)) updated.__canary = createCanary()
        for (const [key, info] of Object.entries(entries)) {
          if (!(key in latest)) continue
          // Migrate only the exact value we inspected. Preserve a concurrent
          // replacement instead of overwriting it with a stale credential.
          if (JSON.stringify(latest[key]) !== JSON.stringify(providerData[key])) continue
          updated[key] = encryptEntry(info)
        }
        await Filesystem.writeJson(file, updated, 0o600)
      } catch (cause) {
        throw authError("Failed to migrate auth entries", cause)
      }
    }

    return entries
  }

  /**
   * Provider IDs whose stored credentials could not be decrypted (machine key
   * or crypto runtime changed). Reads auth storage to refresh the list. These
   * providers have an auth record on disk but are dropped from the connected
   * set; the fix is `ax-code providers login --provider <id>`.
   */
  export async function decryptionFailures(): Promise<readonly string[]> {
    await all().catch(() => undefined)
    return lastDecryptionFailures
  }

  export function all(): Promise<Record<string, Info>> {
    if (allPending) return allPending

    const pending = loadAll()
    allPending = pending
    pending.then(
      () => {
        if (allPending === pending) allPending = undefined
      },
      () => {
        if (allPending === pending) allPending = undefined
      },
    )
    return pending
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
    allPending = undefined
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
    allPending = undefined
    await invalidateProviderCacheAfterAuthChange()
  }

  // ADR-246: a non-secret, shareable view of the auth store for
  // `ax-code auth export`. Only the structural fields of an entry are kept:
  //   - credential_source entries keep `source.kind` and every public
  //     reference field
  //   - api / oauth / wellknown entries are summarized to the provider id
  //     and a placeholder that names the type — no key, token, refresh,
  //     access, or accountId field is ever copied into the export.
  export type ExportEntry =
    | {
        type: "credential_source"
        source: Record<string, unknown>
      }
    | {
        type: "summary"
        summary: string
      }

  export type ExportEnvelope = {
    version: 1
    exportedAt: string
    providers: Record<string, ExportEntry>
  }

  function summarizeSecretEntry(info: Info): ExportEntry {
    if (info.type === "credential_source") {
      return { type: "credential_source", source: info.source as Record<string, unknown> }
    }
    // The remaining types are secret-bearing. The export never carries
    // encrypted material; it carries a placeholder that names the shape so
    // `auth import` can know an entry existed without recreating a secret.
    if (info.type === "api") return { type: "summary", summary: "api" }
    if (info.type === "oauth") return { type: "summary", summary: "oauth" }
    if (info.type === "wellknown") return { type: "summary", summary: "wellknown" }
    return { type: "summary", summary: "unknown" }
  }

  /**
   * Build a shareable export envelope. Only structural / reference data is
   * included; no key, refresh, access, or token is ever copied into the
   * result. The function never throws on missing fields — an entry that
   * somehow fails to summarize is dropped and reported in the returned
   * `skipped` list so callers (and tests) can assert on it.
   */
  export async function exportEnvelope(input?: { read?: () => Promise<Record<string, Info>> }): Promise<{
    envelope: ExportEnvelope
    skipped: string[]
  }> {
    const entries: Record<string, Info> = input?.read ? await input.read() : await all()
    const providers: Record<string, ExportEntry> = {}
    const skipped: string[] = []
    for (const [providerID, info] of Object.entries(entries)) {
      try {
        providers[providerID] = summarizeSecretEntry(info)
      } catch {
        skipped.push(providerID)
      }
    }
    return {
      envelope: {
        version: 1,
        exportedAt: new Date().toISOString(),
        providers,
      },
      skipped,
    }
  }

  export type ImportPlan = {
    willCreate: string[]
    willSkip: { providerID: string; reason: string }[]
  }

  /**
   * Plan a re-import of a previously exported envelope. Default mode is
   * dry-run: no write happens, the returned `willCreate` describes what WOULD
   * be created. `--write` callers must invoke `applyImport(plan, ...)` only
   * when they want the side effect.
   */
  export async function planImport(
    envelope: ExportEnvelope,
    input?: { existing?: Record<string, Info> },
  ): Promise<ImportPlan> {
    const existing = input?.existing ?? (await all())
    const willCreate: string[] = []
    const willSkip: { providerID: string; reason: string }[] = []
    for (const [providerID, entry] of Object.entries(envelope.providers ?? {})) {
      // Never overwrite an existing connection — the user has to re-login.
      if (existing[providerID]) {
        willSkip.push({ providerID, reason: "exists" })
        continue
      }
      // Only reference-style entries are re-creatable. Summary placeholders
      // for an existing api/oauth/wellknown require the user to re-enter
      // their secret.
      if (entry.type !== "credential_source") {
        willSkip.push({ providerID, reason: "secret entry requires re-authentication" })
        continue
      }
      willCreate.push(providerID)
    }
    return { willCreate, willSkip }
  }

  /**
   * Apply a previously-computed import plan. Only `willCreate` providers
   * whose auth entry is a `credential_source` are written. Existing entries
   * are never overwritten, matching the dry-run plan.
   */
  export async function applyImport(
    envelope: ExportEnvelope,
    plan: ImportPlan,
  ): Promise<{ created: string[]; skipped: { providerID: string; reason: string }[] }> {
    const created: string[] = []
    const skipped = [...plan.willSkip]
    // The plan can be stale: the CLI confirms it interactively, and another
    // process may connect one of these providers meanwhile. Re-read so an
    // entry created after planning is still never overwritten.
    const existing = await all()
    for (const providerID of plan.willCreate) {
      if (existing[providerID]) {
        skipped.push({ providerID, reason: "exists" })
        continue
      }
      const entry = envelope.providers[providerID]
      if (!entry || entry.type !== "credential_source") {
        skipped.push({ providerID, reason: "missing or unsupported entry" })
        continue
      }
      await set(providerID, {
        type: "credential_source",
        source: entry.source as { kind: string } & Record<string, unknown>,
      } as unknown as Info)
      created.push(providerID)
    }
    return { created, skipped }
  }
}
