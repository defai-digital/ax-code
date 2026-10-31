import path from "path"
import os from "os"
import fs from "fs/promises"
import matter from "gray-matter"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Flag } from "@/flag/flag"
import { Log } from "../util/log"
import { Glob } from "../util/glob"
import { Ssrf } from "../util/ssrf"
import type { MessageV2 } from "./message-v2"
import { parseContentLengthHeader } from "@/util/http-header"
import { BodyTooLargeError, readBoundedBody } from "@/util/http-body"
import { detectHiddenUnicode } from "../util/untrusted-content"

const log = Log.create({ service: "instruction" })

const FILES = ["AGENTS.md", "CLAUDE.md"]

// ADR-219: path-scoped rule files under <worktree>/.ax-code/rules/*.md.
// A rule carries YAML frontmatter `paths: [glob, ...]` (worktree-relative,
// minimatch syntax) and is injected once per session when a file the session
// reads or edits matches — through the same claim/dedupe mechanism as nested
// AGENTS.md. A rule without `paths` is ignored here (use AGENTS.md).
const RULES_DIR = path.join(".ax-code", "rules")
// fast-glob patterns always use forward slashes; building this with
// path.join would emit backslashes on Windows, which fast-glob reads as
// escape characters, so the pattern would never match.
const RULES_PATTERN = ".ax-code/rules/*.md"
// Size cap per rule file. A rule is context injected on matching file access;
// an oversized rule is almost certainly the wrong tool (AGENTS.md or a skill
// fits better), so it is skipped with a warning instead of truncated.
const RULE_MAX_BYTES = 64 * 1024
// Bound cached parsed/negative results even when rule files churn during a session.
const RULE_CACHE_LIMIT = 512

export type PathRule = {
  filepath: string
  paths: string[]
  content: string
}

function parsePathRule(filepath: string, raw: string): PathRule | undefined {
  const bytes = Buffer.byteLength(raw, "utf8")
  if (bytes > RULE_MAX_BYTES) {
    log.warn("path rule exceeds size cap; skipping", { path: filepath, bytes, cap: RULE_MAX_BYTES })
    return undefined
  }
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(raw)
  } catch (err) {
    log.warn("path rule frontmatter parse failed", { path: filepath, err })
    return undefined
  }
  const pathsValue = (parsed.data as Record<string, unknown> | null)?.paths
  // A rule without `paths` (or with an empty list) is deliberately ignored.
  if (pathsValue === undefined || (Array.isArray(pathsValue) && pathsValue.length === 0)) return undefined
  if (!Array.isArray(pathsValue) || pathsValue.some((p) => typeof p !== "string" || p.length === 0)) {
    log.warn("path rule has invalid paths; expected a non-empty glob array", { path: filepath })
    return undefined
  }
  const content = parsed.content.trim()
  if (!content) return undefined
  return { filepath, paths: pathsValue as string[], content }
}

// Parsed rules are cached per (path, mtime) so every read/edit does not
// re-parse the whole rules directory. Negative results (ignored or invalid
// rules) are cached against the same mtime.
const ruleCache = Instance.state(() => new Map<string, { mtimeMs: number; rule?: PathRule }>())

// The rules listing (the Glob.scan output) is cached per Instance and keyed on
// the rules directory's existence and mtime (key "missing" covers the absent
// directory): creating, removing or renaming a rule file — or the directory
// itself — updates the directory's mtime, so the listing is re-globbed exactly
// when its contents could have changed. Parsing below stays keyed on each rule
// file's own mtime, so an in-place rule edit (file mtime changes, directory
// mtime does not) is still re-read on the next call. A listing is only cached
// when the directory mtime observed before the glob still holds after it;
// otherwise the next call simply re-globs.
const rulesListingCache = Instance.state(() => ({
  key: undefined as string | undefined,
  files: undefined as string[] | undefined,
}))

async function loadPathRules(): Promise<PathRule[]> {
  // Project trust: rules are project-scoped instructions, so they follow the
  // same project-config gate as the root AGENTS.md.
  if (Flag.AX_CODE_DISABLE_PROJECT_CONFIG) return []
  const dir = path.join(Instance.worktree, RULES_DIR)
  if (!Filesystem.contains(Instance.worktree, dir)) return []
  const listing = rulesListingCache()
  const dirStat = await fs.stat(dir).catch(() => undefined)
  const key = dirStat ? String(dirStat.mtimeMs) : "missing"
  let files: string[]
  if (listing.key === key && listing.files) {
    files = listing.files
  } else {
    files = await Glob.scan(RULES_PATTERN, { cwd: Instance.worktree, absolute: true, include: "file" }).catch(
      () => [] as string[],
    )
    // Only cache the listing when the directory did not change while the glob
    // ran — a rule created mid-glob would otherwise be baked into the cached
    // mtime key but missing from the cached file list.
    const after = await fs.stat(dir).catch(() => undefined)
    if ((after ? String(after.mtimeMs) : "missing") === key) {
      listing.key = key
      listing.files = files
    } else {
      listing.key = undefined
      listing.files = undefined
    }
  }
  const cache = ruleCache()
  // Compare realpaths: the rules directory (or a rule file) can be a symlink
  // that points outside the worktree.
  const root = await realpathOrResolved(Instance.worktree)
  const rules: PathRule[] = []
  for (const file of files) {
    const resolved = await fs.realpath(path.resolve(file)).catch(() => undefined)
    if (!resolved || !Filesystem.contains(root, resolved)) continue
    const stat = await fs.stat(resolved).catch(() => undefined)
    if (!stat) continue
    const mtimeMs = stat.mtimeMs
    const cached = cache.get(resolved)
    if (cached && cached.mtimeMs === mtimeMs) {
      if (cached.rule) rules.push(cached.rule)
      continue
    }
    let rule: PathRule | undefined
    if (stat.size > RULE_MAX_BYTES) {
      // Skip the read entirely for oversized files; parsePathRule's
      // post-read cap stays as the guard against growth between stat and
      // read. The negative cache entry keeps every read/edit from
      // re-stat'ing the file.
      log.warn("path rule exceeds size cap; skipping", { path: resolved, bytes: stat.size, cap: RULE_MAX_BYTES })
    } else {
      const raw = await Filesystem.readText(resolved).catch((err) => {
        log.warn("path rule read failed", { path: resolved, err })
        return ""
      })
      rule = raw ? parsePathRule(resolved, raw) : undefined
    }
    if (!cache.has(resolved) && cache.size >= RULE_CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    cache.set(resolved, { mtimeMs, rule })
    if (rule) rules.push(rule)
  }
  return rules
}

/** Rules whose frontmatter globs match the worktree-relative form of `target`. */
async function matchingPathRulesImpl(target: string): Promise<PathRule[]> {
  const rules = await loadPathRules()
  if (rules.length === 0) return []
  const relative = path.relative(path.resolve(Instance.worktree), path.resolve(target))
  // Rules apply to worktree files only; paths outside the worktree have no
  // project-relative form to match against.
  if (!relative || Filesystem.isOutsideRelative(relative)) return []
  // minimatch globs are forward-slash; on Windows path.relative emits
  // backslashes that would never match a rule's `paths` patterns.
  const normalized = path.sep === "/" ? relative : relative.split(path.sep).join("/")
  return rules.filter((rule) => rule.paths.some((pattern) => Glob.match(pattern, normalized)))
}

async function realpathOrResolved(input: string) {
  return fs.realpath(input).catch(() => input)
}

async function resolveHomeInstructionPath(input: string) {
  const resolved = path.resolve(os.homedir(), input.slice(2))
  if (!Filesystem.contains(os.homedir(), resolved)) {
    log.warn("instruction path escapes home directory", { path: input, resolved })
    return
  }
  const real = await realpathOrResolved(resolved)
  if (!Filesystem.contains(os.homedir(), real)) {
    log.warn("instruction path symlink escapes home directory", { path: input, resolved, real })
    return
  }
  return resolved
}

async function allowInstructionAbsolutePath(input: string) {
  const real = await realpathOrResolved(input)
  return (
    (Filesystem.contains(Instance.worktree, input) && Filesystem.contains(Instance.worktree, real)) ||
    (Filesystem.contains(os.homedir(), input) && Filesystem.contains(os.homedir(), real))
  )
}

// Scan an absolute pattern from its last wildcard-free directory. Using only
// the basename as the pattern would make `~/notes/**/*.md` scan a literal
// `~/notes/**` directory, which does not exist, and silently match nothing.
function splitAbsoluteGlob(instruction: string) {
  const segments = instruction.split(/[\\/]/)
  const first = segments.findIndex((segment) => /[*?[\]{}]/.test(segment))
  if (first === -1 || first === segments.length - 1) {
    return { base: path.dirname(instruction), pattern: path.basename(instruction) }
  }
  return { base: segments.slice(0, first).join(path.sep) || path.sep, pattern: segments.slice(first).join("/") }
}

async function allowRelativeInstructionPath(input: string) {
  const real = await realpathOrResolved(input)
  // Relative instructions resolve against the worktree, or — when project
  // config is disabled — against AX_CODE_CONFIG_DIR (see resolveRelative).
  // Both roots must be accepted, or every config-dir-relative instruction is
  // silently dropped as "escapes allowed roots".
  const roots = [Instance.worktree]
  if (Flag.AX_CODE_CONFIG_DIR) roots.push(Flag.AX_CODE_CONFIG_DIR)
  return roots.some((root) => Filesystem.contains(root, input) && Filesystem.contains(root, real))
}

async function statMtime(dir: string) {
  const stat = await fs.stat(dir).catch(() => undefined)
  return stat ? stat.mtimeMs : Number.NaN
}

// Every directory whose direct children the systemPaths computation observes:
// the AGENTS.md/CLAUDE.md findUp walk (Instance.directory up to and including
// Instance.worktree — the same traversal Filesystem.findUp performs) and the
// parent of each global instruction candidate.
function instructionWatchDirs(globals: string[]) {
  const dirs = new Set<string>()
  let current = Instance.directory
  const stop = Instance.worktree
  while (true) {
    dirs.add(path.resolve(current))
    if (stop === current) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  for (const file of globals) dirs.add(path.dirname(file))
  return [...dirs]
}

// True when none of the watched directories changed mtime. Object.is treats
// NaN (directory absent at both observations) as unchanged, matching findUp's
// exists() returning false both times.
async function watchDirsUnchanged(watch: { dir: string; mtimeMs: number }[]) {
  const after = await Promise.all(watch.map((entry) => statMtime(entry.dir)))
  return after.every((mtimeMs, i) => Object.is(mtimeMs, watch[i].mtimeMs))
}

function globalFiles() {
  const files = []
  if (Flag.AX_CODE_CONFIG_DIR) {
    files.push(path.join(Flag.AX_CODE_CONFIG_DIR, "AGENTS.md"))
  }
  files.push(path.join(Global.Path.config, "AGENTS.md"))
  if (!Flag.AX_CODE_DISABLE_CLAUDE_CODE_PROMPT) {
    files.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }
  return files
}

function isHttpInstructionUrl(input: string) {
  try {
    const protocol = new URL(input).protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

async function resolveRelative(instruction: string): Promise<string[]> {
  if (!Flag.AX_CODE_DISABLE_PROJECT_CONFIG) {
    return Filesystem.globUp(instruction, Instance.directory, Instance.worktree)
  }
  if (!Flag.AX_CODE_CONFIG_DIR) {
    log.warn(
      `Skipping relative instruction "${instruction}" - no AX_CODE_CONFIG_DIR set while project config is disabled`,
    )
    return []
  }
  return Filesystem.globUp(instruction, Flag.AX_CODE_CONFIG_DIR, Flag.AX_CODE_CONFIG_DIR)
}

export namespace InstructionPrompt {
  /** Rules whose frontmatter globs match the worktree-relative form of `target` (ADR-219). */
  export const matchingPathRules = matchingPathRulesImpl

  /** Shared <system-reminder> rendering for instructions resolved during a tool call. */
  export function renderReminder(instructions: { filepath: string; content: string }[]): string {
    if (instructions.length === 0) return ""
    return `\n\n<system-reminder>\n${instructions.map((i) => i.content).join("\n\n")}\n</system-reminder>`
  }

  const state = Instance.state(() => {
    return {
      claims: new Map<string, Set<string>>(),
    }
  })

  function isClaimed(messageID: string, filepath: string) {
    const claimed = state().claims.get(messageID)
    if (!claimed) return false
    return claimed.has(filepath)
  }

  function claim(messageID: string, filepath: string) {
    const current = state()
    let claimed = current.claims.get(messageID)
    if (!claimed) {
      claimed = new Set()
      current.claims.set(messageID, claimed)
    }
    claimed.add(filepath)
  }

  export function clear(messageID: string) {
    state().claims.delete(messageID)
  }

  // Per-Instance cache for the resolved instruction path set. A cached result
  // stays valid while ALL of these hold:
  //  1. The config snapshot object is unchanged. Config.invalidate() /
  //     Config.invalidateAll() make Config.get() return a fresh object, so any
  //     mid-session config change forces a full recompute — including fresh
  //     re-globbing of the `config.instructions` patterns.
  //  2. globalFiles() returns the same candidate list (an env/flag flip
  //     recomputes without touching the filesystem).
  //  3. The mtimes of every directory the AGENTS.md/CLAUDE.md findUp walk
  //     visits (Instance.directory up to Instance.worktree) plus each global
  //     candidate's parent directory are unchanged. Creating, removing or
  //     renaming an instruction file updates the containing directory's
  //     mtime, so new/removed AGENTS.md files are still seen without
  //     re-walking; any other change in those directories merely costs a
  //     recompute.
  //  4. Every cached path still exists (one access per path).
  //  5. The config has no `config.instructions` entries. Those are globs and
  //     upward relative lookups whose matches can appear anywhere, so they are
  //     re-resolved on every call rather than trusted from a cache.
  // Rules-directory freshness is handled separately in loadPathRules().
  // The cached Set is shared between calls; every current caller only reads
  // it (has()/Array.from), so mutation is not a supported pattern.
  const systemPathsCache = Instance.state(() => ({
    config: undefined as Config.Info | undefined,
    globals: [] as string[],
    watch: [] as { dir: string; mtimeMs: number }[],
    paths: undefined as Set<string> | undefined,
  }))

  export async function systemPaths() {
    const config = await Config.get()
    const cache = systemPathsCache()
    const globals = globalFiles()
    if (config.instructions?.length) return systemPathsFresh(config)
    if (
      cache.config === config &&
      cache.globals.length === globals.length &&
      cache.globals.every((file, i) => file === globals[i]) &&
      cache.paths &&
      (await watchDirsUnchanged(cache.watch)) &&
      (await Promise.all([...cache.paths].map((p) => Filesystem.exists(p)))).every(Boolean)
    ) {
      return cache.paths
    }
    const watchDirs = instructionWatchDirs(globals)
    const before = await Promise.all(watchDirs.map((dir) => statMtime(dir)))
    const watch = watchDirs.map((dir, i) => ({ dir, mtimeMs: before[i] }))
    const paths = await systemPathsFresh(config)
    // Publish the cache only when the watched mtimes observed before the
    // computation still hold after it: an instruction file created or removed
    // mid-computation would otherwise be reflected in the mtime snapshot but
    // not in the path set (or vice versa).
    if (await watchDirsUnchanged(watch)) {
      cache.config = config
      cache.globals = globals
      cache.watch = watch
      cache.paths = paths
    }
    return paths
  }

  async function systemPathsFresh(config: Config.Info) {
    const paths = new Set<string>()

    if (!Flag.AX_CODE_DISABLE_PROJECT_CONFIG) {
      for (const file of FILES) {
        const matches = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
        if (matches.length > 0) {
          matches.forEach((p) => {
            paths.add(path.resolve(p))
          })
          break
        }
      }
    }

    for (const file of globalFiles()) {
      if (await Filesystem.exists(file)) {
        paths.add(path.resolve(file))
        break
      }
    }

    if (config.instructions) {
      for (let instruction of config.instructions) {
        if (isHttpInstructionUrl(instruction)) continue
        const relative = !path.isAbsolute(instruction) && !instruction.startsWith("~/")
        if (instruction.startsWith("~/")) {
          const resolved = await resolveHomeInstructionPath(instruction)
          if (!resolved) continue
          instruction = resolved
        }
        if (path.isAbsolute(instruction)) {
          instruction = path.resolve(instruction)
          if (!(await allowInstructionAbsolutePath(instruction))) {
            log.warn("instruction path escapes allowed roots", { path: instruction })
            continue
          }
        }
        const absolute = path.isAbsolute(instruction) ? splitAbsoluteGlob(instruction) : undefined
        const matches = absolute
          ? await Glob.scan(absolute.pattern, {
              cwd: absolute.base,
              absolute: true,
              include: "file",
            })
          : await resolveRelative(instruction)
        for (const match of matches) {
          const resolved = path.resolve(match)
          const allowed = relative
            ? await allowRelativeInstructionPath(resolved)
            : await allowInstructionAbsolutePath(resolved)
          if (!allowed) {
            log.warn("instruction match escapes allowed roots", { path: resolved })
            continue
          }
          paths.add(resolved)
        }
      }
    }

    return paths
  }

  // OpenWiki interop (langchain-ai/openwiki): the tool maintains an
  // `openwiki/` documentation directory at the repository root, normally
  // referenced from a managed AGENTS.md block. When the directory exists
  // but none of the loaded instructions mention it (AGENTS.md missing or
  // hand-edited), surface a one-line pointer so the agent knows the docs
  // exist — mirroring how ax-wiki advertises its own pages through
  // AGENTS.md pointers, and never writing to the user's files. Pointer
  // only, not content: wiki pages can be large and are fetched on demand.
  async function openwikiPointer(loadedInstructions: string[]) {
    const index = path.join(Instance.worktree, "openwiki", "index.md")
    // Containment check keeps the fixed openwiki pointer under the worktree
    // root even if worktree resolution is unexpected (security_scan path_traversal).
    if (!Filesystem.contains(Instance.worktree, index)) return undefined
    // Advisory probe: an unreadable path (EACCES, EPERM) must not reject the
    // whole system-prompt build — skip the pointer like a missing one.
    if (!(await Filesystem.exists(index).catch(() => false))) return undefined
    if (loadedInstructions.some((text) => text.toLowerCase().includes("openwiki"))) return undefined
    return (
      "This repository has an OpenWiki knowledge base in openwiki/. " +
      `Read ${index} when you need repository documentation or architecture context.`
    )
  }

  export async function system() {
    const config = await Config.get()
    const paths = await systemPaths()

    const files = Array.from(paths).map(async (p) => {
      // Log failures so the user sees why a listed instruction file
      // silently produced no effect (permissions, corruption,
      // symlink to a missing path). The previous `.catch(() => "")`
      // made misconfigured paths invisible.
      const content = await Filesystem.readText(p).catch((err) => {
        log.warn("instruction file read failed", { path: p, err })
        return ""
      })
      // ADR-206: hidden Unicode in an instruction file can disguise or
      // reorder its text. Advisory warning only — file and count, never the
      // content itself.
      const hidden = detectHiddenUnicode(content)
      if (hidden > 0) log.warn("instruction file contains hidden Unicode characters", { path: p, count: hidden })
      return content ? "Instructions from: " + p + "\n" + content : ""
    })

    const urls: string[] = []
    if (config.instructions) {
      for (const instruction of config.instructions) {
        if (isHttpInstructionUrl(instruction)) {
          urls.push(instruction)
        }
      }
    }
    const fetches = urls.map(async (url) => {
      // SSRF guard. A malicious project config can set
      // instructions: ["http://169.254.169.254/latest/meta-data/iam/..."]
      // and have the contents injected verbatim into the LLM system
      // prompt as "Instructions from: ...", exfiltrating cloud
      // metadata tokens through the next LLM response. Reject any
      // URL whose resolved address is in a private/reserved range
      // before touching the network. Failures are logged and return
      // an empty string so one bad URL doesn't take down the whole
      // instruction pipeline.
      try {
        await Ssrf.assertPublicUrl(url, "instruction-url")
      } catch (err) {
        log.warn("instruction URL rejected by SSRF guard", { url, err })
        return ""
      }
      const INSTRUCTION_MAX_BYTES = 1024 * 1024 // 1MB
      return Ssrf.pinnedFetch(url, { signal: AbortSignal.timeout(5000) })
        .then(async (res) => {
          if (!res.ok) {
            log.warn("instruction URL returned non-ok", { url, status: res.status })
            // Cancel the unread body so the socket can be reused instead of
            // lingering until the server closes it.
            await res.body?.cancel().catch(() => {})
            return ""
          }
          const contentLength = res.headers.get("content-length")
          const contentLengthBytes = parseContentLengthHeader(contentLength)
          if (contentLengthBytes !== undefined && contentLengthBytes > INSTRUCTION_MAX_BYTES) {
            log.warn("instruction URL response too large", { url, contentLength })
            await res.body?.cancel().catch(() => {})
            return ""
          }
          if (!res.body) return res.text()
          try {
            return new TextDecoder().decode(await readBoundedBody(res, INSTRUCTION_MAX_BYTES))
          } catch (err) {
            if (!(err instanceof BodyTooLargeError)) throw err
            log.warn("instruction URL response exceeded size limit", { url, limit: INSTRUCTION_MAX_BYTES })
            return ""
          }
        })
        .catch((err) => {
          log.warn("instruction URL fetch failed", { url, err })
          return ""
        })
        .then((x) => (x ? "Instructions from: " + url + "\n" + x : ""))
    })

    return Promise.all([...files, ...fetches]).then(async (result) => {
      const loadedInstructions = result.filter(Boolean)
      const pointer = await openwikiPointer(loadedInstructions)
      if (pointer) loadedInstructions.push(pointer)
      return loadedInstructions
    })
  }

  // Tools whose completed parts may carry a `loaded` metadata array of
  // instruction filepaths discovered during that call (read historically;
  // write/edit/apply_patch since ADR-219 path rules). This is the session-wide
  // dedupe layer on top of the per-message claim set.
  const LOADED_PART_TOOLS: ReadonlySet<string> = new Set(["read", "write", "edit", "multiedit", "apply_patch"])

  export function loaded(messages: MessageV2.WithParts[]) {
    const paths = new Set<string>()
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === "tool" && LOADED_PART_TOOLS.has(part.tool) && part.state.status === "completed") {
          if (part.state.time.compacted) continue
          const loaded = part.state.metadata?.loaded
          if (!loaded || !Array.isArray(loaded)) continue
          for (const p of loaded) {
            if (typeof p === "string") paths.add(p)
          }
        }
      }
    }
    return paths
  }

  export async function find(dir: string) {
    for (const file of FILES) {
      const filepath = path.resolve(path.join(dir, file))
      if (await Filesystem.exists(filepath)) return filepath
    }
  }

  export async function resolve(messages: MessageV2.WithParts[], filepath: string, messageID: string) {
    // Project-controlled instructions follow the same gate as systemPaths and
    // loadPathRules: with project config disabled, a nested AGENTS.md is an
    // untrusted project file and must not be injected either.
    if (Flag.AX_CODE_DISABLE_PROJECT_CONFIG) return []
    const system = await systemPaths()
    const already = loaded(messages)
    const results: { filepath: string; content: string }[] = []

    const target = path.resolve(filepath)
    let current = path.dirname(target)
    const root = path.resolve(Instance.directory)
    // A nested AGENTS.md/CLAUDE.md can be a symlink pointing outside the
    // instance root; compare realpaths so it cannot inject arbitrary file
    // contents into the prompt.
    const realRoot = await realpathOrResolved(root)

    while (Filesystem.contains(root, current) && current !== root) {
      const found = await find(current)

      if (found && found !== target && !system.has(found) && !already.has(found) && !isClaimed(messageID, found)) {
        // Claim before the first await: read/write/edit run concurrently for
        // one message, and a check-then-claim split by an await injects the
        // same file twice into the same message.
        claim(messageID, found)
        const real = await realpathOrResolved(found)
        if (!Filesystem.contains(realRoot, real)) {
          log.warn("instruction file symlink escapes instance root", { path: found, real })
        } else {
          const content = await Filesystem.readText(found)
          if (content) {
            const hidden = detectHiddenUnicode(content)
            if (hidden > 0)
              log.warn("instruction file contains hidden Unicode characters", { path: found, count: hidden })
            results.push({ filepath: found, content: "Instructions from: " + found + "\n" + content })
          }
        }
      }
      current = path.dirname(current)
    }

    // ADR-219: inject path-scoped rules matching this file, through the same
    // claim/dedupe gates as nested AGENTS.md, so each rule is injected at
    // most once per session.
    for (const rule of await matchingPathRules(target)) {
      if (system.has(rule.filepath) || already.has(rule.filepath) || isClaimed(messageID, rule.filepath)) continue
      claim(messageID, rule.filepath)
      const hidden = detectHiddenUnicode(rule.content)
      if (hidden > 0)
        log.warn("instruction file contains hidden Unicode characters", { path: rule.filepath, count: hidden })
      results.push({ filepath: rule.filepath, content: "Instructions from: " + rule.filepath + "\n" + rule.content })
    }

    return results
  }
}
