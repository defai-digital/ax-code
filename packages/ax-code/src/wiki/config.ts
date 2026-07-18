import type { AxWikiConfig } from "@ax-code/ax-wiki"
import { AX_WIKI_DIR_DEFAULT, sanitizeWikiDir } from "@ax-code/ax-wiki"
import { Config } from "../config/config"

export type WikiRuntimeConfig = AxWikiConfig & {
  enabled: boolean
  dir: string
  model?: string
  autoInjectAgents: boolean
  touchClaudeMd: boolean
}

type WikiConfigSlice = AxWikiConfig & {
  enabled?: boolean
  dir?: string
  model?: string
  autoInjectAgents?: boolean
  touchClaudeMd?: boolean
}

async function readWikiConfigSlice(): Promise<WikiConfigSlice | undefined> {
  try {
    const config = await Config.get()
    return (config as { wiki?: WikiConfigSlice }).wiki
  } catch {
    try {
      const config = await Config.global()
      return (config as { wiki?: WikiConfigSlice }).wiki
    } catch {
      return undefined
    }
  }
}

export async function resolveWikiRuntimeConfig(
  overrides: { dir?: string; model?: string } = {},
): Promise<WikiRuntimeConfig> {
  const slice = await readWikiConfigSlice()
  return {
    ...(slice ?? {}),
    enabled: slice?.enabled !== false,
    dir: sanitizeWikiDir(overrides.dir ?? slice?.dir, AX_WIKI_DIR_DEFAULT),
    model: overrides.model?.trim() || slice?.model?.trim() || undefined,
    autoInjectAgents: slice?.autoInjectAgents !== false,
    touchClaudeMd: slice?.touchClaudeMd !== false,
  }
}

export function engineConfig(config: WikiRuntimeConfig): AxWikiConfig {
  return {
    include: config.include,
    exclude: config.exclude,
    pages: config.pages,
    maxPages: config.maxPages,
    maxSourcesPerPage: config.maxSourcesPerPage,
    maxSourceBytes: config.maxSourceBytes,
    maxPageSourceBytes: config.maxPageSourceBytes,
    instructions: config.instructions,
  }
}
