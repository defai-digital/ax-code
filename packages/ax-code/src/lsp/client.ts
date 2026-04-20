import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types"
import { diffLines } from "diff"
import { Log } from "../util/log"
import { Process } from "../util/process"
import { LANGUAGE_EXTENSIONS } from "./language"
import z from "zod"
import type { LSPServer } from "./server"
import { NamedError } from "@ax-code/util/error"
import { withTimeout } from "../util/timeout"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

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
export const MAX_INCREMENTAL_SYNC_BYTES = 1_000_000

// If the incremental change list would contain more than this many hunks, the
// diff is pathological (e.g. random shuffles). Fall back to full sync so we
// don't ship an enormous payload of small ranges.
export const MAX_INCREMENTAL_HUNKS = 256

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
    let addedText = ""
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      const p = parts[i]
      if (p.removed) removedLines += p.count ?? 0
      if (p.added) addedText += p.value
      i++
    }
    const hunkEndLine = hunkStartLine + removedLines
    changes.push({
      range: {
        start: { line: hunkStartLine, character: 0 },
        end: { line: hunkEndLine, character: 0 },
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

export namespace LSPClient {
  const log = Log.create({ service: "lsp.client" })

  export type Info = NonNullable<Awaited<ReturnType<typeof create>>>

  export type Diagnostic = VSCodeDiagnostic

  export type MethodSupport = "supported" | "unsupported" | "unknown"

  export const InitializeError = NamedError.create(
    "LSPInitializeError",
    z.object({
      serverID: z.string(),
    }),
  )

  export const Event = {
    Diagnostics: BusEvent.define(
      "lsp.client.diagnostics",
      z.object({
        serverID: z.string(),
        path: z.string(),
      }),
    ),
  }

  function capabilityEnabled(value: unknown): boolean {
    return value !== undefined && value !== null && value !== false
  }

  export function capabilityHintsFromInitializeForTest(capabilities: Record<string, unknown> | undefined): LSPServer.CapabilityHints {
    if (!capabilities) return {}
    const hints: LSPServer.CapabilityHints = {}

    if ("hoverProvider" in capabilities) hints.hover = capabilityEnabled(capabilities.hoverProvider)
    if ("definitionProvider" in capabilities) hints.definition = capabilityEnabled(capabilities.definitionProvider)
    if ("referencesProvider" in capabilities) hints.references = capabilityEnabled(capabilities.referencesProvider)
    if ("implementationProvider" in capabilities) hints.implementation = capabilityEnabled(capabilities.implementationProvider)
    if ("documentSymbolProvider" in capabilities) hints.documentSymbol = capabilityEnabled(capabilities.documentSymbolProvider)
    if ("workspaceSymbolProvider" in capabilities) hints.workspaceSymbol = capabilityEnabled(capabilities.workspaceSymbolProvider)
    if ("callHierarchyProvider" in capabilities) hints.callHierarchy = capabilityEnabled(capabilities.callHierarchyProvider)

    return hints
  }

  export function methodSupportForTest(
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
    semantic?: boolean
    priority?: number
    capabilityHints?: LSPServer.CapabilityHints
  }) {
    const l = log.clone().tag("serverID", input.serverID)
    l.info("starting client")

    const connection = createMessageConnection(
      new StreamMessageReader(input.server.process.stdout as any),
      new StreamMessageWriter(input.server.process.stdin as any),
    )

    const diagnostics = new Map<string, Diagnostic[]>()

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

    connection.onNotification("textDocument/publishDiagnostics", (params) => {
      const filePath = Filesystem.normalizePath(fileURLToPath(params.uri))
      l.info("textDocument/publishDiagnostics", {
        path: filePath,
        count: params.diagnostics.length,
      })
      const exists = diagnostics.has(filePath)
      setDiagnostics(filePath, params.diagnostics)
      if (!exists && input.serverID === "typescript") return
      Bus.publish(Event.Diagnostics, { path: filePath, serverID: input.serverID })
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
        processId: input.server.process.pid,
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
            didChangeWatchedFiles: {
              dynamicRegistration: true,
            },
          },
          textDocument: {
            synchronization: {
              didOpen: true,
              didChange: true,
            },
            publishDiagnostics: {
              versionSupport: true,
            },
          },
        },
      }) as Promise<{ capabilities?: Record<string, unknown> }>,
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

    const runtimeCapabilityHints = capabilityHintsFromInitializeForTest(initializeResult?.capabilities)

    await connection.sendNotification("initialized", {})

    if (input.server.initialization) {
      await connection.sendNotification("workspace/didChangeConfiguration", {
        settings: input.server.initialization,
      })
    }

    const files: {
      [path: string]: number
    } = {}

    // Per-path promise chain so concurrent notify.open/notify.close for
    // the same file serialize. Without this, two parallel notify.open
    // calls both read `files[path]` BEFORE either writes back, both
    // compute the same `next` version number, and both send duplicate
    // didChange notifications with the same version — which confuses
    // LSP servers that require strictly monotonic versions.
    //
    // The chain pattern: each call appends its work to the tail. The
    // stored promise always resolves (errors are swallowed in the
    // chain) so a thrown fn() does not break the lock for later
    // waiters. The Map entry is overwritten on every call so it never
    // grows beyond the number of distinct in-flight paths.
    const pathLocks: Map<string, Promise<void>> = new Map()
    async function withPathLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
      const prev = pathLocks.get(filepath) ?? Promise.resolve()
      let resolveNext!: () => void
      const nextTail = new Promise<void>((resolve) => {
        resolveNext = resolve
      })
      // Chain the new tail after the previous one. Callers awaiting on
      // `prev` will see it resolve before nextTail starts.
      pathLocks.set(
        filepath,
        prev.then(() => nextTail),
      )
      try {
        await prev
        return await fn()
      } finally {
        resolveNext()
        if (pathLocks.get(filepath) === nextTail) {
          pathLocks.delete(filepath)
        }
      }
    }

    // Per-file snapshot of the last text we sent to the server, used both
    // for the hash-skip path (quick equality check) and for computing
    // incremental diffs on the next didChange. We keep the full text rather
    // than just a fingerprint so we can reproduce the server's notion of
    // the document and diff against it line-by-line.
    //
    // Memory budget: text is held only for files the server has open. The
    // diagnostics LRU cap and notify.close cleanup bound this indirectly.
    const lastContent: {
      [path: string]: { hash: string; length: number; text: string }
    } = {}

    function contentFingerprint(text: string) {
      return { hash: Bun.hash(text).toString(), length: text.length, text }
    }

    function contentUnchanged(filePath: string, text: string) {
      const prev = lastContent[filePath]
      if (!prev) return false
      if (prev.length !== text.length) return false
      return prev.hash === Bun.hash(text).toString()
    }


    function diagnosticsWait(input: { path: string }) {
      log.info("waiting for diagnostics", { path: input.path })
      let unsub: (() => void) | undefined
      let t: ReturnType<typeof setTimeout> | undefined
      return withTimeout(
        new Promise<void>((resolve) => {
          unsub = Bus.subscribe(Event.Diagnostics, (event) => {
            if (event.properties.path === input.path && event.properties.serverID === result.serverID) {
              if (t) clearTimeout(t)
              t = setTimeout(() => {
                log.info("got diagnostics", { path: input.path })
                unsub?.()
                resolve()
              }, DIAGNOSTICS_DEBOUNCE_MS)
            }
          })
        }),
        3000,
      )
        .catch(() => {})
        .finally(() => {
          if (t) clearTimeout(t)
          unsub?.()
        })
    }

    // Unlocked close: the body of notify.close, factored out so
    // notify.open can reuse it when it needs to evict a stale file
    // entry while already holding the per-path lock. Callers from
    // outside the lock must go through notify.close, which wraps this
    // with withPathLock.
    async function closeUnlocked(input: { path: string; deleted?: boolean }): Promise<boolean> {
      const normalized = input.path
      if (files[normalized] === undefined) return false
      log.info("textDocument/didClose", { path: normalized })
      await connection
        .sendNotification("textDocument/didClose", {
          textDocument: {
            uri: pathToFileURL(normalized).href,
          },
        })
        .catch(() => {
          // Server may be dead or unresponsive. We still want to
          // clean up local state.
        })
      if (input.deleted) {
        await connection
          .sendNotification("workspace/didChangeWatchedFiles", {
            changes: [
              {
                uri: pathToFileURL(normalized).href,
                type: 3, // Deleted
              },
            ],
          })
          .catch(() => {
            // Same policy as didClose: deletion signal is best-effort,
            // local cleanup still wins if the server is already gone.
          })
      }
      delete files[normalized]
      delete lastContent[normalized]
      diagnostics.delete(normalized)
      return true
    }

    const result = {
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
      methodSupport(method: LSPServer.Method): MethodSupport {
        return methodSupportForTest(method, runtimeCapabilityHints, input.capabilityHints)
      },
      get connection() {
        return connection
      },
      notify: {
        async open(input: { path: string; waitForDiagnostics?: boolean }) {
          input.path = path.isAbsolute(input.path) ? input.path : path.resolve(Instance.directory, input.path)
          // Serialize per-path. Concurrent opens for the same file would
          // otherwise race on the `files[path]` read-modify-write and
          // send duplicate didChange notifications with the same version
          // number. Unrelated paths still run in parallel.
          return withPathLock(input.path, async () => {
          // If a previously-tracked file has disappeared from disk, treat
          // the touch as a close so we don't leak stale entries in files,
          // diagnostics, and lastContent. Caller gets false ("nothing sent
          // to server").
          if (files[input.path] !== undefined) {
            const exists = await Bun.file(input.path)
              .exists()
              .catch(() => false)
            if (!exists) {
              // closeUnlocked — we already hold the lock for this path.
              await closeUnlocked({ path: input.path, deleted: true })
              return false
            }
          }
          const text = await Filesystem.readText(input.path)
          const extension = path.extname(input.path)
          const languageId = LANGUAGE_EXTENSIONS[extension] ?? "plaintext"

          const version = files[input.path]
          if (version !== undefined) {
            // File previously opened — this would be a didChange. Skip
            // the round-trip entirely if the content is byte-identical to
            // what we already sent; the server's state is already correct.
            if (contentUnchanged(input.path, text)) {
              log.info("textDocument/didChange skipped (unchanged)", {
                path: input.path,
                version,
              })
              return false
            }

            log.info("workspace/didChangeWatchedFiles", input)
            const wait = input.waitForDiagnostics ? diagnosticsWait({ path: input.path }) : undefined
            await connection.sendNotification("workspace/didChangeWatchedFiles", {
              changes: [
                {
                  uri: pathToFileURL(input.path).href,
                  type: 2, // Changed
                },
              ],
            })

            const next = version + 1
            files[input.path] = next

            // Try incremental sync first. If we have the previously-sent
            // text cached and computeIncrementalChanges produces a reasonable
            // hunk list, send ranges. Otherwise fall back to full-document
            // sync — which works on every server regardless of their
            // declared sync kind, since LSP treats a range-less change as
            // "replace the whole document".
            let contentChanges: Array<
              | { text: string }
              | {
                  range: { start: { line: number; character: number }; end: { line: number; character: number } }
                  text: string
                }
            >
            const prevText = lastContent[input.path]?.text
            const incremental = prevText ? computeIncrementalChanges(prevText, text) : null
            if (incremental && incremental.length > 0) {
              contentChanges = incremental
              log.info("textDocument/didChange (incremental)", {
                path: input.path,
                version: next,
                hunks: incremental.length,
              })
            } else {
              contentChanges = [{ text }]
              log.info("textDocument/didChange (full)", {
                path: input.path,
                version: next,
              })
            }
            await connection.sendNotification("textDocument/didChange", {
              textDocument: {
                uri: pathToFileURL(input.path).href,
                version: next,
              },
              contentChanges,
            })
            lastContent[input.path] = contentFingerprint(text)
            await wait
            return true
          }

          log.info("workspace/didChangeWatchedFiles", input)
          const wait = input.waitForDiagnostics ? diagnosticsWait({ path: input.path }) : undefined
          await connection.sendNotification("workspace/didChangeWatchedFiles", {
            changes: [
              {
                uri: pathToFileURL(input.path).href,
                type: 1, // Created
              },
            ],
          })

          log.info("textDocument/didOpen", input)
          diagnostics.delete(input.path)
          await connection.sendNotification("textDocument/didOpen", {
            textDocument: {
              uri: pathToFileURL(input.path).href,
              languageId,
              version: 0,
              text,
            },
          })
          files[input.path] = 0
          lastContent[input.path] = contentFingerprint(text)
          await wait
          return true
          })
        },
        async close(input: { path: string; deleted?: boolean }) {
          const normalized = path.isAbsolute(input.path)
            ? input.path
            : path.resolve(Instance.directory, input.path)
          return withPathLock(normalized, () => closeUnlocked({ path: normalized, deleted: input.deleted }))
        },
      },
      get diagnostics() {
        return diagnostics
      },
      async waitForDiagnostics(input: { path: string }) {
        const normalizedPath = Filesystem.normalizePath(
          path.isAbsolute(input.path) ? input.path : path.resolve(Instance.directory, input.path),
        )
        return await diagnosticsWait({ path: normalizedPath })
      },
      // Liveness check. Uses signal 0 (kill -0), which doesn't actually
      // send a signal — it just asks the kernel whether the process still
      // exists. Cheap, synchronous, no LSP traffic, no dependency on the
      // server answering requests. Catches the crashed/exited case;
      // doesn't catch the "alive but not reading stdin" case, which would
      // need a real RPC roundtrip with a short timeout.
      ping(): boolean {
        const pid = input.server.process.pid
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
        // Wrap end() and dispose() so a broken-stream throw from
        // either one cannot prevent us from reaching Process.stop().
        // Without this, a crashed LSP server leaves its child process
        // as an orphan because connection.end() throws before the
        // kill runs.
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
        await Process.stop(input.server.process)
        l.info("shutdown")
      },
    }

    l.info("initialized")

    return result
  }
}
