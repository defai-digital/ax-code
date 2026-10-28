import path from "node:path"
import { LANGUAGE_EXTENSIONS } from "@ax-code/ax-code-intel/language"
import { readFilePrefix } from "@ax-code/ax-wiki/node"
import type { InventorySymbol } from "@ax-code/ax-wiki/graph"
import { SyntacticExtractor } from "../code-intelligence/syntactic"
import { parseJsonStrict } from "../util/json-value"

export namespace WikiInventory {
  export const LIMITS = {
    maxSources: 500,
    perFileBytes: 262_144,
    totalBytes: 8_388_608,
    symbolsPerSource: 100,
    importsPerSource: 100,
  } as const

  export type Limits = {
    maxSources: number
    perFileBytes: number
    totalBytes: number
    symbolsPerSource: number
    importsPerSource: number
  }

  /** Per-source inventory: outline symbols plus resolved repo-relative import targets. */
  export type SourceInventory = {
    symbols: InventorySymbol[]
    imports: string[]
  }

  /** Map a root-relative path to a supported extractor language, if any. */
  export function languageFor(relative: string): string | undefined {
    const lang =
      LANGUAGE_EXTENSIONS[path.extname(relative).toLowerCase()] ??
      LANGUAGE_EXTENSIONS[path.basename(relative).toLowerCase()]
    if (!lang || lang === "plaintext" || !SyntacticExtractor.supported(lang)) return undefined
    return lang
  }

  const JS_TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
  // TypeScript resolves extensionful relative imports against source files:
  // `./x.js` in a .ts file means `./x.ts` or `./x.tsx` on disk, and the
  // order below is TypeScript's precedence. `./x.jsx` maps only to `.tsx`.
  const JS_EXT_SWAP: Record<string, readonly string[]> = {
    ".js": [".ts", ".tsx"],
    ".jsx": [".tsx"],
    ".mjs": [".mts"],
    ".cjs": [".cts"],
  }

  /**
   * A `compilerOptions.paths` table from one tsconfig.json, with its targets
   * already joined to the config directory (root-relative, posix).
   */
  export type PathAliases = {
    dir: string
    rules: Array<{ prefix: string; suffix: string; wildcard: boolean; targets: string[] }>
  }

  /** Parse the `paths` table of a plain-JSON tsconfig; anything else yields no aliases. */
  export function parsePathAliases(dir: string, text: string): PathAliases | undefined {
    let config: unknown
    try {
      config = parseJsonStrict(text)
    } catch {
      return undefined
    }
    const options = (config as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | null)?.compilerOptions
    const paths = options?.paths
    if (!paths || typeof paths !== "object" || Array.isArray(paths)) return undefined
    const base = typeof options.baseUrl === "string" ? options.baseUrl : "."
    const rules: PathAliases["rules"] = []
    for (const [pattern, raw] of Object.entries(paths)) {
      if (!Array.isArray(raw) || pattern.split("*").length > 2) continue
      const star = pattern.indexOf("*")
      const targets = raw
        .filter((target): target is string => typeof target === "string" && target.split("*").length <= 2)
        .map((target) => path.posix.join(dir, base, target))
        .filter((target) => target !== ".." && !target.startsWith("../") && !path.posix.isAbsolute(target))
      if (!targets.length) continue
      rules.push({
        prefix: star < 0 ? pattern : pattern.slice(0, star),
        suffix: star < 0 ? "" : pattern.slice(star + 1),
        wildcard: star >= 0,
        targets,
      })
    }
    // TypeScript prefers the longest matching prefix.
    rules.sort((a, b) => b.prefix.length - a.prefix.length)
    return rules.length ? { dir, rules } : undefined
  }

  /**
   * Resolve a module specifier against the cited source set without I/O:
   * relative specifiers, or `paths` aliases from the importing file's nearest
   * tsconfig when supplied. Then exact match, TypeScript extension swap,
   * extension probing, and index files. Bare, absolute, escaping, or unlisted
   * targets yield undefined (no edge), never a guess.
   */
  export function resolveImport(
    from: string,
    specifier: string,
    cited: ReadonlySet<string>,
    aliases?: PathAliases,
  ): string | undefined {
    // A leading `#` is a subpath alias such as `#db`; anywhere else it is a fragment.
    if (!specifier || specifier.includes("\\") || specifier.includes("?") || specifier.indexOf("#", 1) >= 0)
      return undefined
    if (specifier !== "." && specifier !== ".." && !specifier.startsWith("./") && !specifier.startsWith("../")) {
      for (const rule of aliases?.rules ?? []) {
        const matches = rule.wildcard
          ? specifier.startsWith(rule.prefix) &&
            specifier.endsWith(rule.suffix) &&
            specifier.length >= rule.prefix.length + rule.suffix.length
          : specifier === rule.prefix
        if (!matches) continue
        const rest = rule.wildcard ? specifier.slice(rule.prefix.length, specifier.length - rule.suffix.length) : ""
        for (const target of rule.targets) {
          const star = target.indexOf("*")
          // One `*` is the TypeScript wildcard. Splicing avoids `replace` only
          // changing the first star, and avoids `$` sequences in `rest`.
          if (star !== target.lastIndexOf("*")) continue
          const replaced = star < 0 ? target : `${target.slice(0, star)}${rest}${target.slice(star + 1)}`
          const base = path.posix.normalize(replaced)
          if (base.startsWith("../") || path.posix.isAbsolute(base)) continue
          const found = probe(base, cited)
          if (found) return found
        }
        return undefined
      }
      return undefined
    }
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
    if (!base || base === "." || base === ".." || base.startsWith("../") || path.posix.isAbsolute(base))
      return undefined
    return probe(base, cited)
  }

  function probe(base: string, cited: ReadonlySet<string>): string | undefined {
    // `./dir/` normalizes to `dir/`; probing it as-is would build `dir//index.ts`.
    if (base.length > 1 && base.endsWith("/")) base = base.replace(/\/+$/, "")
    if (cited.has(base)) return base
    const ext = path.posix.extname(base).toLowerCase()
    const stem = ext ? base.slice(0, -ext.length) : base
    for (const swapped of JS_EXT_SWAP[ext] ?? []) {
      if (cited.has(stem + swapped)) return stem + swapped
    }
    for (const candidate of JS_TS_EXTENSIONS.map((suffix) => base + suffix)) {
      if (cited.has(candidate)) return candidate
    }
    for (const candidate of JS_TS_EXTENSIONS.map((suffix) => `${base}/index${suffix}`)) {
      if (cited.has(candidate)) return candidate
    }
    return undefined
  }

  /**
   * Deterministic per-source symbol and import inventory for view
   * projection. Sorted input order decides which files fit the budgets;
   * unsupported, unreadable, or failed files are skipped (fail-open),
   * never fatal. Each file is read once; import targets resolve against
   * the full cited set so co-cited files link even beyond the read slice.
   */
  export async function buildAll(
    root: string,
    sources: readonly string[],
    limits: Limits = LIMITS,
    signal?: AbortSignal,
    options: {
      readFile?: typeof readFilePrefix
      priority?: readonly string[]
      onSource?: (
        path: string,
        state: {
          status: "analyzed" | "unsupported" | "unavailable" | "failed" | "not-scanned"
          omittedImports: number
          unresolvedImports: number
        },
      ) => void
    } = {},
  ): Promise<Map<string, SourceInventory>> {
    signal?.throwIfAborted()
    const cited = new Set(sources)
    const priority = new Set(options.priority ?? [])
    const selected = [...cited]
      .sort((a, b) => Number(priority.has(b)) - Number(priority.has(a)) || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, Math.max(0, limits.maxSources))
    const read = options.readFile ?? readFilePrefix
    const report = (
      path: string,
      status: "analyzed" | "unsupported" | "unavailable" | "failed" | "not-scanned",
      omittedImports = 0,
      unresolvedImports = 0,
    ) => options.onSource?.(path, { status, omittedImports, unresolvedImports })
    const inventory = new Map<string, SourceInventory>()
    // Nearest tsconfig.json per directory, read once; only its own `paths` apply (no `extends`).
    const configs = new Map<string, PathAliases | undefined>()
    for (const relative of selected) {
      for (let dir = path.posix.dirname(relative); ; dir = path.posix.dirname(dir)) {
        if (configs.has(dir)) break
        const text = await read(root, dir === "." ? "tsconfig.json" : `${dir}/tsconfig.json`, 65_536)
        configs.set(
          dir,
          text === undefined ? undefined : (parsePathAliases(dir === "." ? "" : dir, text) ?? { dir, rules: [] }),
        )
        if (dir === ".") break
      }
    }
    const aliasesFor = (relative: string): PathAliases | undefined => {
      for (let dir = path.posix.dirname(relative); ; dir = path.posix.dirname(dir)) {
        const found = configs.get(dir)
        if (found) return found.rules.length ? found : undefined
        if (dir === ".") return undefined
      }
    }
    let remaining = Math.max(0, limits.totalBytes)
    for (const relative of selected) {
      signal?.throwIfAborted()
      if (remaining <= 0) {
        report(relative, "not-scanned")
        continue
      }
      const lang = languageFor(relative)
      if (!lang) {
        report(relative, "unsupported")
        continue
      }
      const content = await read(root, relative, Math.min(remaining, Math.max(0, limits.perFileBytes)))
      if (content === undefined) {
        report(relative, "unavailable")
        continue
      }
      remaining -= Buffer.byteLength(content)
      let symbols: SyntacticExtractor.Symbol[] | undefined
      let refs: SyntacticExtractor.ImportRef[] | undefined
      try {
        const extracted = await SyntacticExtractor.extractInventory(lang, content, signal)
        symbols = extracted.symbols
        refs = extracted.imports
      } catch {
        signal?.throwIfAborted()
        report(relative, "failed")
        continue
      }
      const listed = (symbols ?? [])
        .slice(0, Math.max(0, limits.symbolsPerSource))
        .map((symbol) => ({ name: symbol.name, qualified: symbol.qualified, kind: symbol.kind }))
      const resolved = (refs ?? []).map((ref) => resolveImport(relative, ref.specifier, cited, aliasesFor(relative)))
      const allImports = [
        ...new Set(resolved.filter((target): target is string => !!target && target !== relative)),
      ].sort()
      const imports = allImports.slice(0, Math.max(0, limits.importsPerSource))
      report(
        relative,
        "analyzed",
        allImports.length - imports.length,
        resolved.filter((value) => value === undefined).length,
      )
      if (listed.length === 0 && imports.length === 0) continue
      inventory.set(relative, { symbols: listed, imports })
    }
    signal?.throwIfAborted()
    return inventory
  }

  /**
   * Deterministic per-source symbol inventory for view projection. Sorted
   * input order decides which files fit the budgets; unsupported, unreadable,
   * or failed files are skipped (fail-open), never fatal.
   */
  export async function build(
    root: string,
    sources: readonly string[],
    limits: Limits = LIMITS,
  ): Promise<Map<string, InventorySymbol[]>> {
    const inventory = new Map<string, InventorySymbol[]>()
    for (const [relative, entry] of await buildAll(root, sources, limits)) {
      if (entry.symbols.length > 0) inventory.set(relative, entry.symbols)
    }
    return inventory
  }
}
