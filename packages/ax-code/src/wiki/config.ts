/**
 * Resolve wiki settings from CLI flags, env, and optional project config.
 * Config is best-effort: CLI wiki commands must work without a full Instance.
 */

import { Config } from "../config/config"
import { OPENWIKI_COMMAND_DEFAULT, WIKI_DIR_DEFAULT } from "./paths"
import { resolveWikiCommand } from "./detect"

export type WikiRuntimeConfig = {
  enabled: boolean
  command: string
  dir: string
  autoInjectAgents: boolean
  touchClaudeMd: boolean
}

const DEFAULTS: WikiRuntimeConfig = {
  enabled: true,
  command: OPENWIKI_COMMAND_DEFAULT,
  dir: WIKI_DIR_DEFAULT,
  autoInjectAgents: true,
  touchClaudeMd: true,
}

type WikiConfigSlice = {
  enabled?: boolean
  command?: string
  dir?: string
  autoInjectAgents?: boolean
  touchClaudeMd?: boolean
}

async function readWikiConfigSlice(): Promise<WikiConfigSlice | undefined> {
  try {
    const cfg = await Config.get()
    return (cfg as { wiki?: WikiConfigSlice }).wiki
  } catch {
    try {
      const cfg = await Config.global()
      return (cfg as { wiki?: WikiConfigSlice }).wiki
    } catch {
      return undefined
    }
  }
}

/**
 * Merge defaults ← config ← explicit CLI/env overrides.
 */
export async function resolveWikiRuntimeConfig(overrides?: {
  command?: string
  dir?: string
}): Promise<WikiRuntimeConfig> {
  const slice = await readWikiConfigSlice()
  const command = resolveWikiCommand(overrides?.command ?? slice?.command)
  const dir = (overrides?.dir?.trim() || slice?.dir?.trim() || DEFAULTS.dir).replace(/\\/g, "/").replace(/\/+$/, "") || DEFAULTS.dir

  return {
    enabled: slice?.enabled !== false,
    command,
    dir,
    autoInjectAgents: slice?.autoInjectAgents !== false,
    touchClaudeMd: slice?.touchClaudeMd !== false,
  }
}
