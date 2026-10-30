#!/usr/bin/env bun
/**
 * Build-time syntax parser asset maintenance.
 *
 * @module
 */
export {}

import { runUpdateAssetsCli } from "./assets/update.js"

export { runUpdateAssetsCli, updateAssets } from "./assets/update.js"
export type { UpdateOptions } from "./assets/update.js"

if (import.meta.main) {
  await runUpdateAssetsCli()
}
