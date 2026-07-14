/**
 * OpenWiki / repo semantic wiki adapter (ADR-050).
 *
 * Structural code intelligence remains in src/code-intelligence/.
 * This module only orchestrates OpenWiki artifacts and agent routing.
 */

export {
  WIKI_DIR_DEFAULT,
  OPENWIKI_COMMAND_DEFAULT,
  OPENWIKI_START,
  OPENWIKI_END,
  AGENTS_FILENAME,
  CLAUDE_FILENAME,
  INDEX_CANDIDATES,
} from "./paths"

export {
  hasOpenWikiBlock,
  defaultOpenWikiBlockBody,
  upsertOpenWikiBlock,
  ensureAgentsWikiPointers,
  type EnsureAgentsResult,
} from "./agents-block"

export {
  detectWiki,
  resolveBinary,
  resolveWikiCommand,
  type WikiDetectResult,
  type WikiBinaryInfo,
  type WikiLastUpdate,
} from "./detect"

export {
  runOpenWiki,
  buildOpenWikiArgs,
  OPENWIKI_INSTALL_HINT,
  type WikiRunAction,
  type WikiRunResult,
} from "./runner"

export { getWikiStatus, buildRecommendations, isHealthy, type WikiStatus } from "./status"

export { renderRepoWikiProtocol, maybeRenderRepoWikiProtocol } from "./protocol"
