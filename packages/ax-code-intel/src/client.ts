import { codeIntelHost } from "./host"
import { noteWorkspaceChange } from "./cache-context"
import { InternalBus } from "./internal/events"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { createHash, randomUUID } from "node:crypto"
import {
  CancellationTokenSource,
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node"
import { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types"
import { diffLines } from "diff"
import { Log } from "./internal/log"
import { LANGUAGE_EXTENSIONS } from "./language"
import z from "zod"
import type { LSPServer } from "./server"
import { NamedError } from "@ax-code/util/error"
import { withTimeout } from "./internal/timeout"
import { Filesystem } from "./internal/filesystem"
import { Lock } from "./internal/lock"
import { ContentCache } from "./content-cache"
import { ClientActivity } from "./client-activity"
import { sourceCacheBytes } from "./prewarm-profile"

// Local-only content fingerprint. The hash never leaves the process — it
// only compares the previous text content against the current one to skip
// redundant diagnostics work. We use SHA-256-prefix instead of Bun.hash
// so this code path stays bun-runtime-agnostic; the algorithm choice
// does not affect correctness because both producer and comparer always
// use the same function.
function fingerprintHash(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}

const DIAGNOSTICS_DEBOUNCE_MS = 150

// Hard cap on the per-client diagnostics Map to prevent unbounded growth in
// long sessions. 1000 is comfortably above typical working-set sizes while
// bounding memory. LRU eviction: the oldest entry (by insertion order) is
// removed when the cap is reached.
const MAX_CACHED_DIAGNOSTICS = 1000

// Maximum file size (in bytes) for which we compute incremental diffs on
// change. Above this threshold, the diff cost (linear in the larger of the
// two texts) approaches the cost of just sending the whole file, so we fall
// back to full sync. 1 MB is generous — typical source files are well under.
const MAX_INCREMENTAL_SYNC_BYTES = 1_000_000

// If the incremental change list would contain more than this many hunks, the
// diff is pathological (e.g. random shuffles). Fall back to full sync so we
// don't ship an enormous payload of small ranges.
const MAX_INCREMENTAL_HUNKS = 256

// Exported shape for tests.
export type LspContentChange = {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  text: string
}

/**
 * Compute LSP incremental contentChanges from a previously-sent text to a
 * new text. Returns null when the caller should fall back to full-document
 * sync — either the inputs are too large, or the diff is pathological, or
 * incremental would serialize larger than a full replace.
 *
 * Strategy: line-level diff via the `diff` package. For each hunk of
 * removed/added lines we emit a single LSP range replacement whose range
 * spans the removed lines and whose text is the added lines (as a single
 * string including trailing newlines for each line).
 *
 * LSP range semantics: 0-indexed {line, character}. A range covering full
 * lines 3 through 5 inclusive is start={line:3, char:0}, end={line:6, char:0}
 * — the end position is at the start of the line *after* the last removed
 * line, so the range is exclusive at the end.
 */
export function computeIncrementalChanges(oldText: string, newText: string): LspContentChange[] | null {
  if (oldText.length > MAX_INCREMENTAL_SYNC_BYTES || newText.length > MAX_INCREMENTAL_SYNC_BYTES) {
    return null
  }

  const parts = diffLines(oldText, newText)
  const changes: LspContentChange[] = []
  const oldEndsWithNewline = oldText.endsWith("\n")

  let oldLine = 0
  let i = 0
  while (i < parts.length) {
    const part = parts[i]
    const lineCount = part.count ?? 0

    if (!part.added && !part.removed) {
      oldLine += lineCount
      i++
      continue
    }

    const hunkStartLine = oldLine
    let removedLines = 0
    let removedText = ""
    let addedText = ""
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      const p = parts[i]
      if (p.removed) {
        removedLines += p.count ?? 0
        removedText += p.value
      }
      if (p.added) addedText += p.value
      i++
    }
    let hunkEndLine = hunkStartLine + removedLines
    let endCharacter = 0
    // When this hunk removes all the way through the end of `oldText` and
    // `oldText` has no trailing newline, the removed region ends mid-line —
    // there is no "line after the last removed line" to point at (a
    // document with no final newline has no such line, so `{line:
    // hunkEndLine, character: 0}` would name a line index past the end of
    // the document). Point at the actual end of the last removed line
    // instead: one line up, at the column where that line's text ends.
    if (i === parts.length && removedLines > 0 && !oldEndsWithNewline) {
      hunkEndLine -= 1
      const lastNewline = removedText.lastIndexOf("\n")
      endCharacter = lastNewline === -1 ? removedText.length : removedText.length - lastNewline - 1
    }
    changes.push({
      range: {
        start: { line: hunkStartLine, character: 0 },
        end: { line: hunkEndLine, character: endCharacter },
      },
      text: addedText,
    })
    oldLine = hunkEndLine

    if (changes.length > MAX_INCREMENTAL_HUNKS) return null
  }

  // If incremental would ship more text than a full replace, skip. We only
  // count the .text payload here — range metadata is small and symmetric
  // across comparisons, so including it would bias against incremental
  // even for reasonable diffs on small files.
  const incrementalTextBytes = changes.reduce((acc, c) => acc + c.text.length, 0)
  if (incrementalTextBytes >= newText.length) return null

  return changes
}

/**
 * Parse the server's declared `textDocumentSync` capability: either a bare
 * TextDocumentSyncKind number (0 = None, 1 = Full, 2 = Incremental) or an
 * options object carrying it in `change`. Returns undefined when the server
 * declared nothing — callers must treat that as full sync.
 */
export function textDocumentSyncKind(capabilities: Record<string, unknown> | undefined): number | undefined {
  const value = capabilities?.["textDocumentSync"]
  if (value === 0 || value === 1 || value === 2) return value
  if (value && typeof value === "object") {
    const change = (value as { change?: unknown }).change
    if (change === 0 || change === 1 || change === 2) return change
  }
  return undefined
}

export type TextDocumentSyncSettings = {
  openClose: boolean
  change: 0 | 1 | 2
  save: {
    enabled: boolean
    includeText: boolean
  }
}

/**
 * Normalize the two protocol forms of ServerCapabilities.textDocumentSync.
 *
 * A missing or malformed declaration keeps the historical full-sync fallback
 * because a few otherwise-compatible servers omit the capability. Explicit
 * declarations are honored exactly: None disables didChange, options-object
 * booleans default to false, and SaveOptions.includeText controls didSave.
 */
export function textDocumentSyncSettings(capabilities: Record<string, unknown> | undefined): TextDocumentSyncSettings {
  const value = capabilities?.["textDocumentSync"]
  if (value === 0) {
    return {
      openClose: false,
      change: 0,
      save: { enabled: false, includeText: false },
    }
  }
  if (value === 1 || value === 2) {
    return {
      openClose: true,
      change: value,
      save: { enabled: false, includeText: false },
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const options = value as { openClose?: unknown; change?: unknown; save?: unknown }
    const change = options.change === 0 || options.change === 1 || options.change === 2 ? options.change : 0
    const saveEnabled =
      options.save === true ||
      (options.save !== null && typeof options.save === "object" && !Array.isArray(options.save))
    const includeText =
      saveEnabled &&
      typeof options.save === "object" &&
      (options.save as { includeText?: unknown }).includeText === true
    return {
      openClose: options.openClose === true,
      change,
      save: { enabled: saveEnabled, includeText },
    }
  }
  return {
    openClose: true,
    change: 1,
    save: { enabled: false, includeText: false },
  }
}

export namespace LSPClient {
  const log = Log.create({ service: "lsp.client" })

  export type Info = NonNullable<Awaited<ReturnType<typeof create>>>

  export type Diagnostic = VSCodeDiagnostic

  export type MethodSupport = "supported" | "unsupported" | "unknown"

  export function diagnosticPathFromUri(uri: string) {
    try {
      return Filesystem.normalizePath(fileURLToPath(uri))
    } catch {
      return undefined
    }
  }

  export const InitializeError = NamedError.create(
    "LSPInitializeError",
    z.object({
      serverID: z.string(),
    }),
  )

  // Event shape is owned here; host propagation and bus registration happen
  // through CodeIntelHost.publishClientDiagnostics (the ax-code glue bridges
  // it onto the core Bus and keeps it in the SSE/OpenAPI event contract).
  export const Event = {
    Diagnostics: {
      type: "lsp.client.diagnostics" as const,
      properties: z.object({
        serverID: z.string(),
        path: z.string(),
      }),
    },
  }
  export type DiagnosticsPayload = { serverID: string; path: string }

  function capabilityEnabled(value: unknown): boolean {
    return value !== undefined && value !== null && value !== false
  }

  function capabilityHintsFromInitialize(capabilities: Record<string, unknown> | undefined): LSPServer.CapabilityHints {
    if (!capabilities) return {}
    const hints: LSPServer.CapabilityHints = {}

    if ("hoverProvider" in capabilities) hints.hover = capabilityEnabled(capabilities.hoverProvider)
    if ("definitionProvider" in capabilities) hints.definition = capabilityEnabled(capabilities.definitionProvider)
    if ("referencesProvider" in capabilities) hints.references = capabilityEnabled(capabilities.referencesProvider)
    if ("implementationProvider" in capabilities)
      hints.implementation = capabilityEnabled(capabilities.implementationProvider)
    if ("documentSymbolProvider" in capabilities)
      hints.documentSymbol = capabilityEnabled(capabilities.documentSymbolProvider)
    if ("workspaceSymbolProvider" in capabilities)
      hints.workspaceSymbol = capabilityEnabled(capabilities.workspaceSymbolProvider)
    if ("callHierarchyProvider" in capabilities)
      hints.callHierarchy = capabilityEnabled(capabilities.callHierarchyProvider)

    return hints
  }

  function methodSupport(
    method: LSPServer.Method,
    runtimeHints?: LSPServer.CapabilityHints,
    staticHints?: LSPServer.CapabilityHints,
  ): MethodSupport {
    const runtime = runtimeHints?.[method]
    if (runtime === true) return "supported"
    if (runtime === false) return "unsupported"

    const hint = staticHints?.[method]
    if (hint === true) return "supported"
    if (hint === false) return "unsupported"
    return "unknown"
  }

  export async function create(input: {
    serverID: string
    server: LSPServer.Handle
    root: string
    languageId?: string
    semantic?: boolean
    priority?: number
    capabilityHints?: LSPServer.CapabilityHints
    onClose?: (event: { error?: unknown }) => void
  }) {
    const l = log.clone().tag("serverID", input.serverID)
    l.info("starting client")

    const connection = createMessageConnection(
      new StreamMessageReader(input.server.process.stdout as any),
      new StreamMessageWriter(input.server.process.stdin as any),
    )

    const activity = new ClientActivity()
    const sendRequest = connection.sendRequest.bind(connection)
    connection.sendRequest = ((...args: Parameters<typeof sendRequest>) =>
      activity.run(() => sendRequest(...args))) as typeof connection.sendRequest

    const sendNotification = connection.sendNotification.bind(connection)
    connection.sendNotification = ((...args: Parameters<typeof sendNotification>) =>
      activity.run(() => sendNotification(...args))) as typeof connection.sendNotification

    const diagnostics = new Map<string, Diagnostic[]>()
    const serverLanguageId = input.languageId
    let closing = false
    let incompleteClose = false
    let closeNotified = false

    function notifyClosed(error?: unknown) {
      if (closing || closeNotified) return
      closeNotified = true
      input.onClose?.({ error })
    }

    connection.onClose(() => {
      l.warn("connection closed unexpectedly")
      notifyClosed()
    })
    connection.onError((error) => {
      l.warn("connection error", { error })
      notifyClosed(error)
    })

    function setDiagnostics(filePath: string, diags: Diagnostic[]) {
      // Move-to-end LRU: if we already have an entry, delete it before
      // re-inserting so it goes to the end of the iteration order.
      if (diagnostics.has(filePath)) {
        diagnostics.delete(filePath)
      } else if (diagnostics.size >= MAX_CACHED_DIAGNOSTICS) {
        // At capacity for a new key — evict the oldest entry.
        const oldest = diagnostics.keys().next().value
        if (oldest) {
          diagnostics.delete(oldest)
          l.info("evicted diagnostics for least-recently-updated file", { path: oldest })
        }
      }
      diagnostics.set(filePath, diags)
    }

    let pullsDiagnostics = false
    connection.onNotification("textDocument/publishDiagnostics", (params) => {
      if (pullsDiagnostics) return
      activity.touch()
      const filePath = diagnosticPathFromUri(params.uri)
      if (!filePath) {
        l.debug("skipping diagnostics for non-file URI", { uri: params.uri })
        return
      }
      l.info("textDocument/publishDiagnostics", {
        path: filePath,
        count: params.diagnostics.length,
      })
      const exists = diagnostics.has(filePath)
      setDiagnostics(filePath, params.diagnostics)
      // Only suppress the first TypeScript diagnostic event when it carries
      // zero diagnostics (the known "empty initial push" pattern). Real errors
      // in the first event must not be silently dropped.
      if (!exists && input.serverID === "typescript" && params.diagnostics.length === 0) return
      const payload = { path: filePath, serverID: input.serverID }
      InternalBus.publish(Event.Diagnostics.type, payload)
      codeIntelHost().publishClientDiagnostics(payload)
    })
    connection.onRequest("window/workDoneProgress/create", (params) => {
      l.info("window/workDoneProgress/create", params)
      return null
    })
    connection.onRequest("workspace/configuration", async () => {
      // Return server initialization options
      return [input.server.initialization ?? {}]
    })
    connection.onRequest("client/registerCapability", async () => {})
    connection.onRequest("client/unregisterCapability", async () => {})
    connection.onRequest("workspace/workspaceFolders", async () => [
      {
        name: "workspace",
        uri: pathToFileURL(input.root).href,
      },
    ])
    connection.listen()

    l.info("sending initialize")
    const initializeResult = await withTimeout(
      connection.sendRequest("initialize", {
        rootUri: pathToFileURL(input.root).href,
        processId: process.pid,
        workspaceFolders: [
          {
            name: "workspace",
            uri: pathToFileURL(input.root).href,
          },
        ],
        initializationOptions: {
          ...input.server.initialization,
        },
        capabilities: {
          window: {
            workDoneProgress: true,
          },
          workspace: {
            configuration: true,
            ...(input.serverID === "typescript" ? { diagnostics: { refreshSupport: true } } : {}),
            symbol: {
              resolveSupport: {
                properties: ["location.range"],
              },
            },
            didChangeWatchedFiles: {
              // No dynamic registration: the client/registerCapability
              // handler is a deliberate no-op, so claiming support here
              // would be a lie. Watched-file notifications are sent
              // proactively instead.
              dynamicRegistration: false,
            },
          },
          textDocument: {
            ...(input.serverID === "typescript"
              ? { diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false } }
              : {}),
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: true,
            },
            publishDiagnostics: {
              versionSupport: true,
            },
          },
        },
      }) as Promise<{ capabilities?: Record<string, unknown>; serverInfo?: { name?: string; version?: string } }>,
      45_000,
    ).catch((err) => {
      l.error("initialize error", { error: err })
      throw new InitializeError(
        { serverID: input.serverID },
        {
          cause: err,
        },
      )
    })

    const runtimeCapabilityHints = capabilityHintsFromInitialize(initializeResult?.capabilities)
    pullsDiagnostics =
      input.serverID === "typescript" && capabilityEnabled(initializeResult?.capabilities?.diagnosticProvider)
    // TypeScript 7.0.2 can retain the previous project snapshot when native
    // file-watch events race with a saved didChange. A protocol close/open
    // commits the replacement synchronously in that server. Keep this narrow:
    // other servers and versions retain their negotiated incremental sync.
    const reopenChangedDocuments =
      pullsDiagnostics &&
      initializeResult.serverInfo?.name === "typescript-go" &&
      initializeResult.serverInfo.version === "7.0.2"
    const staleDiagnostics = new Set<string>()
    let diagnosticGeneration = 0
    // Negotiated document sync mode. Ranged (incremental) didChange payloads
    // are only protocol-legal when this is TextDocumentSyncKind.Incremental.
    const documentSync = textDocumentSyncSettings(initializeResult?.capabilities)

    await connection.sendNotification("initialized", {})

    if (input.server.initialization) {
      await connection.sendNotification("workspace/didChangeConfiguration", {
        settings: input.server.initialization,
      })
    }

    const files: {
      [path: string]: number
    } = {}

    // Per-client path lock namespace. Concurrent notify.open/notify.close
    // for the same file must serialize because they read-modify-write the
    // per-client `files[path]` version counter. The common Lock primitive
    // owns waiter cleanup and timeout handling; the client-scoped prefix
    // keeps unrelated LSP clients from serializing each other.
    const pathLockPrefix = `lsp-client:${input.serverID}:${input.root}:${randomUUID()}`
    function normalizeDocumentPath(filePath: string) {
      return Filesystem.normalizePath(
        path.isAbsolute(filePath) ? filePath : path.resolve(codeIntelHost().projectRoot(), filePath),
      )
    }
    async function withPathLock<T>(filepath: string, fn: () => Promise<T>, deadline?: number): Promise<T> {
      return activity.run(async () => {
        const remaining = deadline === undefined ? 60_000 : deadline - Date.now()
        if (remaining <= 0) throw new Error("Native diagnostic inventory is incomplete; collection deadline expired")
        using _lock = await Lock.write(`${pathLockPrefix}:${filepath}`, { timeoutMs: remaining })
        if (deadline !== undefined && Date.now() >= deadline) {
          throw new Error("Native diagnostic inventory is incomplete; collection deadline expired")
        }
        return await fn()
      })
    }

    const lastContent = new ContentCache(sourceCacheBytes())
    const diagnosticTargets = new Set<string>()
    const diagnosticWaits = new Map<string, { generation: number; promise: Promise<void> }>()
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let refreshRunning = false
    let refreshAgain = false
    function scheduleDiagnosticRefresh() {
      if (closing || refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined
        if (refreshRunning) {
          refreshAgain = true
          return
        }
        refreshRunning = true
        void (async () => {
          for (const filePath of [...diagnosticTargets]) {
            if (closing) break
            if (files[filePath] === undefined || !staleDiagnostics.has(filePath)) continue
            await withPathLock(filePath, async () => {
              if (staleDiagnostics.has(filePath)) await refreshDiagnostics(filePath)
            })
          }
        })()
          .catch((error) => l.warn("diagnostic refresh failed", { error }))
          .finally(() => {
            refreshRunning = false
            if (refreshAgain) {
              refreshAgain = false
              scheduleDiagnosticRefresh()
            }
          })
      }, 50)
      refreshTimer.unref?.()
    }
    // TypeScript diagnostics depend on other files. Invalidate the inventory
    // on document and server refresh events; callers explicitly pull what
    // they need. Never report an in-flight or stale inventory as complete.
    function invalidateDiagnostics(eager = true) {
      if (!pullsDiagnostics) return
      diagnosticGeneration++
      for (const filePath of Object.keys(files)) staleDiagnostics.add(filePath)
      diagnostics.clear()
      if (eager) scheduleDiagnosticRefresh()
    }
    if (pullsDiagnostics) {
      connection.onRequest("workspace/diagnostic/refresh", () => {
        // Server background refreshes are not foreground use. Eagerly pulling
        // here can create a refresh/pull loop that continually renews the idle
        // lease. Preserve stale coverage until the next explicit collection.
        invalidateDiagnostics(false)
        return null
      })
    }
    async function refreshDiagnostics(filePath: string, timeoutMs = 15_000) {
      if (!pullsDiagnostics || files[filePath] === undefined) return
      diagnosticTargets.delete(filePath)
      diagnosticTargets.add(filePath)
      if (diagnosticTargets.size > MAX_CACHED_DIAGNOSTICS) {
        diagnosticTargets.delete(diagnosticTargets.values().next().value!)
      }
      staleDiagnostics.add(filePath)
      diagnostics.delete(filePath)
      const generation = diagnosticGeneration
      const cancellation = new CancellationTokenSource()
      try {
        const report = await withTimeout(
          connection.sendRequest<{ kind: string; items?: Diagnostic[] }>(
            "textDocument/diagnostic",
            { textDocument: { uri: pathToFileURL(filePath).href } },
            cancellation.token,
          ),
          timeoutMs,
        )
        // We send no previousResultId, so an unchanged report is invalid.
        if (report.kind !== "full" || !Array.isArray(report.items) || !report.items.every(VSCodeDiagnostic.is)) {
          throw new Error("Expected a full LSP diagnostic report")
        }
        if (closing || generation !== diagnosticGeneration || files[filePath] === undefined) return
        setDiagnostics(filePath, report.items)
        staleDiagnostics.delete(filePath)
        const payload = { path: filePath, serverID: input.serverID }
        InternalBus.publish(Event.Diagnostics.type, payload)
        codeIntelHost().publishClientDiagnostics(payload)
      } catch (error) {
        if (!closing) cancellation.cancel()
        l.warn("pull diagnostics failed", { path: filePath, error })
      } finally {
        cancellation.dispose()
      }
    }
    function setLastContent(filePath: string, text: string) {
      lastContent.set(filePath, text)
    }

    function contentUnchanged(filePath: string, text: string) {
      const prev = lastContent.get(filePath)
      if (!prev) return false
      if (prev.length !== text.length) return false
      return prev.hash === fingerprintHash(text)
    }

    function diagnosticsWait(input: { path: string }) {
      log.info("waiting for diagnostics", { path: input.path })
      let unsub: (() => void) | undefined
      let t: ReturnType<typeof setTimeout> | undefined
      let startTimeout: (() => void) | undefined
      const started = new Promise<void>((resolve) => {
        startTimeout = resolve
      })
      const diagnosticsSettled = new Promise<void>((resolve) => {
        unsub = InternalBus.subscribe<DiagnosticsPayload>(Event.Diagnostics.type, (event) => {
          if (event.path === input.path && event.serverID === result.serverID) {
            if (t) clearTimeout(t)
            t = setTimeout(() => {
              log.info("got diagnostics", { path: input.path })
              unsub?.()
              resolve()
            }, DIAGNOSTICS_DEBOUNCE_MS)
          }
        })
      })
      const promise = started
        .then(() => withTimeout(diagnosticsSettled, 3000))
        .catch((error) => {
          log.debug("diagnostics wait timed out", { path: input.path, error })
        })
        .finally(() => {
          if (t) clearTimeout(t)
          unsub?.()
        })
      return {
        start() {
          startTimeout?.()
        },
        cancel() {
          if (t) clearTimeout(t)
          unsub?.()
        },
        promise,
      }
    }

    function diagnosticsWaitStarted(input: { path: string }) {
      const wait = diagnosticsWait(input)
      wait.start()
      return wait.promise
    }

    // Unlocked close: the body of notify.close, factored out so
    // notify.open can reuse it when it needs to evict a stale file
    // entry while already holding the per-path lock. Callers from
    // outside the lock must go through notify.close, which wraps this
    // with withPathLock.
    async function closeUnlocked(input: { path: string; deleted?: boolean; deadline?: number }): Promise<boolean> {
      const normalized = input.path
      if (files[normalized] === undefined) return false
      const deadline = input.deadline ?? Date.now() + 2000
      const notify = async (method: string, params: unknown) => {
        const remaining = deadline - Date.now()
        try {
          if (remaining <= 0) throw new Error("LSP close delivery deadline expired")
          await withTimeout(connection.sendNotification(method, params), remaining)
        } catch (error) {
          // Local buffers can be freed, but uncertain server delivery cannot
          // establish a complete diagnostic inventory until this client restarts.
          incompleteClose = true
          l.warn("LSP close delivery is incomplete", { path: normalized, error })
        }
      }
      if (documentSync.openClose) {
        log.info("textDocument/didClose", { path: normalized })
        await notify("textDocument/didClose", {
          textDocument: {
            uri: pathToFileURL(normalized).href,
          },
        }).catch(() => {
          // Server may be dead or unresponsive. We still want to
          // clean up local state.
        })
      }
      if (input.deleted) {
        noteWorkspaceChange()
        await notify("workspace/didChangeWatchedFiles", {
          changes: [
            {
              uri: pathToFileURL(normalized).href,
              type: 3, // Deleted
            },
          ],
        }).catch(() => {
          // Same policy as didClose: deletion signal is best-effort,
          // local cleanup still wins if the server is already gone.
        })
      }
      delete files[normalized]
      diagnosticTargets.delete(normalized)
      diagnosticWaits.delete(normalized)
      invalidateDiagnostics()
      staleDiagnostics.delete(normalized)
      lastContent.delete(normalized)
      diagnostics.delete(normalized)
      return true
    }

    const result = {
      activity,
      get openPaths() {
        return Object.keys(files)
      },
      get cachedContentBytes() {
        return lastContent.bytes
      },
      root: input.root,
      get serverID() {
        return input.serverID
      },
      get semantic() {
        return input.semantic !== false
      },
      get priority() {
        return input.priority ?? 0
      },
      get capabilityHints() {
        return input.capabilityHints ?? {}
      },
      get runtimeCapabilityHints() {
        return runtimeCapabilityHints
      },
      get closed() {
        return closing || closeNotified
      },
      methodSupport(method: LSPServer.Method): MethodSupport {
        return methodSupport(method, runtimeCapabilityHints, input.capabilityHints)
      },
      get connection() {
        return connection
      },
      notify: {
        async open(input: { path: string; waitForDiagnostics?: boolean }) {
          const normalized = normalizeDocumentPath(input.path)
          const priorDiagnostics = diagnostics.get(normalized)
          // Serialize per-path. Concurrent opens for the same file would
          // otherwise race on the `files[path]` read-modify-write and
          // send duplicate didChange notifications with the same version
          // number. Unrelated paths still run in parallel.
          return withPathLock(normalized, async () => {
            if (incompleteClose)
              throw new Error("LSP document synchronization is incomplete; restart the language server")
            // If a previously-tracked file has disappeared from disk, treat
            // the touch as a close so we don't leak stale entries in files,
            // diagnostics, and lastContent. Caller gets false ("nothing sent
            // to server").
            if (files[normalized] !== undefined) {
              const exists = await Filesystem.exists(normalized)
              if (!exists) {
                // closeUnlocked — we already hold the lock for this path.
                await closeUnlocked({ path: normalized, deleted: true })
                return false
              }
            }
            const text = await Filesystem.readText(normalized)
            const extension = path.extname(normalized).toLowerCase()
            const base = path.basename(normalized).toLowerCase()
            const languageId =
              serverLanguageId ?? LANGUAGE_EXTENSIONS[extension] ?? LANGUAGE_EXTENSIONS[base] ?? "plaintext"

            const version = files[normalized]
            if (version !== undefined) {
              // File previously opened — this would be a didChange. Skip
              // the round-trip entirely if the content is byte-identical to
              // what we already sent; the server's state is already correct.
              if (contentUnchanged(normalized, text)) {
                log.info("textDocument/didChange skipped (unchanged)", {
                  path: normalized,
                  version,
                })
                // Another overlapping open may have completed a current pull
                // while this call waited for the path lock. Reuse only that
                // fresh response; a sequential open still refreshes explicitly.
                if (
                  input.waitForDiagnostics &&
                  (staleDiagnostics.has(normalized) ||
                    !diagnostics.has(normalized) ||
                    diagnostics.get(normalized) === priorDiagnostics)
                )
                  await refreshDiagnostics(normalized)
                return false
              }

              log.info("workspace/didChangeWatchedFiles", { ...input, path: normalized })
              await connection.sendNotification("workspace/didChangeWatchedFiles", {
                changes: [
                  {
                    uri: pathToFileURL(normalized).href,
                    type: 2, // Changed
                  },
                ],
              })
              const sendsTextDocumentNotification = documentSync.change !== 0 || documentSync.save.enabled
              const wait =
                input.waitForDiagnostics && !pullsDiagnostics && sendsTextDocumentNotification
                  ? diagnosticsWait({ path: normalized })
                  : undefined

              const next = version + 1
              files[normalized] = next
              invalidateDiagnostics()
              noteWorkspaceChange()

              try {
                if (reopenChangedDocuments && documentSync.openClose) {
                  log.info("textDocument reopen (native snapshot compatibility)", { path: normalized, version: next })
                  // Queue both frames before yielding so an unrelated request
                  // cannot observe the temporary closed-document state. The
                  // JSON-RPC writer serializes writes in admission order.
                  await Promise.all([
                    connection.sendNotification("textDocument/didClose", {
                      textDocument: { uri: pathToFileURL(normalized).href },
                    }),
                    connection.sendNotification("textDocument/didOpen", {
                      textDocument: { uri: pathToFileURL(normalized).href, languageId, version: next, text },
                    }),
                  ])
                } else if (documentSync.change !== 0) {
                  // Ranged incremental changes are only protocol-legal when
                  // the server negotiated TextDocumentSyncKind.Incremental.
                  // Full servers receive one range-less replacement. Also
                  // fall back to full when the diff is unavailable or
                  // pathological.
                  let contentChanges: Array<
                    | { text: string }
                    | {
                        range: {
                          start: { line: number; character: number }
                          end: { line: number; character: number }
                        }
                        text: string
                      }
                  >
                  const prevText = lastContent.get(normalized)?.text
                  const incremental =
                    documentSync.change === 2 && prevText ? computeIncrementalChanges(prevText, text) : null
                  if (incremental && incremental.length > 0) {
                    contentChanges = incremental
                    log.info("textDocument/didChange (incremental)", {
                      path: normalized,
                      version: next,
                      hunks: incremental.length,
                    })
                  } else {
                    contentChanges = [{ text }]
                    log.info("textDocument/didChange (full)", {
                      path: normalized,
                      version: next,
                    })
                  }
                  await connection.sendNotification("textDocument/didChange", {
                    textDocument: {
                      uri: pathToFileURL(normalized).href,
                      version: next,
                    },
                    contentChanges,
                  })
                }
                if (documentSync.save.enabled) {
                  log.info("textDocument/didSave", { path: normalized, includeText: documentSync.save.includeText })
                  await connection.sendNotification("textDocument/didSave", {
                    textDocument: {
                      uri: pathToFileURL(normalized).href,
                    },
                    ...(documentSync.save.includeText ? { text } : {}),
                  })
                }
              } catch (error) {
                // A failed close/open can leave the server without the document.
                // Retain incomplete coverage until this client is restarted.
                if (reopenChangedDocuments && documentSync.openClose) incompleteClose = true
                wait?.cancel()
                throw error
              }
              wait?.start()
              setLastContent(normalized, text)
              if (input.waitForDiagnostics) await refreshDiagnostics(normalized)
              await wait?.promise
              return true
            }

            log.info("workspace/didChangeWatchedFiles", { ...input, path: normalized })
            await connection.sendNotification("workspace/didChangeWatchedFiles", {
              changes: [
                {
                  uri: pathToFileURL(normalized).href,
                  type: 1, // Created
                },
              ],
            })
            const wait =
              input.waitForDiagnostics && !pullsDiagnostics && documentSync.openClose
                ? diagnosticsWait({ path: normalized })
                : undefined

            diagnostics.delete(normalized)
            if (documentSync.openClose) {
              log.info("textDocument/didOpen", { ...input, path: normalized })
              try {
                await connection.sendNotification("textDocument/didOpen", {
                  textDocument: {
                    uri: pathToFileURL(normalized).href,
                    languageId,
                    version: 0,
                    text,
                  },
                })
              } catch (error) {
                wait?.cancel()
                throw error
              }
            }
            wait?.start()
            files[normalized] = 0
            invalidateDiagnostics()
            setLastContent(normalized, text)
            if (input.waitForDiagnostics) await refreshDiagnostics(normalized)
            await wait?.promise
            return true
          })
        },
        async close(input: { path: string; deleted?: boolean; deadline?: number }) {
          const normalized = normalizeDocumentPath(input.path)
          const deadline = input.deadline ?? Date.now() + 2000
          return withPathLock(
            normalized,
            () => closeUnlocked({ path: normalized, deleted: input.deleted, deadline }),
            deadline,
          )
        },
      },
      get diagnostics() {
        return diagnostics
      },
      get diagnosticsDegraded() {
        return incompleteClose || staleDiagnostics.size > 0
      },
      diagnosticsStale(filePath: string) {
        return incompleteClose || staleDiagnostics.has(normalizeDocumentPath(filePath))
      },
      async refreshDiagnosticInventory() {
        if (incompleteClose) throw new Error("LSP diagnostic inventory is incomplete after failed document cleanup")
        if (!pullsDiagnostics) return
        if (Object.keys(files).length > MAX_CACHED_DIAGNOSTICS)
          throw new Error("Native diagnostic inventory exceeds the collection limit")
        const deadline = Date.now() + 15_000
        // didChange, didSave, and watched-file events can produce separate
        // refresh requests. Let that burst settle, then retry a bounded number
        // of snapshots instead of presenting the transient empty inventory.
        for (let pass = 0; pass < 3 && !closing && Date.now() < deadline; pass++) {
          if (staleDiagnostics.size === 0) return
          await new Promise<void>((resolve) => setTimeout(resolve, Math.min(50, deadline - Date.now())))
          for (const filePath of Object.keys(files)) {
            if (!staleDiagnostics.has(filePath)) continue
            if (closing || Date.now() >= deadline) break
            await withPathLock(
              filePath,
              async () => {
                if (staleDiagnostics.has(filePath))
                  await refreshDiagnostics(filePath, Math.max(1, deadline - Date.now()))
              },
              deadline,
            )
          }
          if (staleDiagnostics.size === 0 && !closing) return
        }
        throw new Error("Native diagnostic inventory is incomplete; retry after the workspace settles")
      },
      async waitForDiagnostics(input: { path: string }) {
        const normalizedPath = normalizeDocumentPath(input.path)
        if (pullsDiagnostics) {
          const existing = diagnosticWaits.get(normalizedPath)
          if (existing?.generation === diagnosticGeneration) return existing.promise
          // Share only overlapping waits within this workspace generation.
          // Sequential explicit requests still ask the server for fresh results.
          const entry = {
            generation: diagnosticGeneration,
            promise: withPathLock(normalizedPath, async () => {
              await refreshDiagnostics(normalizedPath)
              if (closing || files[normalizedPath] === undefined || staleDiagnostics.has(normalizedPath)) {
                throw new Error("Native diagnostics are incomplete; retry after the workspace settles")
              }
            }),
          }
          diagnosticWaits.set(normalizedPath, entry)
          try {
            await entry.promise
          } finally {
            if (diagnosticWaits.get(normalizedPath) === entry) diagnosticWaits.delete(normalizedPath)
          }
          return
        }
        return await activity.run(() => diagnosticsWaitStarted({ path: normalizedPath }))
      },
      // Liveness check. Uses signal 0 (kill -0), which doesn't actually
      // send a signal — it just asks the kernel whether the process still
      // exists. Cheap, synchronous, no LSP traffic, no dependency on the
      // server answering requests. Catches the crashed/exited case;
      // doesn't catch the "alive but not reading stdin" case, which would
      // need a real RPC roundtrip with a short timeout.
      ping(): boolean {
        const proc = input.server.process
        if (proc.killed || proc.exitCode !== null || proc.signalCode !== null) return false
        const pid = proc.pid
        if (typeof pid !== "number") return false
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      },
      async shutdown() {
        l.info("shutting down")
        closing = true
        if (refreshTimer) clearTimeout(refreshTimer)
        diagnosticTargets.clear()
        diagnosticWaits.clear()
        lastContent.clear()
        diagnostics.clear()
        // Wrap end() and dispose() so a broken-stream throw from
        // either one cannot prevent us from reaching process kill.
        // Without this, a crashed LSP server leaves its child process
        // as an orphan because connection.end() throws before the
        // final kill step runs.
        try {
          connection.end()
        } catch (err) {
          l.warn("connection.end threw during shutdown", { err })
        }
        try {
          connection.dispose()
        } catch (err) {
          l.warn("connection.dispose threw during shutdown", { err })
        }
        await codeIntelHost()
          .killTree(input.server.process, {
            exited: () => input.server.process.exitCode !== null || input.server.process.signalCode !== null,
          })
          .catch((error) => {
            l.warn("lsp shutdown kill failed", { error })
          })
        l.info("shutdown")
      },
    }

    l.info("initialized")

    return result
  }
}
