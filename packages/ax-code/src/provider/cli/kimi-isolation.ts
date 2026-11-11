import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"

// Kimi Code's headless `-p` mode cannot use `--plan`, `--yolo`, or `--auto`, so
// it has no permission-mode flag for AX Code to map. `--agent-file <path>`
// loads an agent definition whose frontmatter `tools:` list is an exact,
// case-sensitive allowlist; a Read/Glob/Grep-only agent makes the run
// read-only. AX Code writes the definition once into its cache directory and
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
  return path.join(Global.Path.cache, "kimi-read-only-agent.md")
}

/** Write the read-only agent definition before spawning Kimi; returns its path. */
export async function ensureKimiReadOnlyAgentFile(): Promise<string> {
  const file = kimiReadOnlyAgentPath()
  const current = await fs.readFile(file, "utf8").catch(() => undefined)
  if (current === KIMI_READ_ONLY_AGENT) return file
  await Filesystem.write(file, KIMI_READ_ONLY_AGENT, 0o600)
  return file
}
