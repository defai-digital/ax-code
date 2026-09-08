import { APICallError } from "@ai-sdk/provider"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Log } from "@/util/log"
import { toErrorMessage } from "@/util/error-message"

const log = Log.create({ service: "provider.cli-prompt" })

export function assertCliCommandSize(cmd: string[], providerID: string, platform = process.platform) {
  // Conservative budgets, not exact OS limits. Windows may launch a .cmd
  // shim through cmd.exe (8,191 characters); reserve room for its wrapper and
  // double-escaped metacharacters. Unix also has per-argument byte limits.
  const limit = platform === "win32" ? 8_000 : 64 * 1024
  const size = cmd.reduce((total, arg) => {
    if (platform !== "win32") return total + Buffer.byteLength(arg, "utf8") + 1
    const escaped = arg.match(/[\s\\"()[\]%!^<>&|;,=*?\x60]/g)?.length ?? 0
    const quotes = arg.match(/"/g)?.length ?? 0
    // Embedded quotes also need a backslash; the two wrapper quotes are
    // themselves escaped twice (eight characters), followed by a separator.
    return total + arg.length + 3 * escaped + quotes + 9
  }, 0)
  if (size <= limit) return
  throw new APICallError({
    message:
      `${providerID} CLI command line exceeds AX Code's safe process argument budget. ` +
      "Select codex-cli, claude-code, or grok-build-cli for large prompts, or reduce the session context. " +
      "This request was not sent to the CLI and will not be retried automatically.",
    url: `cli:${providerID}`,
    requestBodyValues: undefined,
    isRetryable: false,
  })
}

export async function materializeCliPrompt(text: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "ax-code-cli-prompt-"))
  const file = path.join(directory, "prompt.txt")
  const cleanup = async () => {
    await rm(directory, { recursive: true, force: true }).catch((error) => {
      log.warn("failed to remove CLI prompt file", { error: toErrorMessage(error) })
    })
  }
  try {
    await writeFile(file, text, { encoding: "utf8", mode: 0o600, flag: "wx" })
    return { file, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
