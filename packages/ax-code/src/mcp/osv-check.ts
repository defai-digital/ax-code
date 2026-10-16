import { z } from "zod"
import path from "path"
import { NamedError } from "@ax-code/util/error"
import { Log } from "../util/log"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { parseJsonStrict } from "../util/json-value"

export namespace OsvCheck {
  const log = Log.create({ service: "mcp-osv" })

  /** Network timeout for one OSV query. ADR-230 keeps the call fast so a slow upstream cannot stall startup. */
  export const MCP_OSV_TIMEOUT_MS = 3_000

  /** In-memory + on-disk cache lifetime. ADR-230 spec: 24 hours. */
  export const MCP_OSV_CACHE_TTL_MS = 24 * 60 * 60 * 1_000

  const OSV_QUERY_URL = "https://api.osv.dev/v1/query"
  const OSV_CACHE_PATH = "mcp-osv-cache.json"
  const OSV_CACHE_VERSION = 1

  const Ecosystem = z.enum(["npm", "PyPI"])

  const ParsedPackage = z.object({
    ecosystem: Ecosystem,
    name: z.string().min(1),
    version: z.string().min(1).optional(),
  })

  export type ParsedPackage = z.infer<typeof ParsedPackage>

  const OsvVulnerability = z
    .object({
      id: z.string(),
      summary: z.string().optional(),
      details: z.string().optional(),
    })
    .passthrough()

  /** OSV /v1/query response. Vulns is the only field we read. */
  const OsvQueryResponse = z
    .object({
      vulns: z.array(OsvVulnerability).optional(),
    })
    .passthrough()

  /** A single MAL-prefixed advisory that blocked the launch. */
  const OsvAdvisoryIds = z.array(z.string().min(1))

  /**
   * Thrown by {@link checkLocalLaunch} when OSV reports one or more MAL-prefixed
   * advisories for the package the user is about to launch. The package and ids
   * ride on the error so the MCP create() path can surface them in its failed
   * status, the log line, and the eventual chip message.
   */
  export const McpOSVBlocked = NamedError.create(
    "McpOSVBlocked",
    z.object({
      package: z.string(),
      version: z.string().optional(),
      ids: OsvAdvisoryIds,
      ecosystem: Ecosystem,
    }),
  )
  export type McpOSVBlocked = z.infer<typeof McpOSVBlocked>

  const CacheEntry = z.object({
    package: z.string(),
    ecosystem: Ecosystem,
    version: z.string().optional(),
    fetchedAt: z.number(),
    blockIds: z.array(z.string()),
    warnIds: z.array(z.string()),
  })

  const CacheFile = z.object({
    version: z.literal(OSV_CACHE_VERSION),
    entries: z.record(z.string(), CacheEntry),
  })

  type CacheEntry = z.infer<typeof CacheEntry>
  type CacheFile = z.infer<typeof CacheFile>

  type LookupResult = { blockIds: string[]; warnIds: string[] }

  /** Launcher names whose argv holds a registry-resolved package (ADR-230). */
  const KNOWN_LAUNCHERS = new Set(["npx", "uvx", "bunx"])
  /** Launcher names whose first subcommand is a registry-resolved package. */
  const KNOWN_PREFIX_LAUNCHERS: Record<string, string> = {
    pnpm: "dlx",
    npm: "exec",
    pipx: "run",
  }

  /** Subcommands an installer recognizes, used to peel wrappers before the package. */
  const INSTALLER_FLAGS = new Set(["-y", "--yes", "-p", "--package"])

  /**
   * Recognized spec prefixes the parser MUST skip. A local path, git ref, or
   * arbitrary URL would otherwise pass through `parsePkgSpec` and produce a
   * spurious "ecosystem + name" record. ADR-230 calls these out explicitly.
   */
  function isLocalOrNonRegistrySpec(spec: string): boolean {
    if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) return true
    if (spec.startsWith("file:")) return true
    if (spec.startsWith("git+") || spec.startsWith("git://") || spec.startsWith("git@")) return true
    if (spec.startsWith("github:")) return true
    if (spec.startsWith("http://") || spec.startsWith("https://")) return true
    if (/^[a-zA-Z]:[\\/]/.test(spec)) return true
    return false
  }

  /** Split `@scope/pkg@1.2.3` -> `{name: "@scope/pkg", version: "1.2.3"}`. */
  function splitPkgAtVersion(spec: string): { name: string; version?: string } {
    // A scoped package has the shape @scope/name; the FIRST @ AFTER the
    // closing slash separates the name from the version. For an unscoped
    // package, the FIRST @ anywhere in the string is the separator.
    const searchFrom = spec.startsWith("@") ? spec.indexOf("/") + 1 : 0
    const idx = spec.indexOf("@", searchFrom)
    if (idx < 0) return { name: spec }
    return { name: spec.slice(0, idx), version: spec.slice(idx + 1) }
  }

  /**
   * Pull a `name[@version]` spec out of a token, returning undefined when the
   * token is a flag, an option, or something other than a package reference
   * (e.g. a command name passed to `npx --package foo -- bar`).
   */
  function parsePkgSpec(token: string): { name: string; version?: string } | undefined {
    if (!token) return undefined
    if (token.startsWith("-")) return undefined
    if (isLocalOrNonRegistrySpec(token)) return undefined
    // The optional version segment is only retained when it looks like a
    // SemVer-ish string (digits + dots), so a stray command named
    // `pkg@some-command` is treated as the bare package, not as a pinned
    // version.
    const { name, version } = splitPkgAtVersion(token)
    if (!name) return undefined
    if (version && !/^v?\d+([.-]?\d+)*([+-][\w.-]+)?$/i.test(version)) {
      return { name }
    }
    return { name, version }
  }

  /**
   * Parse a local-MCP launch command into an OSV-targeted package. Returns
   * undefined for unrecognized launchers, for spec forms that do not name a
   * registry package, and for unparseable inputs. The parser is intentionally
   * narrow — the rest of the pipeline must not speculatively query OSV.
   */
  export function parseLocalLaunch(command: readonly string[]): ParsedPackage | undefined {
    if (command.length === 0) return undefined
    const [launcher, ...rest] = command
    if (!launcher) return undefined

    // Strip absolute/relative launcher paths (resolved earlier by the
    // MCP impl) so the basename check below sees the launcher name.
    const base = launcher.split(/[\\/]/).pop() ?? launcher
    if (KNOWN_LAUNCHERS.has(base)) {
      const ecosystem: z.infer<typeof Ecosystem> = base === "uvx" ? "PyPI" : "npm"
      return parseNpxStyle(ecosystem, rest)
    }
    const sub = KNOWN_PREFIX_LAUNCHERS[base]
    if (sub !== undefined) {
      return parsePrefixedStyle(base, sub, rest)
    }
    return undefined
  }

  function parseNpxStyle(ecosystem: z.infer<typeof Ecosystem>, args: readonly string[]): ParsedPackage | undefined {
    // npx [flags...] [package[@version]] [command...].
    // `--package` / `-p` take the package as the next token even when another
    // value follows (npx then runs that command).
    let i = 0
    while (i < args.length) {
      const arg = args[i]
      if (arg === undefined) break
      if (INSTALLER_FLAGS.has(arg)) {
        const next = args[i + 1]
        if (next !== undefined) {
          const spec = parsePkgSpec(next)
          if (spec) return toParsed(ecosystem, spec)
        }
        i += 2
        continue
      }
      if (arg.startsWith("-")) {
        // Skip the flag itself; if it is a `--key=value` form the package
        // cannot be inside it, so just advance one slot.
        i += 1
        continue
      }
      const spec = parsePkgSpec(arg)
      if (spec) return toParsed(ecosystem, spec)
      return undefined
    }
    return undefined
  }

  function parsePrefixedStyle(launcher: string, sub: string, args: readonly string[]): ParsedPackage | undefined {
    // Shape: launcher sub [flags...] [package[@version]] [command...]
    if (args[0] !== sub) return undefined
    let i = 1
    while (i < args.length) {
      const arg = args[i]
      if (arg === undefined) break
      if (arg.startsWith("-")) {
        i += 1
        continue
      }
      const ecosystem: z.infer<typeof Ecosystem> = launcher === "pipx" ? "PyPI" : "npm"
      const spec = parsePkgSpec(arg)
      if (spec) return toParsed(ecosystem, spec)
      return undefined
    }
    return undefined
  }

  function toParsed(ecosystem: z.infer<typeof Ecosystem>, spec: { name: string; version?: string }): ParsedPackage {
    const result: ParsedPackage = { ecosystem, name: spec.name }
    if (spec.version !== undefined) result.version = spec.version
    return result
  }

  /** Cache key independent of the version so an upgrade re-queries once. */
  function cacheKey(pkg: ParsedPackage): string {
    return `${pkg.ecosystem}:${pkg.name}`
  }

  /** In-memory copy of the disk cache. Lazy-loaded on first lookup. */
  let memoryCache: Map<string, CacheEntry> | undefined
  let memoryCacheLoadedAt = 0
  /** Tests override the global fetch to inject canned responses. */
  let fetchOverride: typeof globalThis.fetch | undefined
  /** Tests override the on-disk path to keep artifacts inside tmpdir. */
  let cachePathOverride: string | undefined

  function getCachePath(): string {
    if (cachePathOverride) return cachePathOverride
    return path.join(Global.Path.data, OSV_CACHE_PATH)
  }

  async function loadCache(): Promise<Map<string, CacheEntry>> {
    if (memoryCache && Date.now() - memoryCacheLoadedAt < 60_000) return memoryCache
    const map = new Map<string, CacheEntry>()
    const raw = await Filesystem.readJson<unknown>(getCachePath()).catch((error) => {
      if (Filesystem.isEnoent(error)) return undefined
      log.debug("osv cache read failed; treating as empty", { error: String(error) })
      return undefined
    })
    if (raw !== undefined) {
      const result = CacheFile.safeParse(raw)
      if (result.success) {
        for (const [key, entry] of Object.entries(result.data.entries)) {
          map.set(key, entry)
        }
      } else {
        log.debug("osv cache shape invalid; ignoring", { error: result.error.message })
      }
    }
    memoryCache = map
    memoryCacheLoadedAt = Date.now()
    return map
  }

  async function persistCache(map: Map<string, CacheEntry>): Promise<void> {
    const entries: Record<string, CacheEntry> = {}
    for (const [key, entry] of map.entries()) entries[key] = entry
    const file: CacheFile = { version: OSV_CACHE_VERSION, entries }
    try {
      await Filesystem.writeJson(getCachePath(), file, 0o600)
    } catch (error) {
      log.debug("osv cache write failed; continuing", { error: String(error) })
    }
  }

  function getFetch(): typeof globalThis.fetch {
    return fetchOverride ?? globalThis.fetch
  }

  function advisoryKind(id: string): "mal" | "warn" {
    return id.startsWith("MAL-") ? "mal" : "warn"
  }

  /**
   * Test seam: replace the global OSV fetcher and the cache file location.
   * Pass undefined to restore production behaviour. Only tests should call this.
   */
  export function _setOsvOverrides(opts: { fetch?: typeof globalThis.fetch; cachePath?: string }): void {
    fetchOverride = opts.fetch
    cachePathOverride = opts.cachePath
    memoryCache = undefined
    memoryCacheLoadedAt = 0
  }

  /**
   * Query OSV for a single parsed package. Returns the set of MAL- and non-MAL
   * advisory ids. Network, timeout and parse failures fail open: the function
   * returns an empty result so the caller can launch the package.
   */
  export async function lookupPackage(pkg: ParsedPackage, signal?: AbortSignal): Promise<LookupResult> {
    const requestBody: Record<string, unknown> = {
      package: { name: pkg.name, ecosystem: pkg.ecosystem },
    }
    if (pkg.version !== undefined) {
      ;(requestBody.package as Record<string, unknown>).version = pkg.version
    }
    const body = JSON.stringify(requestBody)

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error("osv lookup timeout")), MCP_OSV_TIMEOUT_MS)
    // Honor caller's abort without aborting on a plain timeout (the timer above
    // is the timeout the spec demands; AbortSignal links both for one cleanup).
    const onCallerAbort = () => ac.abort()
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        return { blockIds: [], warnIds: [] }
      }
      signal.addEventListener("abort", onCallerAbort, { once: true })
    }
    try {
      const fetchFn = getFetch()
      const response = await fetchFn(OSV_QUERY_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: ac.signal,
      })
      if (!response.ok) {
        log.debug("osv query non-2xx; failing open", { status: response.status, package: pkg.name })
        return { blockIds: [], warnIds: [] }
      }
      const text = await response.text()
      let parsedValue: unknown
      try {
        parsedValue = parseJsonStrict(text)
      } catch (error) {
        log.debug("osv response parse failed; failing open", { package: pkg.name, error: String(error) })
        return { blockIds: [], warnIds: [] }
      }
      const result = OsvQueryResponse.safeParse(parsedValue)
      if (!result.success) {
        log.debug("osv response shape invalid; failing open", { package: pkg.name, error: result.error.message })
        return { blockIds: [], warnIds: [] }
      }
      const vulns = result.data.vulns ?? []
      const blockIds: string[] = []
      const warnIds: string[] = []
      for (const vuln of vulns) {
        if (!vuln.id) continue
        if (advisoryKind(vuln.id) === "mal") blockIds.push(vuln.id)
        else warnIds.push(vuln.id)
      }
      return { blockIds, warnIds }
    } catch (error) {
      log.debug("osv lookup error; failing open", { package: pkg.name, error: String(error) })
      return { blockIds: [], warnIds: [] }
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener("abort", onCallerAbort)
    }
  }

  function freshEntry(pkg: ParsedPackage, result: LookupResult): CacheEntry {
    const entry: CacheEntry = {
      package: pkg.name,
      ecosystem: pkg.ecosystem,
      fetchedAt: Date.now(),
      blockIds: result.blockIds,
      warnIds: result.warnIds,
    }
    if (pkg.version !== undefined) entry.version = pkg.version
    return entry
  }

  /**
   * Cached wrapper around {@link lookupPackage}. The 24h TTL is keyed by
   * ecosystem+name so a version upgrade triggers a fresh query. A network
   * failure or a missing package fail open: the result is the same `[]`/warn
   * set `lookupPackage` would have returned without a cache.
   */
  export async function cachedLookup(pkg: ParsedPackage): Promise<LookupResult> {
    const cache = await loadCache()
    const key = cacheKey(pkg)
    const existing = cache.get(key)
    if (existing && Date.now() - existing.fetchedAt < MCP_OSV_CACHE_TTL_MS) {
      return { blockIds: existing.blockIds, warnIds: existing.warnIds }
    }
    const result = await lookupPackage(pkg)
    cache.set(key, freshEntry(pkg, result))
    // Best-effort persistence; an I/O failure must not block the launch.
    void persistCache(cache)
    return result
  }

  /**
   * Top-level entry point used by the MCP create() path. Throws
   * {@link McpOSVBlocked} when the package has one or more MAL- advisories;
   * logs a warning for other advisories; never throws on network/parse
   * failure or on a clean bill of health.
   */
  export async function checkLocalLaunch(
    command: readonly string[],
    serverName: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const parsed = parseLocalLaunch(command)
    if (!parsed) return
    const result = await cachedLookup(parsed)
    if (result.blockIds.length > 0) {
      log.error("osv MAL- advisories block MCP launch", {
        server: serverName,
        package: parsed.name,
        version: parsed.version,
        ids: result.blockIds,
      })
      throw new McpOSVBlocked({
        package: parsed.name,
        ...(parsed.version !== undefined ? { version: parsed.version } : {}),
        ids: result.blockIds,
        ecosystem: parsed.ecosystem,
      })
    }
    if (result.warnIds.length > 0) {
      log.warn("osv advisories for MCP package (non-blocking)", {
        server: serverName,
        package: parsed.name,
        version: parsed.version,
        ids: result.warnIds,
      })
    }
  }

  /** Public helper to reset the in-memory cache without touching disk. Tests use this. */
  export function _resetOsvCacheForTests(): void {
    memoryCache = undefined
    memoryCacheLoadedAt = 0
  }
}
