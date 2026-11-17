import { createWikiPlan, discoverSources, loadAxWikiConfig, type WikiPlan } from "@ax-code/ax-wiki/node"
import { engineConfig, resolveWikiRuntimeConfig } from "./config"

/** Deterministic source inspection, independent of model generation. */
export async function planNativeWiki(input: { root: string; dir?: string }): Promise<WikiPlan> {
  const config = await resolveWikiRuntimeConfig({ dir: input.dir })
  const diskConfig = await loadAxWikiConfig(input.root)
  const runtimeConfig = Object.fromEntries(
    Object.entries(engineConfig(config)).filter((entry) => entry[1] !== undefined),
  )
  const planConfig = { ...diskConfig, ...runtimeConfig }
  const sources = await discoverSources({ root: input.root, wikiDir: config.dir, config: planConfig })
  return createWikiPlan(sources, planConfig)
}
