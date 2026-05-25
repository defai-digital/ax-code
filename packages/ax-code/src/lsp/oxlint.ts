import { text } from "node:stream/consumers"
import { spawn } from "./launch"
import { log } from "./server-helpers"
import { Process } from "../util/process"

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
    proc = spawn(lintBin, ["--help"], { timeout: 5_000 })
    const helpPromise = proc.stdout ? text(proc.stdout) : Promise.resolve("")
    const output = await Promise.all([helpPromise, proc.exited, proc.stderr ? text(proc.stderr) : Promise.resolve("")])
    const [helpText, exitCode] = output
    help = helpText
    if (exitCode === 124) {
      throw new Error(`oxlint --help timed out for ${lintBin}`)
    }
  } catch (error) {
    if (proc) {
      await Process.stop(proc).catch(() => {})
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
