import { text } from "node:stream/consumers"
import { withTimeout } from "../util/timeout"
import { spawn } from "./launch"
import { log } from "./server-helpers"

const LSP_SUPPORT_CACHE_MAX = 64
const lspSupportCache = new Map<string, boolean | Promise<boolean>>()

function setSupportCache(lintBin: string, value: boolean | Promise<boolean>) {
  if (lspSupportCache.has(lintBin)) {
    lspSupportCache.delete(lintBin)
  }
  lspSupportCache.set(lintBin, value)
  while (lspSupportCache.size > LSP_SUPPORT_CACHE_MAX) {
    const oldest = lspSupportCache.keys().next().value
    if (!oldest) break
    lspSupportCache.delete(oldest)
  }
}

async function checkSupportsLsp(lintBin: string): Promise<boolean> {
  let help = ""
  let proc: ReturnType<typeof spawn> | undefined
  try {
    proc = spawn(lintBin, ["--help"])
    const helpPromise = proc.stdout ? text(proc.stdout) : Promise.resolve("")
    ;[help] = await withTimeout(
      Promise.all([helpPromise, proc.exited]),
      5_000,
      `oxlint --help timed out for ${lintBin}`,
    )
  } catch (error) {
    if (proc) {
      proc.kill()
      await withTimeout(proc.exited, 500, `oxlint process cleanup timed out`).catch(() => {})
    }
    log.warn("oxlint --help check failed", { lintBin, error })
    lspSupportCache.delete(lintBin)
    return false
  }

  const supports = help.includes("--lsp")
  setSupportCache(lintBin, supports)
  return supports
}

export namespace OxlintSupport {
  export async function supportsLsp(lintBin: string): Promise<boolean> {
    const cached = lspSupportCache.get(lintBin)
    if (typeof cached === "boolean") return cached
    if (cached) return cached

    const pending = Promise.resolve().then(() => checkSupportsLsp(lintBin))
    setSupportCache(lintBin, pending)
    return pending
  }
}
