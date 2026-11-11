import path from "node:path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"

const CONTROL_FILE_MODE = 0o600

// Kimi Code's headless `-p` mode cannot use `--plan`, `--yolo`, or `--auto`, so
// it has no permission-mode flag for AX Code to map. `--agent-file <path>`
// loads an agent definition whose frontmatter `tools:` list is an exact,
// case-sensitive allowlist; a Read/Glob/Grep-only agent makes the run
// read-only. AX Code publishes the definition into its cache directory and
// passes it on every read-only launch (see `ensureKimiReadOnlyAgentFile`).
export const KIMI_READ_ONLY_AGENT = [
  "---",
  "name: ax-code-read-only",
  "description: Read-only agent used by AX Code's read-only isolation mode.",
  "tools: [Read, Glob, Grep]",
  "---",
  "You are a coding assistant working in read-only mode: read and search files to answer; you cannot modify files or run commands.",
  "",
].join("\n")

export function kimiReadOnlyAgentPath(): string {
  const file = path.join(Global.Path.cache, "kimi-read-only-agent.md")
  if (!Filesystem.contains(Global.Path.cache, file))
    throw new Error("CLI control file must stay inside its cache directory")
  return file
}

/** Write the read-only agent definition before spawning Kimi; returns its path. */
export async function ensureKimiReadOnlyAgentFile(): Promise<string> {
  const file = kimiReadOnlyAgentPath()
  // Always publish atomically: matching content must not preserve a symlink or
  // permissions that let another process modify the isolation/privacy policy.
  await Filesystem.write(file, KIMI_READ_ONLY_AGENT, CONTROL_FILE_MODE)
  return file
}
