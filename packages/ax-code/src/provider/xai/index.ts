/**
 * XAI/Grok provider extensions for ax-code
 * Ported from ax-cli's Grok provider
 *
 * Adds server-side tools (x_search, code_execution) and parallel calling
 * to the existing @ai-sdk/xai provider via providerOptions injection.
 */

export {
  type ServerToolsConfig,
  type XSearchConfig,
  type CodeExecutionConfig,
  DEFAULT_CONFIG,
  buildToolsArray,
  buildToolConfig,
  hasEnabled,
  merge,
  supportsServerTools,
  supportsReasoning,
} from "./server-tools"
