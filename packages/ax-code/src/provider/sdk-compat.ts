import semver from "semver"

/**
 * Allowed version ranges for runtime-installed provider SDK packages.
 *
 * Provider SDKs referenced by models.dev that ax-code does not bundle are
 * installed at runtime into the cache dir via BunProc.install. Installing
 * "latest" broke every model on a provider as soon as the package shipped a
 * major whose models declare a specificationVersion the bundled `ai` major
 * does not accept (observed: @ai-sdk/anthropic@4.0.39 declares v4; bundled
 * ai@6 resolveLanguageModel only accepts v2/v3 → "Unsupported model version
 * v4" for every model on the provider).
 *
 * Each entry maps an npm package to the major range verified to declare a
 * specificationVersion compatible with the bundled `ai` major. Majors do NOT
 * correlate across packages — @ai-sdk/cerebras@2.x and @ai-sdk/amazon-bedrock@4.x
 * both declare v3 while @ai-sdk/anthropic@4.x declares v4 — so a per-package
 * map is the only safe shape. Every entry below was verified against the
 * package copy in this repo's lockfile (specificationVersion in dist).
 *
 * The map lives in source (not package.json) because package.json dependency
 * ranges do not survive the compiled-binary bundle (script/build-node.ts only
 * injects AX_CODE_VERSION), and because the packages that actually get
 * runtime-installed (e.g. @ai-sdk/anthropic) are not declared dependencies.
 *
 * When bumping the bundled `ai` major, re-verify these ranges against the
 * specification versions the new ai accepts, and extend the map to any new
 * @ai-sdk/* package models.dev starts referencing.
 */
export namespace ProviderSdkCompat {
  export const RANGES: Readonly<Record<string, string>> = {
    "@ai-sdk/amazon-bedrock": "^4.0.0",
    "@ai-sdk/anthropic": "^3.0.0",
    "@ai-sdk/azure": "^3.0.0",
    "@ai-sdk/cerebras": "^2.0.0",
    "@ai-sdk/cohere": "^3.0.0",
    "@ai-sdk/deepseek": "^2.0.0",
    "@ai-sdk/fireworks": "^2.0.0",
    "@ai-sdk/gateway": "^3.0.0",
    "@ai-sdk/google-vertex": "^4.0.0",
    "@ai-sdk/groq": "^3.0.0",
    "@ai-sdk/mistral": "^3.0.0",
    "@ai-sdk/perplexity": "^3.0.0",
    "@ai-sdk/xai": "^3.0.0",
  }

  /** Allowed range for a provider npm package, or undefined when unknown. */
  export function rangeFor(npm: string): string | undefined {
    return RANGES[npm]
  }

  /**
   * Version specifier for BunProc.install: the compatible range when known,
   * otherwise "latest" (legacy behavior for unmapped packages).
   */
  export function installVersion(npm: string): string {
    return RANGES[npm] ?? "latest"
  }

  /** True when a concrete installed version satisfies the allowed range. */
  export function isCompatible(npm: string, installedVersion: string): boolean {
    const range = RANGES[npm]
    if (!range) return true
    const version = semver.valid(installedVersion) ?? semver.valid(semver.coerce(installedVersion))
    if (!version) return false
    return semver.satisfies(version, range)
  }
}
