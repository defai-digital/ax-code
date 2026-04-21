import { Log } from "../util/log"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { createRequire } from "module"
import os from "os"
import z from "zod"
import { ModelsDev } from "../provider/models"
import { mergeDeep, pipe, unique } from "remeda"
import { Global } from "../global"
import fs from "fs/promises"
import { lazy } from "../util/lazy"
import { NamedError } from "@ax-code/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { Instance } from "../project/instance"
import { LSPServer } from "../lsp/server"
import { BunProc } from "@/bun"
import { Installation } from "@/installation"
import { ConfigMarkdown } from "./markdown"
import { constants, existsSync } from "fs"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Event } from "../server/event"
import { Glob } from "../util/glob"
import { PackageRegistry } from "@/bun/registry"
import { iife } from "@/util/iife"
import { Account } from "@/account"
import { ConfigPaths } from "./paths"
import { Filesystem } from "@/util/filesystem"
import { Ssrf } from "@/util/ssrf"
import { Process } from "@/util/process"
import { Lock } from "@/util/lock"
import { withTimeout } from "@/util/timeout"
import * as ConfigSchema from "./schema"

// Single source of truth for the public config schema URL. Written
// into every user's ax-code.json on first load, into legacy-TOML
// migrations, and into remote wellknown configs that omit `$schema`.
// Used to be copy-pasted in 4 places — a domain rename or versioning
// change would have missed at least one site and persisted wrong
// schema URLs into random users' configs. See issue #17.
const CONFIG_SCHEMA_URL =
  "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json"

export namespace Config {
  const log = Log.create({ service: "config" })

  // Managed settings directory for enterprise deployments (highest priority, admin-controlled)
  // These settings override all user and project settings
  function systemManagedConfigDir(): string {
    switch (process.platform) {
      case "darwin":
        return "/Library/Application Support/ax-code"
      case "win32":
        return path.join(process.env.ProgramData || "C:\\ProgramData", "ax-code")
      default:
        return "/etc/ax-code"
    }
  }

  export function managedConfigDir() {
    return process.env.AX_CODE_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
  }

  // Lazy — not cached at import time so tests that set
  // AX_CODE_TEST_MANAGED_CONFIG_DIR after import take effect.
  function getManagedDir() {
    return managedConfigDir()
  }

  // Custom merge function that concatenates array fields instead of replacing them
  function mergeConfigConcatArrays(target: Info, source: Info): Info {
    const merged = mergeDeep(target, source)
    if (target.plugin && source.plugin) {
      merged.plugin = Array.from(new Set([...target.plugin, ...source.plugin]))
    }
    if (target.instructions && source.instructions) {
      merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
    }
    return merged
  }

  export const state = Instance.state(async () => {
    const auth = await Auth.all()

    // Config loading order (low -> high precedence): https://github.com/defai-digital/ax-code#config-precedence-order
    // 1) Remote .well-known/ax-code (org defaults, with legacy .well-known/opencode fallback)
    // 2) Global config (~/.config/ax-code/ax-code.json{,c})
    // 3) Custom config (AX_CODE_CONFIG)
    // 4) Project config (ax-code.json{,c})
    // 5) .ax-code directories (.ax-code/agents/, .ax-code/commands/, .ax-code/plugins/, .ax-code/ax-code.json{,c})
    // 6) Inline config (AX_CODE_CONFIG_CONTENT)
    // Managed config directory is enterprise-only and always overrides everything above.
    let result: Info = {}
    // Set env tokens synchronously, then fetch all wellknown configs in parallel
    const wellknownEntries: { url: string; key: string; token: string }[] = []
    for (const [key, value] of Object.entries(auth)) {
      if (value.type === "wellknown") {
        const url = key.replace(/\/+$/, "")
        if (!/^[A-Z][A-Z0-9_]*$/.test(value.key)) {
          log.warn("ignoring wellknown auth with invalid env var name", {
            command: "config.load",
            status: "error",
            errorCode: "INVALID_ENV_VAR",
            key: value.key,
            url: key,
          })
          continue
        }
        process.env[value.key] = value.token
        wellknownEntries.push({ url, key: value.key, token: value.token })
      }
    }
    const wellknownConfigs = await Promise.all(
      wellknownEntries.map(async ({ url }) => {
        try {
          const endpoint = `${url}/.well-known/ax-code`
          const legacy = `${url}/.well-known/opencode`
          log.debug("fetching remote config", { url: endpoint, legacy })
          try {
            await Ssrf.assertPublicUrl(endpoint, "wellknown-config")
            await Ssrf.assertPublicUrl(legacy, "wellknown-config")
          } catch (err) {
            log.warn("wellknown config URL rejected by SSRF guard", {
              command: "config.load",
              status: "error",
              errorCode: "SSRF_REJECTED",
              url,
              err,
            })
            return undefined
          }
          const response = await Ssrf.pinnedFetch(endpoint, { signal: AbortSignal.timeout(10_000) })
            .then((res) => {
              if (res.ok || res.status !== 404) return res
              return Ssrf.pinnedFetch(legacy, { signal: AbortSignal.timeout(10_000) })
            })
            .catch(() => Ssrf.pinnedFetch(legacy, { signal: AbortSignal.timeout(10_000) }))
          if (!response.ok) {
            log.warn("failed to fetch remote config", {
              command: "config.load",
              status: "error",
              errorCode: "REMOTE_FETCH",
              url,
              httpStatus: response.status,
            })
            return undefined
          }
          const wellknown = (await response.json()) as Record<string, unknown>
          const remoteConfig = (wellknown.config ?? {}) as Record<string, unknown>
          if (!remoteConfig.$schema) remoteConfig.$schema = CONFIG_SCHEMA_URL
          const loaded = await load(JSON.stringify(remoteConfig), {
            dir: Instance.directory,
            source: response.url || endpoint,
            trusted: false,
          })
          log.debug("loaded remote config from well-known", { command: "config.load", status: "ok", url })
          return loaded
        } catch (err) {
          log.warn("failed to load wellknown config", {
            command: "config.load",
            status: "error",
            errorCode: "WELLKNOWN_LOAD",
            url,
            error: err,
          })
          return undefined
        }
      }),
    )
    for (const cfg of wellknownConfigs) {
      if (cfg) result = mergeConfigConcatArrays(result, cfg)
    }

    // Global user config overrides remote config.
    result = mergeConfigConcatArrays(result, await global())

    // Custom config path overrides global config.
    if (Flag.AX_CODE_CONFIG) {
      result = mergeConfigConcatArrays(result, await loadFile(Flag.AX_CODE_CONFIG))
      log.debug("loaded custom config", { command: "config.load", status: "ok", path: Flag.AX_CODE_CONFIG })
    }

    // Project config overrides global and remote config.
    if (!Flag.AX_CODE_DISABLE_PROJECT_CONFIG) {
      const projectFiles = await ConfigPaths.projectFiles("ax-code", Instance.directory, Instance.worktree)
      // Project configs live inside the worktree and may be checked
      // in by anyone — treat them as untrusted so a malicious
      // `ax-code.json` committed to a shared repo cannot read files
      // outside the config's directory.
      const configs = await Promise.allSettled(projectFiles.map((file) => loadFile(file, { trusted: false })))
      for (let index = 0; index < configs.length; index++) {
        const cfg = configs[index]
        const filepath = projectFiles[index]
        if (cfg?.status === "fulfilled") {
          result = mergeConfigConcatArrays(result, cfg.value)
          continue
        }
        log.warn("failed to load project config", {
          command: "config.load",
          status: "error",
          path: filepath,
          error: cfg?.reason,
        })
      }
    }

    result.agent = result.agent ?? {}
    result.mode = result.mode ?? {}
    result.plugin = result.plugin ?? []

    const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)

    // .ax-code directory config overrides (project and global) config sources.
    if (Flag.AX_CODE_CONFIG_DIR) {
      log.debug("loading config from AX_CODE_CONFIG_DIR", {
        command: "config.load",
        status: "started",
        path: Flag.AX_CODE_CONFIG_DIR,
      })
    }

    const deps = []

    for (const dir of unique(directories)) {
      // Directories come from three sources: Global.Path.config
      // (trusted), user home walk (trusted), worktree walk
      // (untrusted). Only `.ax-code` dirs *inside the worktree*
      // carry code committed by third parties, so they're the ones
      // we need to confine.
      const inWorktree = Filesystem.contains(Instance.worktree, dir)
      const isUserConfigDir = dir === Global.Path.config || dir === Flag.AX_CODE_CONFIG_DIR
      const trusted = !inWorktree || isUserConfigDir
      const dependencyManaged = !inWorktree || isUserConfigDir
      const configuredPlugins: string[] = []
      if (dir.endsWith(".ax-code") || dir === Flag.AX_CODE_CONFIG_DIR) {
        for (const file of ["ax-code.jsonc", "ax-code.json"]) {
          log.debug(`loading config from ${path.join(dir, file)}`)
          const loaded = await loadFile(path.join(dir, file), { trusted })
          configuredPlugins.push(...(loaded.plugin ?? []))
          result = mergeConfigConcatArrays(result, loaded)
          // to satisfy the type checker
          result.agent ??= {}
          result.mode ??= {}
          result.plugin ??= []
        }
      }

      result.command = mergeDeep(result.command ?? {}, await loadCommand(dir))
      result.agent = mergeDeep(result.agent, await loadAgent(dir))
      result.agent = mergeDeep(result.agent, await loadMode(dir))
      const pluginFiles = await loadPlugin(dir)
      result.plugin.push(...pluginFiles)

      if (
        dependencyManaged &&
        [...configuredPlugins, ...pluginFiles].some((plugin) => isLocalFilePlugin(plugin, dir))
      ) {
        deps.push(
          iife(async () => {
            const shouldInstall = await needsInstall(dir)
            if (shouldInstall) await installDependencies(dir)
          }),
        )
      }
    }

    // Inline config content overrides all non-managed config sources.
    if (process.env.AX_CODE_CONFIG_CONTENT) {
      result = mergeConfigConcatArrays(
        result,
        await load(process.env.AX_CODE_CONFIG_CONTENT, {
          dir: Instance.directory,
          source: "AX_CODE_CONFIG_CONTENT",
          trusted: false,
        }),
      )
      log.debug("loaded custom config from AX_CODE_CONFIG_CONTENT", { command: "config.load", status: "ok" })
    }

    const active = await Account.active()
    if (active?.active_org_id) {
      try {
        let accountTimer: ReturnType<typeof setTimeout>
        const accountTimeout = new Promise<never>((_, reject) => {
          accountTimer = setTimeout(() => reject(new Error("account config fetch timed out")), 10_000)
        })
        const [config, token] = await Promise.race([
          Promise.all([Account.config(active.id, active.active_org_id), Account.token(active.id)]),
          accountTimeout.then(() => {
            throw new Error("timeout")
          }),
        ]).finally(() => clearTimeout(accountTimer!))
        if (token) {
          process.env["AX_CODE_CONSOLE_TOKEN"] = token
          Env.set("AX_CODE_CONSOLE_TOKEN", token)
        }

        if (config) {
          // Account config comes from the user's authenticated
          // console over HTTPS. Unlike project configs (which any
          // contributor can check in) and well-known configs (whose
          // URL can be poisoned via a compromised auth.json), the
          // console is an explicitly trusted upstream — the whole
          // point of the auth flow is to establish this channel.
          //
          // Specifically, account config legitimately references
          // `{env:AX_CODE_CONSOLE_TOKEN}` to thread the token the
          // auth flow just set into provider options. An untrusted
          // treatment would strip that env var (it contains "TOKEN")
          // and break the console integration entirely.
          //
          // If the console is ever compromised, the attacker has
          // much more powerful levers (model routing, tool
          // permissions, MCP server install) than reading
          // `/etc/shadow` via `{file:}`, so confining file refs
          // here isn't the right mitigation anyway.
          result = mergeConfigConcatArrays(
            result,
            await load(JSON.stringify(config), {
              dir: Instance.directory,
              source: `${active.url}/api/config`,
            }),
          )
        }
      } catch (err: unknown) {
        log.debug("failed to fetch remote account config", {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Load managed config files last (highest priority) - enterprise admin-controlled
    // Kept separate from directories array to avoid write operations when installing plugins
    // which would fail on system directories requiring elevated permissions
    // This way it only loads config file and not skills/plugins/commands
    const managedDir = getManagedDir()
    if (existsSync(managedDir)) {
      for (const file of ["ax-code.jsonc", "ax-code.json"]) {
        result = mergeConfigConcatArrays(result, await loadFile(path.join(managedDir, file)))
      }
    }

    // Migrate deprecated mode field to agent field
    for (const [name, mode] of Object.entries(result.mode ?? {})) {
      result.agent = mergeDeep(result.agent ?? {}, {
        [name]: {
          ...mode,
          mode: "primary" as const,
        },
      })
    }

    if (Flag.AX_CODE_PERMISSION) {
      try {
        const parsed = JSON.parse(Flag.AX_CODE_PERMISSION)
        const validated = ConfigSchema.Permission.safeParse(parsed)
        if (validated.success) {
          result.permission = mergeDeep(result.permission ?? {}, validated.data)
        } else {
          log.warn("AX_CODE_PERMISSION does not match permission schema, ignoring", {
            value: Flag.AX_CODE_PERMISSION,
            errors: validated.error.issues.map((i) => i.message),
          })
        }
      } catch {
        log.warn("invalid AX_CODE_PERMISSION JSON, ignoring", { value: Flag.AX_CODE_PERMISSION })
      }
    }

    // Backwards compatibility: legacy top-level `tools` config
    if (result.tools) {
      const perms: Record<string, Config.PermissionAction> = {}
      for (const [tool, enabled] of Object.entries(result.tools)) {
        const action: Config.PermissionAction = enabled ? "allow" : "deny"
        if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
          perms.edit = action
          continue
        }
        perms[tool] = action
      }
      result.permission = mergeDeep(perms, result.permission ?? {})
    }

    if (!result.username) result.username = os.userInfo().username

    // Handle migration from autoshare to share field
    if (result.autoshare === true && !result.share) {
      result.share = "auto"
    }

    // Apply flag overrides for compaction settings
    if (Flag.AX_CODE_DISABLE_AUTOCOMPACT) {
      result.compaction = { ...result.compaction, auto: false }
    }
    if (Flag.AX_CODE_DISABLE_PRUNE) {
      result.compaction = { ...result.compaction, prune: false }
    }

    result.plugin = deduplicatePlugins(result.plugin ?? [])

    return {
      config: result,
      directories,
      deps,
    }
  })

  export async function waitForDependencies() {
    const deps = await state().then((x) => x.deps)
    await withTimeout(Promise.all(deps), 60_000, "config dependency installation timed out after 60s")
  }

  export async function installDependencies(dir: string) {
    const pkg = path.join(dir, "package.json")
    const targetVersion = Installation.isLocal() ? "*" : Installation.VERSION

    // Acquire install lock before read-modify-write to prevent races
    using _ = await Lock.write("bun-install")

    const json = await Filesystem.readJson<{ dependencies?: Record<string, string> }>(pkg).catch(() => ({
      dependencies: {},
    }))
    json.dependencies = {
      ...json.dependencies,
      "@ax-code/plugin": targetVersion,
    }
    await Filesystem.writeJson(pkg, json)

    const gitignore = path.join(dir, ".gitignore")
    const hasGitIgnore = await Filesystem.exists(gitignore)
    if (!hasGitIgnore)
      await Filesystem.write(gitignore, ["node_modules", "package.json", "bun.lock", ".gitignore"].join("\n"))
    await BunProc.run(["install", ...BunProc.installCacheWorkaroundArgs()], { cwd: dir }).catch((err) => {
      if (err instanceof Process.RunFailedError) {
        const detail = {
          dir,
          cmd: err.cmd,
          code: err.code,
          stdout: err.stdout.toString(),
          stderr: err.stderr.toString(),
        }
        if (Flag.AX_CODE_STRICT_CONFIG_DEPS) {
          log.error("failed to install dependencies", detail)
          throw err
        }
        log.warn("failed to install dependencies", detail)
        return
      }

      if (Flag.AX_CODE_STRICT_CONFIG_DEPS) {
        log.error("failed to install dependencies", { dir, error: err })
        throw err
      }
      log.warn("failed to install dependencies", { dir, error: err })
    })
  }

  async function isWritable(dir: string) {
    try {
      await fs.access(dir, constants.W_OK)
      return true
    } catch {
      return false
    }
  }

  export async function needsInstall(dir: string) {
    // Some config dirs may be read-only.
    // Installing deps there will fail; skip installation in that case.
    const writable = await isWritable(dir)
    if (!writable) {
      log.debug("config dir is not writable, skipping dependency install", { dir })
      return false
    }

    const nodeModules = path.join(dir, "node_modules")
    if (!existsSync(nodeModules)) return true

    const pkg = path.join(dir, "package.json")
    const pkgExists = await Filesystem.exists(pkg)
    if (!pkgExists) return true

    const parsed = await Filesystem.readJson<{ dependencies?: Record<string, string> }>(pkg).catch(() => null)
    const dependencies = parsed?.dependencies ?? {}
    const depVersion = dependencies["@ax-code/plugin"]
    if (!depVersion) return true

    const targetVersion = Installation.isLocal() ? "*" : Installation.VERSION
    if (targetVersion === "latest") {
      const isOutdated = await PackageRegistry.isOutdated("@ax-code/plugin", depVersion, dir)
      if (!isOutdated) return false
      log.info("Cached version is outdated, proceeding with install", {
        pkg: "@ax-code/plugin",
        cachedVersion: depVersion,
      })
      return true
    }
    if (depVersion === targetVersion) return false
    return true
  }

  function rel(item: string, patterns: string[]) {
    const normalizedItem = item.replaceAll("\\", "/")
    for (const pattern of patterns) {
      const index = normalizedItem.indexOf(pattern)
      if (index === -1) continue
      return normalizedItem.slice(index + pattern.length)
    }
  }

  function trim(file: string) {
    const ext = path.extname(file)
    return ext.length ? file.slice(0, -ext.length) : file
  }

  async function loadCommand(dir: string) {
    const result: Record<string, Command> = {}
    for (const item of await Glob.scan("{command,commands}/**/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse command ${item}`
        const { Session } = await import("@/session")
        Bus.publishDetached(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load command", { command: item, err })
        return undefined
      })
      if (!md) continue

      const patterns = ["/.ax-code/command/", "/.ax-code/commands/", "/command/", "/commands/"]
      const file = rel(item, patterns) ?? path.basename(item)
      const name = trim(file)

      const config = {
        name,
        ...md.data,
        template: md.content.trim(),
      }
      const parsed = Command.safeParse(config)
      if (parsed.success) {
        result[config.name] = parsed.data
        continue
      }
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }

  async function loadAgent(dir: string) {
    const result: Record<string, Agent> = {}

    for (const item of await Glob.scan("{agent,agents}/**/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse agent ${item}`
        const { Session } = await import("@/session")
        Bus.publishDetached(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load agent", { agent: item, err })
        return undefined
      })
      if (!md) continue

      const patterns = ["/.ax-code/agent/", "/.ax-code/agents/", "/agent/", "/agents/"]
      const file = rel(item, patterns) ?? path.basename(item)
      const agentName = trim(file)

      const config = {
        name: agentName,
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result[config.name] = parsed.data
        continue
      }
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }

  async function loadMode(dir: string) {
    const result: Record<string, Agent> = {}
    for (const item of await Glob.scan("{mode,modes}/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse mode ${item}`
        const { Session } = await import("@/session")
        Bus.publishDetached(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load mode", { mode: item, err })
        return undefined
      })
      if (!md) continue

      const config = {
        name: path.basename(item, ".md"),
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result[config.name] = {
          ...parsed.data,
          mode: "primary" as const,
        }
        continue
      }
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }

  async function loadPlugin(dir: string) {
    const plugins: string[] = []

    for (const item of await Glob.scan("{plugin,plugins}/*.{ts,js}", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      plugins.push(pathToFileURL(item).href)
    }
    return plugins
  }

  function isLocalFilePlugin(plugin: string, dir: string) {
    if (!plugin.startsWith("file://")) return false
    try {
      return Filesystem.contains(dir, fileURLToPath(plugin))
    } catch {
      return false
    }
  }

  /**
   * Extracts a canonical plugin name from a plugin specifier.
   * - For file:// URLs: extracts filename without extension
   * - For npm packages: extracts package name without version
   *
   * @example
   * getPluginName("file:///path/to/plugin/foo.js") // "foo"
   * getPluginName("oh-my-ax-code@2.4.3") // "oh-my-ax-code"
   * getPluginName("@scope/pkg@1.0.0") // "@scope/pkg"
   */
  export function getPluginName(plugin: string): string {
    if (plugin.startsWith("file://")) {
      return path.parse(new URL(plugin).pathname).name
    }
    const lastAt = plugin.lastIndexOf("@")
    if (lastAt > 0) {
      return plugin.substring(0, lastAt)
    }
    return plugin
  }

  /**
   * Deduplicates plugins by name, with later entries (higher priority) winning.
   * Priority order (highest to lowest):
   * 1. Local plugin/ directory
   * 2. Local ax-code.json
   * 3. Global plugin/ directory
   * 4. Global ax-code.json
   *
   * Since plugins are added in low-to-high priority order,
   * we reverse, deduplicate (keeping first occurrence), then restore order.
   */
  export function deduplicatePlugins(plugins: string[]): string[] {
    // seenNames: canonical plugin names for duplicate detection
    // e.g., "oh-my-ax-code", "@scope/pkg"
    const seenNames = new Set<string>()

    // uniqueSpecifiers: full plugin specifiers to return
    // e.g., "oh-my-ax-code@2.4.3", "file:///path/to/plugin.js"
    const uniqueSpecifiers: string[] = []

    for (const specifier of plugins.toReversed()) {
      const name = getPluginName(specifier)
      if (!seenNames.has(name)) {
        seenNames.add(name)
        uniqueSpecifiers.push(specifier)
      }
    }

    return uniqueSpecifiers.toReversed()
  }

  // Config schemas — defined in config/schema.ts, re-exported here for namespace access
  export const McpLocal = ConfigSchema.McpLocal
  export const McpOAuth = ConfigSchema.McpOAuth
  export type McpOAuth = ConfigSchema.McpOAuth
  export const McpRemote = ConfigSchema.McpRemote
  export const Mcp = ConfigSchema.Mcp
  export type Mcp = ConfigSchema.Mcp
  export const PermissionAction = ConfigSchema.PermissionAction
  export type PermissionAction = ConfigSchema.PermissionAction
  export const PermissionObject = ConfigSchema.PermissionObject
  export type PermissionObject = ConfigSchema.PermissionObject
  export const PermissionRule = ConfigSchema.PermissionRule
  export type PermissionRule = ConfigSchema.PermissionRule
  export const Permission = ConfigSchema.Permission
  export type Permission = ConfigSchema.Permission
  export const Command = ConfigSchema.Command
  export type Command = ConfigSchema.Command
  export const Skills = ConfigSchema.Skills
  export type Skills = ConfigSchema.Skills
  export const Agent = ConfigSchema.Agent
  export type Agent = ConfigSchema.Agent
  export const Keybinds = ConfigSchema.Keybinds
  export const Server = ConfigSchema.Server
  export const Layout = ConfigSchema.Layout
  export type Layout = ConfigSchema.Layout
  export const Provider = ConfigSchema.Provider
  export type Provider = ConfigSchema.Provider
  export const Info = ConfigSchema.Info
  export type Info = ConfigSchema.Info

  export const global = lazy(async () => {
    let result: Info = pipe(
      {},
      mergeDeep(await loadFile(path.join(Global.Path.config, "config.json"))),
      mergeDeep(await loadFile(path.join(Global.Path.config, "ax-code.json"))),
      mergeDeep(await loadFile(path.join(Global.Path.config, "ax-code.jsonc"))),
    )

    const legacy = path.join(Global.Path.config, "config")
    if (existsSync(legacy)) {
      await import(pathToFileURL(legacy).href, {
        with: {
          type: "toml",
        },
      })
        .then(async (mod) => {
          const { provider, model, ...rest } = mod.default
          if (provider && model) result.model = `${provider}/${model}`
          result["$schema"] = CONFIG_SCHEMA_URL
          result = mergeDeep(result, rest)
          await Filesystem.writeJson(path.join(Global.Path.config, "config.json"), result)
          await fs.unlink(legacy)
        })
        // Log migration failures — a silent swallow leaves the user stuck
        // on the legacy TOML file with no indication that the migration
        // did not run. The legacy file is intentionally NOT deleted on
        // failure so the next startup can retry the migration.
        .catch((err) => log.error("legacy toml config migration failed", { legacy, err }))
    }

    return result
  })

  export const { readFile } = ConfigPaths

  async function loadFile(filepath: string, opts?: { trusted?: boolean }): Promise<Info> {
    log.info("loading", { path: filepath })
    const text = await readFile(filepath)
    if (!text) return {}
    return load(text, { path: filepath, trusted: opts?.trusted })
  }

  async function load(
    text: string,
    options: ({ path: string } | { dir: string; source: string }) & { trusted?: boolean },
  ) {
    const original = text
    const source = "path" in options ? options.path : options.source
    const isFile = "path" in options
    // Trust defaults to true for backward compatibility. Call sites
    // loading untrusted sources (project-level configs inside the
    // worktree, remote well-known configs, network account configs)
    // pass `trusted: false` explicitly — see the loader below and
    // the remote/account paths in state().
    const data = await ConfigPaths.parseText(
      text,
      "path" in options ? options.path : { source: options.source, dir: options.dir },
      { trusted: options.trusted },
    )

    const normalized = (() => {
      if (!data || typeof data !== "object" || Array.isArray(data)) return data
      const copy = { ...(data as Record<string, unknown>) }
      const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
      if (!hadLegacy) return copy
      delete copy.theme
      delete copy.keybinds
      delete copy.tui
      log.warn("tui keys in ax-code config are deprecated; move them to tui.json", { path: source })
      return copy
    })()

    const parsed = Info.safeParse(normalized)
    if (parsed.success) {
      if (!parsed.data.$schema && isFile) {
        parsed.data.$schema = CONFIG_SCHEMA_URL
        const updated = original.replace(/^\s*\{/, `{\n  "$schema": "${CONFIG_SCHEMA_URL}",`)
        // Log write failures — a silent `.catch(() => {})` leaves the
        // user staring at a config that keeps getting "$schema" added
        // on every load but never persisted (e.g. permission denied).
        // The operation is not critical so we do not throw; the next
        // start will retry.
        await Filesystem.write(options.path, updated).catch((err) =>
          log.warn("failed to persist auto-injected $schema", { path: options.path, err }),
        )
      }
      const data = parsed.data
      if (data.plugin && isFile) {
        for (let i = 0; i < data.plugin.length; i++) {
          const plugin = data.plugin[i]
          try {
            data.plugin[i] = import.meta.resolve!(plugin, options.path)
          } catch (e) {
            try {
              // import.meta.resolve sometimes fails with newly created node_modules
              const require = createRequire(options.path)
              const resolvedPath = require.resolve(plugin)
              data.plugin[i] = pathToFileURL(resolvedPath).href
            } catch (err) {
              // Plugin may legitimately be a generic string identifier
              // like "mcp-server" that the plugin loader resolves later.
              // Log at debug so misspelled plugin paths can still be
              // diagnosed by the user (previous empty catch left them
              // wondering why their plugin never loaded).
              log.debug("plugin resolve failed — may be string identifier", {
                plugin,
                configPath: options.path,
                err,
              })
            }
          }
        }
      }
      if (data.plugin && options.trusted === false) {
        data.plugin = data.plugin.filter((plugin) => {
          if (plugin.startsWith("file://")) return true
          log.warn("ignoring unresolved package plugin from untrusted config", { plugin, source })
          return false
        })
      }
      return data
    }

    throw new InvalidError({
      path: source,
      issues: parsed.error.issues,
    })
  }
  export const { JsonError, InvalidError } = ConfigPaths

  export const ConfigDirectoryTypoError = NamedError.create(
    "ConfigDirectoryTypoError",
    z.object({
      path: z.string(),
      dir: z.string(),
      suggestion: z.string(),
    }),
  )

  export async function get() {
    return state().then((x) => x.config)
  }

  export async function getGlobal() {
    return global()
  }

  export async function update(config: Info) {
    const filepath = path.join(Instance.directory, "ax-code.json")
    using _ = await Lock.write(filepath)
    const existing = await loadFile(filepath)
    await Filesystem.writeJson(filepath, mergeConfigConcatArrays(existing, config))
    await Instance.reload({
      directory: Instance.directory,
    })
  }

  function globalConfigFile() {
    const candidates = ["ax-code.jsonc", "ax-code.json", "config.json"].map((file) =>
      path.join(Global.Path.config, file),
    )
    for (const file of candidates) {
      if (existsSync(file)) return file
    }
    return candidates[0]
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
  }

  function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
    if (!isRecord(patch)) {
      const edits = modify(input, path, patch, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      })
      return applyEdits(input, edits)
    }

    return Object.entries(patch).reduce((result, [key, value]) => {
      if (value === undefined) return result
      return patchJsonc(result, value, [...path, key])
    }, input)
  }

  function parseConfig(text: string, filepath: string): Info {
    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      const lines = text.split("\n")
      const errorDetails = errors
        .map((e) => {
          const beforeOffset = text.substring(0, e.offset).split("\n")
          const line = beforeOffset.length
          const column = beforeOffset[beforeOffset.length - 1].length + 1
          const problemLine = lines[line - 1]

          const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
          if (!problemLine) return error

          return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
        })
        .join("\n")

      throw new JsonError({
        path: filepath,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
      })
    }

    const parsed = Info.safeParse(data)
    if (parsed.success) return parsed.data

    throw new InvalidError({
      path: filepath,
      issues: parsed.error.issues,
    })
  }

  export async function updateGlobal(config: Info) {
    const filepath = globalConfigFile()
    using _ = await Lock.write(filepath)
    const before = await Filesystem.readText(filepath).catch((err: any) => {
      if (err.code === "ENOENT") return "{}"
      throw new JsonError({ path: filepath }, { cause: err })
    })

    const next = await (async () => {
      if (!filepath.endsWith(".jsonc")) {
        const existing = parseConfig(before, filepath)
        const merged = mergeDeep(existing, config)
        await Filesystem.writeJson(filepath, merged)
        return merged
      }

      const updated = patchJsonc(before, config)
      const merged = parseConfig(updated, filepath)
      await Filesystem.write(filepath, updated)
      return merged
    })()

    global.reset()

    await Instance.disposeAll().catch((err) => {
      log.error("failed to dispose instances during config reload", { err })
      throw err
    })

    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Event.Disposed.type,
        properties: {},
      },
    })

    return next
  }

  export async function directories() {
    return state().then((x) => x.directories)
  }
}
