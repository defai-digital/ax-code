import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"

// DeepSeek Harness (`dsh`) uploads complete session logs with DeepSeek API
// requests and sends OTel session telemetry by default. AX Code passes this
// launcher overlay on every headless run so a bridged session never leaves
// the machine through those channels. The rows are the dsh plugin ids shown
// by `dsh --profile headless --dump-config`.
export const DSH_PRIVACY_PATCH = [
  "# Written by AX Code. Disables DeepSeek Harness session-log upload and OTel",
  "# session telemetry for headless runs bridged through AX Code.",
  "- id: session-log-deepseek",
  "  disabled: true",
  "- id: session-telemetry-otel",
  "  disabled: true",
  "",
].join("\n")

export function dshPrivacyPatchPath(): string {
  return path.join(Global.Path.cache, "dsh-privacy.patch.yml")
}

/** Launcher flags that must precede `--profile`; dsh rejects them after it. */
export function dshLauncherArgs(): string[] {
  return ["--patch", dshPrivacyPatchPath()]
}

/** Write the privacy overlay before spawning dsh; a missing patch file fails the launch. */
export async function ensureDshPrivacyPatch(): Promise<void> {
  const file = dshPrivacyPatchPath()
  const current = await fs.readFile(file, "utf8").catch(() => undefined)
  if (current === DSH_PRIVACY_PATCH) return
  await Filesystem.write(file, DSH_PRIVACY_PATCH, 0o600)
}
