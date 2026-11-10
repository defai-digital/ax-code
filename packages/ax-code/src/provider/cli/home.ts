import { homedir } from "node:os"
import { join } from "node:path"

export function codexHome() {
  const testHome = process.env.AX_CODE_TEST_HOME
  if (testHome) return { path: join(testHome, ".codex"), source: "~/.codex" }
  const home = process.env.CODEX_HOME?.trim()
  if (home) return { path: home, source: "$CODEX_HOME" }
  return { path: join(homedir(), ".codex"), source: "~/.codex" }
}
