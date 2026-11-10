import { homedir } from "node:os"
import { join } from "node:path"

export function codexHome() {
  const testHome = process.env.AX_CODE_TEST_HOME
  if (testHome) return { path: join(testHome, ".codex"), source: "~/.codex" }
  const home = process.env.CODEX_HOME?.trim()
  if (home) return { path: home, source: "$CODEX_HOME" }
  return { path: join(homedir(), ".codex"), source: "~/.codex" }
}

export function claudeConfigDir() {
  const testHome = process.env.AX_CODE_TEST_HOME
  if (testHome) return { path: join(testHome, ".claude"), source: "~/.claude" }
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (configDir) return { path: configDir, source: "$CLAUDE_CONFIG_DIR" }
  return { path: join(homedir(), ".claude"), source: "~/.claude" }
}
