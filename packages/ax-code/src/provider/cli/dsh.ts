import path from "node:path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"

const CONTROL_FILE_MODE = 0o600

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
  const file = path.join(Global.Path.cache, "dsh-privacy.patch.yml")
  if (!Filesystem.contains(Global.Path.cache, file))
    throw new Error("CLI control file must stay inside its cache directory")
  return file
}

/** Launcher flags that must precede `--profile`; dsh rejects them after it. */
export function dshLauncherArgs(): string[] {
  return ["--patch", dshPrivacyPatchPath()]
}

/** Write the privacy overlay before spawning dsh; a missing patch file fails the launch. */
export async function ensureDshPrivacyPatch(): Promise<void> {
  const file = dshPrivacyPatchPath()
  // Always publish atomically: matching content must not preserve a symlink or
  // permissions that let another process modify the isolation/privacy policy.
  await Filesystem.write(file, DSH_PRIVACY_PATCH, CONTROL_FILE_MODE)
}
