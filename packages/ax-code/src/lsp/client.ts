import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types"
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

export namespace LSPClient {
  const log = Log.create({ service: "lsp.client" })

  export type Info = NonNullable<Awaited<ReturnType<typeof create>>>

  export type Diagnostic = VSCodeDiagnostic

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

  export async function create(input: { serverID: string; server: LSPServer.Handle; root: string }) {
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
    await withTimeout(
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
      }),
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

    await connection.sendNotification("initialized", {})

    if (input.server.initialization) {
      await connection.sendNotification("workspace/didChangeConfiguration", {
        settings: input.server.initialization,
      })
    }

    const files: {
      [path: string]: number
    } = {}

    // Per-file content fingerprint of the last text we sent to the server.
    // Used to skip redundant didChange notifications when touchFile() is
    // called repeatedly with no actual disk change. Non-cryptographic hash
    // — we're deduplicating, not signing. We compare both the length and
    // the hash to make accidental collisions astronomically unlikely.
    const lastContent: {
      [path: string]: { hash: string; length: number }
    } = {}

    function contentFingerprint(text: string) {
      return { hash: Bun.hash(text).toString(), length: text.length }
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

    const result = {
      root: input.root,
      get serverID() {
        return input.serverID
      },
      get connection() {
        return connection
      },
      notify: {
        async open(input: { path: string; waitForDiagnostics?: boolean }) {
          input.path = path.isAbsolute(input.path) ? input.path : path.resolve(Instance.directory, input.path)
          // If a previously-tracked file has disappeared from disk, treat
          // the touch as a close so we don't leak stale entries in files,
          // diagnostics, and lastContent. Caller gets false ("nothing sent
          // to server").
          if (files[input.path] !== undefined) {
            const exists = await Bun.file(input.path)
              .exists()
              .catch(() => false)
            if (!exists) {
              await result.notify.close({ path: input.path })
              return false
            }
          }
          const text = await Filesystem.readText(input.path)
          const extension = path.extname(input.path)
          const languageId = LANGUAGE_EXTENSIONS[extension] ?? "plaintext"
          const wait = input.waitForDiagnostics ? diagnosticsWait({ path: input.path }) : undefined

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
            log.info("textDocument/didChange", {
              path: input.path,
              version: next,
            })
            await connection.sendNotification("textDocument/didChange", {
              textDocument: {
                uri: pathToFileURL(input.path).href,
                version: next,
              },
              contentChanges: [{ text }],
            })
            lastContent[input.path] = contentFingerprint(text)
            await wait
            return true
          }

          log.info("workspace/didChangeWatchedFiles", input)
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
        },
        async close(input: { path: string }) {
          const normalized = path.isAbsolute(input.path)
            ? input.path
            : path.resolve(Instance.directory, input.path)
          // Never-opened files are a no-op. If the file wasn't in our
          // `files` map it was never handed to this server.
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
          delete files[normalized]
          delete lastContent[normalized]
          diagnostics.delete(normalized)
          return true
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
      async shutdown() {
        l.info("shutting down")
        connection.end()
        connection.dispose()
        await Process.stop(input.server.process)
        l.info("shutdown")
      },
    }

    l.info("initialized")

    return result
  }
}
