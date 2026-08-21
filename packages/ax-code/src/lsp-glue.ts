// Core glue for @ax-code/ax-codeintel.
//
// Wires the ax-code runtime (project instance, global paths, flags, config,
// shell, bus, graph-backed LSP cache) into the package's host port. Importing
// this module configures the package; all host members are lazy getters, so
// the import itself is side-effect free beyond registration.
//
// The two LSP bus events are (re)defined here through BusEvent.define so they
// stay registered in the core event registry and keep appearing in the
// SSE/OpenAPI event contract now that their shapes live in the package.

import z from "zod"
import { configureCodeIntelHost, type LspCacheOperation } from "@ax-code/ax-codeintel/host"
import { Log as PackageLog } from "@ax-code/ax-codeintel/internal/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { LSPCache } from "@/code-intelligence/lsp-cache"
import type { LspCacheOperation as CoreLspCacheOperation } from "@/code-intelligence/schema.sql"
import { FileWatcher } from "@/file/watcher"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Ripgrep } from "@/file/ripgrep"
import { Shell } from "@/shell/shell"
import { BunProc } from "@/bun"
import { NpmManager, packageManagerKind, toolRunner } from "@/bun/package-manager"
import { Log } from "@/util/log"

export const LspEvent = {
  Updated: BusEvent.define("lsp.updated", z.object({})),
  ClientDiagnostics: BusEvent.define(
    "lsp.client.diagnostics",
    z.object({
      serverID: z.string(),
      path: z.string(),
    }),
  ),
}

// Route package log output into the core log stack.
const loggerCache = new Map<string, ReturnType<typeof Log.create>>()
PackageLog.setSink((level, service, message, extra) => {
  let logger = loggerCache.get(service)
  if (!logger) {
    logger = Log.create({ service })
    loggerCache.set(service, logger)
  }
  logger[level](message, extra)
})

configureCodeIntelHost({
  projectRoot: () => Instance.directory,
  worktreeRoot: () => Instance.worktree,
  binDir: () => Global.Path.bin,
  homeDir: () => Global.Path.home,
  flags: () => ({
    disableLspDownload: Flag.AX_CODE_DISABLE_LSP_DOWNLOAD,
    experimentalLspTy: Flag.AX_CODE_EXPERIMENTAL_LSP_TY,
  }),
  lspConfig: async () => {
    const cfg = await Config.get()
    return { lsp: cfg.lsp }
  },
  runtime: {
    executable: () => BunProc.which(),
    kind: () => (packageManagerKind() === "npm" ? "node" : "bun"),
    npmExecutable: () => NpmManager.executable,
    toolRunner: () => toolRunner({ bunExecutable: BunProc.which() }),
  },
  killTree: (proc, opts) => Shell.killTree(proc, opts),
  listFiles: (input) => Ripgrep.files(input),
  subscribeRootMarkerChange: (callback) =>
    Bus.subscribe(FileWatcher.Event.Updated, (event) => {
      callback(event.properties.file)
    }),
  publishUpdated: () => Bus.publishDetached(LspEvent.Updated, {}),
  publishClientDiagnostics: (payload) => Bus.publishDetached(LspEvent.ClientDiagnostics, payload),
  cacheStore: {
    enabled: (override) => LSPCache.enabled(override),
    hashFile: (file) => LSPCache.hashFile(file),
    lookup: (input) =>
      LSPCache.lookup({
        ...input,
        operation: input.operation as CoreLspCacheOperation,
      }),
    write: (input) =>
      LSPCache.write({
        ...input,
        operation: input.operation as CoreLspCacheOperation,
      }),
  },
  state: (init, dispose) => Instance.state(init, dispose),
})

export type LspGlueOperation = LspCacheOperation
