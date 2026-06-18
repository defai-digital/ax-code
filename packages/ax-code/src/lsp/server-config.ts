import { Flag } from "@/flag/flag"
import { isNonEmptyRecord } from "@/util/record"
import type { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Env } from "../util/env"
import { Log } from "../util/log"
import { spawn as lspspawn } from "./launch"
import { LSPServer } from "./server"
import { BuiltinServerProfiles } from "./server-profile"

export namespace LSPServerConfig {
  const log = Log.create({ service: "lsp.config" })

  export function mergeCapabilityHints(
    ...hints: Array<LSPServer.CapabilityHints | undefined>
  ): LSPServer.CapabilityHints | undefined {
    const merged: LSPServer.CapabilityHints = {}
    for (const hint of hints) {
      if (!hint) continue
      Object.assign(merged, hint)
    }
    return isNonEmptyRecord(merged) ? merged : undefined
  }

  function filterExperimentalServers(servers: Record<string, LSPServer.Info>) {
    if (Flag.AX_CODE_EXPERIMENTAL_LSP_TY) {
      if (servers["pyright"]) {
        log.info("LSP server pyright is disabled because AX_CODE_EXPERIMENTAL_LSP_TY is enabled")
        delete servers["pyright"]
      }
    } else if (servers["ty"]) {
      delete servers["ty"]
    }
  }

  export function buildEnabledServers(cfg: Pick<Config.Info, "lsp">): Record<string, LSPServer.Info> {
    const servers: Record<string, LSPServer.Info> = {}

    if (cfg.lsp === false) return servers

    for (const server of Object.values(LSPServer)) {
      const profile = BuiltinServerProfiles[server.id]
      servers[server.id] = {
        ...server,
        semantic: server.semantic ?? profile?.semantic ?? true,
        priority: server.priority ?? profile?.priority ?? 0,
        concurrency: server.concurrency ?? profile?.concurrency,
        languageId: server.languageId,
        capabilityHints: mergeCapabilityHints(profile?.capabilityHints, server.capabilityHints),
      }
    }

    filterExperimentalServers(servers)

    for (const [name, item] of Object.entries(cfg.lsp ?? {})) {
      const existing = servers[name]
      if (item.disabled) {
        log.info(`LSP server ${name} is disabled`)
        delete servers[name]
        continue
      }

      servers[name] = {
        ...existing,
        id: name,
        semantic: item.semantic ?? existing?.semantic ?? true,
        priority: item.priority ?? existing?.priority ?? 0,
        concurrency: item.concurrency ?? existing?.concurrency,
        languageId: item.languageId ?? existing?.languageId,
        capabilityHints: mergeCapabilityHints(existing?.capabilityHints, item.capabilities),
        root: existing?.root ?? (async () => Instance.directory),
        extensions: item.extensions ?? existing?.extensions ?? [],
        spawn: async (root) => {
          if (item.command) {
            return {
              process: lspspawn(item.command[0], item.command.slice(1), {
                cwd: root,
                env: {
                  ...Env.sanitize(),
                  ...item.env,
                },
              }),
              initialization: item.initialization,
            }
          }

          if (!existing?.spawn) return undefined
          const handle = await existing.spawn(root)
          if (!handle) return handle
          if (!item.initialization) return handle
          return {
            ...handle,
            initialization: {
              ...(handle.initialization ?? {}),
              ...item.initialization,
            },
          }
        },
      }
    }

    return servers
  }
}
