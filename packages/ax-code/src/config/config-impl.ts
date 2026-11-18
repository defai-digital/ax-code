import { RoutePolicy } from "../provider/route-policy"
import { Log } from "../util/log"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { createRequire } from "module"
import os from "os"
import z from "zod"
import { toErrorMessage } from "@/util/error-message"
import { mergeDeep, pipe, unique } from "remeda"
import { Global } from "../global"
import fs from "fs/promises"
import { lazy } from "../util/lazy"
import { NamedError } from "@ax-code/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import { applyEdits, modify } from "jsonc-parser"
import { changedJsoncPatch, JSONC_UNCHANGED, patchJsonc } from "@/util/jsonc"
import { Instance } from "../project/instance"
import { BunProc } from "@/bun"
import { NpmManager, packageManagerKind } from "@/bun/package-manager"
import { Installation } from "@/installation"
import { ConfigMarkdown } from "./markdown"
import { constants, existsSync } from "fs"
import { GlobalBus } from "@/bus/global"
import { NativePerf } from "@/perf/native"
import { RuntimeEvent } from "@/runtime/events"
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
import { isRecord } from "../util/record"
import { FeatureFlag } from "../util/feature-flags"
import { ScopedFlag } from "../flag/scoped"
import { parseJsonResult } from "../util/json-value"
import { FileCommand } from "../command/file-command"
import * as WebMcpLaunch from "@/mcp/webmcp-launch"
// Single source of truth for the public config schema URL. Written into
// every user's ax-code.json on first load, into legacy-TOML migrations,
// and into remote wellknown configs that omit `$schema`. See issue #17.
import { CONFIG_SCHEMA_URL } from "@/constants/project"
import { ProjectConfigTrust } from "./project-config-trust"
import { isFileUrl } from "../util/file-url"
import { mergeConfig, migrateDeprecatedModeIntoAgent } from "./merge-policy"
import { editConfigFile, editConfigFileWithRollback, parseConfig } from "./file-update"
import { restrictUntrustedAgent, restrictUntrustedConfig, tightenIsolationFloor } from "./untrusted-policy"

const PROGRAM_DATA_FALLBACK_DIR = "C:\\ProgramData"
const UNIX_SYSTEM_CONFIG_DIR = "/etc/ax-code"
const PLATFORM_CONFIG_DIR = "ax-code"
const DEPENDENCY_INSTALL_FAILURE_MARKER = ".ax-code-dependencies-install-failed"

const DANGEROUS_WELLKNOWN_ENV_KEYS = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "ELECTRON_RUN_AS_NODE",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "RUBYOPT",
  "BASH_ENV",
  "IFS",
  "PERL5OPT",
  "CLASSPATH",
  "PATH",
  "SHELL",
  "HOME",
])

export namespace Config {
  const log = Log.create({ service: "config" })

  export const McpSourceKind = z.enum([
    "wellknown",
    "global",
    "custom",
    "project",
    "config_directory",
    "inline",
    "account",
    "managed",
    "runtime",
    "unknown",
  ])
  export type McpSourceKind = z.infer<typeof McpSourceKind>
  export const McpSource = z.object({
    kind: McpSourceKind,
    trustedByDefault: z.boolean(),
    path: z.string().optional(),
    url: z.string().optional(),
  })
  export type McpSource = z.infer<typeof McpSource>

  export function trustedMcpSource(kind: McpSourceKind, extra: Omit<McpSource, "kind" | "trustedByDefault"> = {}) {
    return {
      kind,
      trustedByDefault: true,
      ...extra,
    } satisfies McpSource
  }

  function untrustedMcpSource(kind: McpSourceKind, extra: Omit<McpSource, "kind" | "trustedByDefault"> = {}) {
    return {
      kind,
      trustedByDefault: false,
      ...extra,
    } satisfies McpSource
  }

  export type PermissionEnvParseResult =
    | {
        ok: true
        permission: ConfigSchema.Permission
      }
    | {
        ok: false
        reason: "json"
      }
    | {
        ok: false
        reason: "schema"
        errors: string[]
      }

  export function decodePermissionEnvValue(value: unknown): PermissionEnvParseResult {
    const validated = ConfigSchema.Permission.safeParse(value)
    if (validated.success) return { ok: true, permission: validated.data }
    return {
      ok: false,
      reason: "schema",
      errors: validated.error.issues.map((issue) => issue.message),
    }
  }

  export function parsePermissionEnv(value: string): PermissionEnvParseResult {
    const parsed = parseJsonResult(value)
    if (!parsed.ok) {
      return { ok: false, reason: "json" }
    }

    return decodePermissionEnvValue(parsed.value)
  }

  // Managed settings directory for enterprise deployments (highest priority, admin-controlled)
  // These settings override all user and project settings
  function systemManagedConfigDir(): string {
    switch (process.platform) {
      case "darwin":
        return "/Library/Application Support/ax-code"
      case "win32":
        return path.join(process.env.ProgramData || PROGRAM_DATA_FALLBACK_DIR, PLATFORM_CONFIG_DIR)
      default:
        return UNIX_SYSTEM_CONFIG_DIR
    }
  }

  // Test-only seam: unit tests point the managed directory at fixtures. This
  // is plain module state, deliberately not an env override: anyone who can
  // set process env — including the managed user the policy constrains —
  // could otherwise self-grant managed-only opt-ins, or neutralize an admin
  // deny by pointing the override at an empty directory. Production never
  // calls the setter, so only in-process test code can redirect the directory.
  let testManagedConfigDir: string | undefined
  export function __setTestManagedConfigDir(dir: string | undefined) {
    testManagedConfigDir = dir
  }

  export function managedConfigDir() {
    return testManagedConfigDir ?? systemManagedConfigDir()
  }

  // Lazy — not cached at import time so tests that set the seam after import
  // take effect.
  function getManagedDir() {
    return managedConfigDir()
  }

  export const state = Instance.cache(() => NativePerf.runAsync("config.load", undefined, loadState))

  async function loadState() {
    const auth = await NativePerf.runAsync("config.load.auth", undefined, () => Auth.all())
    const mcpSources: Record<string, McpSource> = {}

    function recordMcpSources(config: Info, source: McpSource) {
      if (!config.mcp) return
      for (const key of Object.keys(config.mcp)) {
        const existing = mcpSources[key]
        // Trust is keyed by server *name*, and every source in the merge order
        // folds fields into the same merged entry, so an entry's trust has to
        // reflect the least-trusted source that shaped it. Recording the last
        // mention let a later trusted source (the user's own global, inline or
        // config-directory entry) vouch for a `command` or `environment` a
        // repository source contributed — the trust gate short-circuits on a
        // trusted source without ever consulting the fingerprint. Keep the
        // first mention, downgraded by any untrusted one.
        if (!existing || (existing.trustedByDefault && !source.trustedByDefault)) mcpSources[key] = source
      }
    }

    // The WebMCP requirement is managed-only: a project, user, remote or
    // inline source must not be able to set or loosen it. Strip it from every
    // non-managed source before merging so only the managed directory (loaded
    // last, highest precedence) can carry it.
    function withoutWebmcpRequirement(source: McpSource, config: Info): Info {
      if (config.webmcp === undefined) return config
      // A non-managed author may believe they tightened the bridge (for
      // example `{"webmcp": {"allow": false}}` in a project file). Say so
      // loudly instead of silently ignoring the requirement.
      log.warn("webmcp requirement is managed-only; ignoring requirement from non-managed source", {
        command: "config.load",
        status: "ignored",
        kind: source.kind,
        path: source.path,
        url: source.url,
      })
      const copy = { ...config }
      delete copy.webmcp
      return copy
    }

    /**
     * Repository-controlled source kinds that the out-of-band project trust
     * opt-in promotes to trusted. Their descriptor stays `untrusted` so the
     * source is still reported as repository-controlled, but every untrusted
     * filter step — including the floor below — steps aside.
     */
    const OPT_IN_TRUSTED_KINDS = new Set(["project", "config_directory"])

    function sourceTrustedForFloor(source: McpSource) {
      if (source.trustedByDefault) return true
      return OPT_IN_TRUSTED_KINDS.has(source.kind) && ProjectConfigTrust.enabled()
    }

    let managedCodeModeDisabled = false
    let managedRewriteDisabled = false
    let managedAutoAcceptDisabled = false
    const managedPermissions: Permission[] = []
    const permissionLayers: Permission[] = []
    let samplingDisabled = false
    let samplingTokenCeiling = Infinity

    function mergeFromSource(source: McpSource, config: Info) {
      recordMcpSources(config, source)
      if (source.kind === "managed" && config.permission) managedPermissions.push(config.permission)
      let scoped = source.kind === "managed" ? config : withoutWebmcpRequirement(source, config)
      if (scoped.mcp_sampling && !source.trustedByDefault && ["project", "config_directory"].includes(source.kind)) {
        // Project trust authorizes local configuration, not additional model spending.
        const ceiling = result.mcp_sampling
        scoped = {
          ...scoped,
          mcp_sampling: {
            enabled: ceiling?.enabled === true && scoped.mcp_sampling.enabled !== false,
            max_tokens: Math.min(ceiling?.max_tokens ?? 2000, scoped.mcp_sampling.max_tokens ?? Infinity),
          },
        }
        samplingDisabled ||= scoped.mcp_sampling!.enabled === false
        samplingTokenCeiling = Math.min(samplingTokenCeiling, scoped.mcp_sampling!.max_tokens!)
      }
      if (source.kind === "managed" && scoped.mcp_sampling) {
        samplingDisabled ||= scoped.mcp_sampling.enabled === false
        samplingTokenCeiling = Math.min(samplingTokenCeiling, scoped.mcp_sampling.max_tokens ?? Infinity)
      }
      // Repository/remote settings and managed ceilings may restrict user grants,
      // but cannot turn a connected provider into an automatic recovery target.
      if (scoped.llm_routing && !["global", "custom", "inline"].includes(source.kind)) {
        scoped = { ...scoped, llm_routing: RoutePolicy.narrow(result.llm_routing, scoped.llm_routing) }
      }
      // Only user config and trusted project-local sources may enable auto-accept.
      if (config.permission?.auto_accept !== undefined) {
        if (source.kind === "managed" && config.permission.auto_accept === false) managedAutoAcceptDisabled = true
        const mayEnable =
          ["global", "custom", "project", "config_directory"].includes(source.kind) && sourceTrustedForFloor(source)
        if (!mayEnable) {
          const permission = { ...scoped.permission }
          delete permission.auto_accept
          scoped = { ...scoped, permission }
        }
      }
      // Code Mode is an explicit trusted opt-in. Managed false is sticky.
      if (source.kind === "managed" && config.code_mode?.enabled === false) managedCodeModeDisabled = true
      if (managedCodeModeDisabled) scoped = { ...scoped, code_mode: { ...scoped.code_mode, enabled: false } }
      // Managed false is a ceiling even across multiple managed files.
      if (source.kind === "managed" && config.hooks?.allow_input_rewrite === false) managedRewriteDisabled = true
      if (managedRewriteDisabled) scoped = { ...scoped, hooks: { ...scoped.hooks, allow_input_rewrite: false } }
      if (!sourceTrustedForFloor(source)) scoped = tightenIsolationFloor(result, scoped)
      if (scoped.permission) permissionLayers.push(scoped.permission)
      result = mergeConfig(result, migrateDeprecatedModeIntoAgent(scoped), {
        authority: source.kind === "managed",
      })
    }

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
        if (DANGEROUS_WELLKNOWN_ENV_KEYS.has(value.key)) {
          log.warn("ignoring wellknown auth with dangerous env var name", {
            command: "config.load",
            status: "error",
            errorCode: "DANGEROUS_ENV_VAR",
            key: value.key,
            url: key,
          })
          continue
        }
        FeatureFlag.set(value.key, value.token)
        wellknownEntries.push({ url, key: value.key, token: value.token })
      }
    }
    const wellknownPromise = Promise.all(
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
          // Keep this short: the fetch sits on the Config.get() critical path
          // (so effectively on every command's startup). Share a single time
          // budget across primary + legacy fallback so worst-case is bounded.
          const WELLKNOWN_TIMEOUT_MS = 1_500
          const deadline = Date.now() + WELLKNOWN_TIMEOUT_MS
          const remaining = () => Math.max(1, deadline - Date.now())
          const response = await Ssrf.pinnedFetch(endpoint, { signal: AbortSignal.timeout(remaining()) })
            .then((res) => {
              if (res.ok || res.status !== 404) return res
              return Ssrf.pinnedFetch(legacy, { signal: AbortSignal.timeout(remaining()) })
            })
            .catch(() => Ssrf.pinnedFetch(legacy, { signal: AbortSignal.timeout(remaining()) }))
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
          return { loaded, source: untrustedMcpSource("wellknown", { url }) }
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
    const wellknownConfigs = await NativePerf.runAsync(
      "config.load.wellknown",
      wellknownEntries.length,
      () => wellknownPromise,
    )
    for (const cfg of wellknownConfigs) {
      if (cfg) mergeFromSource(cfg.source, cfg.loaded)
    }

    // Global user config overrides remote config.
    mergeFromSource(
      trustedMcpSource("global", { path: Global.Path.config }),
      await NativePerf.runAsync("config.load.global", undefined, () => global()),
    )

    // Custom config path overrides global config.
    if (Flag.AX_CODE_CONFIG) {
      mergeFromSource(trustedMcpSource("custom", { path: Flag.AX_CODE_CONFIG }), await loadFile(Flag.AX_CODE_CONFIG))
      log.debug("loaded custom config", { command: "config.load", status: "ok", path: Flag.AX_CODE_CONFIG })
    }

    // Project config overrides global and remote config.
    if (!Flag.AX_CODE_DISABLE_PROJECT_CONFIG) {
      const projectFiles = await NativePerf.runAsync("config.load.projectFiles", undefined, () =>
        ConfigPaths.projectFiles("ax-code", Instance.directory, Instance.worktree),
      )
      // Project configs live inside the worktree and may be checked
      // in by anyone — treat them as untrusted so a malicious
      // `ax-code.json` committed to a shared repo cannot read files
      // outside the config's directory.
      const configs = await Promise.allSettled(
        projectFiles.map((file) => loadFile(file, { trusted: false, projectTrust: true })),
      )
      for (let index = 0; index < configs.length; index++) {
        const cfg = configs[index]
        const filepath = projectFiles[index]
        if (cfg?.status === "fulfilled") {
          mergeFromSource(untrustedMcpSource("project", { path: filepath }), cfg.value)
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

    const directories = await NativePerf.runAsync("config.load.directories", undefined, () =>
      ConfigPaths.directories(Instance.directory, Instance.worktree),
    )

    // .ax-code directory config overrides (project and global) config sources.
    if (Flag.AX_CODE_CONFIG_DIR) {
      log.debug("loading config from AX_CODE_CONFIG_DIR", {
        command: "config.load",
        status: "started",
        path: Flag.AX_CODE_CONFIG_DIR,
      })
    }

    const deps = []

    // Load all directories in parallel. Each directory's config files,
    // commands, agents, modes, and plugins are independent I/O and can
    // run concurrently. Merge results sequentially afterwards to
    // preserve precedence order (lower-priority directories first).
    // Keep each directory at its LAST position: a later entry overrides an
    // earlier one, so AX_CODE_CONFIG_DIR naming a directory already in the
    // list must keep its top precedence instead of its first, lower slot.
    const uniqueDirs = unique(directories.toReversed()).toReversed()
    const dirResults = await Promise.all(
      uniqueDirs.map(async (dir) => {
        // Directories come from three sources: Global.Path.config
        // (trusted), user home walk (trusted), worktree walk
        // (untrusted). Only `.ax-code` dirs *inside the worktree*
        // carry code committed by third parties, so they're the ones
        // we need to confine.
        const inWorktree = Filesystem.contains(Instance.worktree, dir)
        const isUserConfigDir = dir === Global.Path.config || dir === Flag.AX_CODE_CONFIG_DIR
        const trusted = !inWorktree || isUserConfigDir
        const dependencyManaged = !inWorktree || isUserConfigDir
        const isConfigDir = dir.endsWith(".ax-code") || dir === Flag.AX_CODE_CONFIG_DIR

        // Parallel load of all independent I/O within this directory
        const configFiles = isConfigDir ? ["ax-code.json", "ax-code.jsonc"] : []
        const projectCodeTrusted = trusted || ProjectConfigTrust.enabled()
        const [loadedConfigs, command, agent, mode, pluginFiles] = await Promise.all([
          Promise.allSettled(
            configFiles.map(async (file) => {
              log.debug(`loading config from ${path.join(dir, file)}`)
              return loadFile(path.join(dir, file), {
                trusted,
                projectTrust: inWorktree && !isUserConfigDir,
              })
            }),
          ).then((results) =>
            results.map((result, index) => {
              if (result.status === "fulfilled") return result.value
              // A malformed directory config (possibly committed by anyone)
              // must degrade like a malformed root project config: warn and
              // skip, never abort the whole config load.
              log.warn("failed to load config file", {
                command: "config.load",
                status: "error",
                path: path.join(dir, configFiles[index]!),
                error: result.reason,
              })
              return {} as Info
            }),
          ),
          loadCommand(dir, inWorktree && !isUserConfigDir ? "project" : "config", projectCodeTrusted),
          loadAgent(dir, projectCodeTrusted),
          loadMode(dir, projectCodeTrusted),
          projectCodeTrusted ? loadPlugin(dir) : Promise.resolve([]),
        ])

        const configuredPlugins: string[] = []
        for (const loaded of loadedConfigs) {
          configuredPlugins.push(...(loaded.plugin ?? []))
        }

        return {
          dir,
          trusted,
          dependencyManaged,
          isConfigDir,
          loadedConfigs,
          configuredPlugins,
          command,
          agent,
          mode,
          pluginFiles,
        }
      }),
    )

    // Merge results sequentially to preserve precedence order
    for (const dr of dirResults) {
      if (dr.isConfigDir) {
        for (const loaded of dr.loadedConfigs) {
          mergeFromSource(
            dr.trusted
              ? trustedMcpSource("config_directory", { path: dr.dir })
              : untrustedMcpSource("config_directory", { path: dr.dir }),
            loaded,
          )
        }
        // to satisfy the type checker
        result.agent ??= {}
        result.mode ??= {}
        result.plugin ??= []
      }

      result.command = mergeDeep(result.command ?? {}, dr.command)
      result.agent = mergeDeep(result.agent, dr.agent)
      result.agent = mergeDeep(result.agent, dr.mode)
      // Reassign rather than push: `result.plugin` can alias the lazily-cached
      // global config's array (mergeDeep does not clone source-only arrays), so
      // an in-place push would mutate that shared array and leak discovered
      // plugins across directories / reloads.
      result.plugin = [...result.plugin, ...dr.pluginFiles]

      if (dr.dependencyManaged && (await hasLocalFilePlugin([...dr.configuredPlugins, ...dr.pluginFiles], dr.dir))) {
        const install = iife(async () => {
          const shouldInstall = await needsInstall(dr.dir)
          if (shouldInstall) await installDependencies(dr.dir)
        })
        // Nothing awaits this until plugin/tool startup calls
        // waitForDependencies (if ever); a failure before then must not
        // surface as an unhandled rejection. The waiter still sees it.
        install.catch((error) => log.warn("config dependency check failed", { dir: dr.dir, error }))
        deps.push(install)
      }
    }

    // Inline config content overrides all non-managed config sources.
    if (Flag.AX_CODE_CONFIG_CONTENT) {
      mergeFromSource(
        trustedMcpSource("inline"),
        await load(Flag.AX_CODE_CONFIG_CONTENT, {
          dir: Instance.directory,
          source: "AX_CODE_CONFIG_CONTENT",
          // AX_CODE_CONFIG_CONTENT is intentionally explicit config text from the caller,
          // so token expansion should behave like a trusted source.
          trusted: true,
        }),
      )
      log.debug("loaded custom config from AX_CODE_CONFIG_CONTENT", { command: "config.load", status: "ok" })
    }

    const active = await NativePerf.runAsync("config.load.account", undefined, () => Account.active())
    if (active?.active_org_id) {
      try {
        let accountTimer: ReturnType<typeof setTimeout>
        const accountTimeout = new Promise<never>((_, reject) => {
          accountTimer = setTimeout(() => reject(new Error("account config fetch timed out")), 5_000)
        })
        const [config, token] = await Promise.race([
          Promise.all([Account.config(active.id, active.active_org_id), Account.token(active.id)]),
          accountTimeout,
        ]).finally(() => clearTimeout(accountTimer!))
        if (token) {
          FeatureFlag.set("AX_CODE_CONSOLE_TOKEN", token)
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
          mergeFromSource(
            trustedMcpSource("account", { url: active.url }),
            await load(JSON.stringify(config), {
              dir: Instance.directory,
              source: `${active.url}/api/config`,
            }),
          )
        }
      } catch (err: unknown) {
        log.debug("failed to fetch remote account config", {
          error: toErrorMessage(err),
        })
      }
    }

    // Load managed config files last (highest priority) - enterprise admin-controlled
    // Kept separate from directories array to avoid write operations when installing plugins
    // which would fail on system directories requiring elevated permissions
    // This way it only loads config file and not skills/plugins/commands
    const managedDir = getManagedDir()
    if (existsSync(managedDir)) {
      for (const file of ["ax-code.json", "ax-code.jsonc"]) {
        const filepath = path.join(managedDir, file)
        mergeFromSource(trustedMcpSource("managed", { path: filepath }), await loadFile(filepath))
      }
    }

    // The deprecated top-level `mode` field is folded into `agent` per
    // source inside mergeFromSource (see migrateDeprecatedModeIntoAgent)
    // so precedence between sources is respected. `result.mode` itself is
    // left as the plain merged value for backward-compatible introspection.

    if (Flag.AX_CODE_PERMISSION) {
      const parsed = parsePermissionEnv(Flag.AX_CODE_PERMISSION)
      if (parsed.ok) {
        const { auto_accept: _ignoredAutoAccept, ...rules } = parsed.permission
        permissionLayers.push(rules)
        // The env override is an admin-authority layer like managed config:
        // its patterns must be evaluated last (last match wins) inside each
        // merged pattern map, which mergeDeep alone does not give. The env
        // shape is a flat permission map, so no agent/mode nesting applies.
        result.permission = mergeConfig(
          { permission: result.permission ?? {} },
          { permission: rules },
          { authority: true },
        ).permission
      } else if (parsed.reason === "schema") {
        log.warn("AX_CODE_PERMISSION does not match permission schema, ignoring", {
          value: Flag.AX_CODE_PERMISSION,
          errors: parsed.errors,
        })
      } else {
        log.warn("invalid AX_CODE_PERMISSION JSON, ignoring", { value: Flag.AX_CODE_PERMISSION })
      }
    }

    // The permission environment override is a ruleset source, not an opt-in.
    // Preserve the source-scoped switch and the managed ceiling after it merges.
    if (managedAutoAcceptDisabled) result.permission = { ...result.permission, auto_accept: false }

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
      result.permission = Object.assign(perms, result.permission)
    }

    if (!result.username) result.username = os.userInfo().username

    // Apply flag overrides for compaction settings
    if (Flag.AX_CODE_DISABLE_AUTOCOMPACT) {
      result.compaction = { ...result.compaction, auto: false }
    }
    if (Flag.AX_CODE_DISABLE_PRUNE) {
      result.compaction = { ...result.compaction, prune: false }
    }

    result.plugin = deduplicatePlugins(result.plugin ?? [])

    // Reconcile the autonomous runtime flag from config at load time so
    // non-server entrypoints (headless run, ACP, direct CLI) honor an
    // explicit `autonomous: false` the same way the /autonomous route does
    // for the TUI — previously only the HTTP route synced config into the
    // env, so headless runs ignored the setting. An explicit
    // AX_CODE_AUTONOMOUS env var always wins, and projects that don't set
    // the key keep the flag default (on).
    // An env managed by route/config reconciliation just mirrors whichever
    // directory wrote it last, so it must not block this directory's own
    // reconciliation; only a pristine user-set env keeps override semantics.
    if (
      (process.env["AX_CODE_AUTONOMOUS"] === undefined || ScopedFlag.isManaged("AX_CODE_AUTONOMOUS")) &&
      result.autonomous !== undefined
    ) {
      FeatureFlag.set("AX_CODE_AUTONOMOUS", result.autonomous !== false)
      // Also record per directory so runtime readers on a multi-directory
      // server don't inherit another project's env reconciliation.
      ScopedFlag.recordCurrent("AX_CODE_AUTONOMOUS", result.autonomous !== false)
    }

    // ADR-170: ship the WebMCP bridge pre-registered but disabled, so the
    // sidebar chip can enable it with one gesture — no config generation or
    // file edit first. Injected only when no configured entry carries a webmcp
    // profile and the product name is free. The injected entry has no recorded
    // source (mcpEntries resolves it as trusted "unknown") and is
    // enabled: false, so the startup bulk connect never launches it; the
    // config-source trust gate still governs every configured entry. ADR-171:
    // the default profile enables the read tier — the chip gesture enables the
    // bridge, and each origin's first read still prompts.
    const configured: unknown[] = Object.values(result.mcp ?? {})
    const hasWebmcpProfile = configured.some((entry) => isRecord(entry) && isRecord(entry.webmcp))
    if (!hasWebmcpProfile && result.mcp?.webmcp === undefined) {
      result.mcp = { ...result.mcp, webmcp: productDefaultWebMcpEntry() }
    }

    if (result.mcp_sampling) {
      result.mcp_sampling = {
        ...result.mcp_sampling,
        ...(samplingDisabled ? { enabled: false } : {}),
        max_tokens: Math.min(result.mcp_sampling.max_tokens ?? 2000, samplingTokenCeiling),
      }
    }

    return {
      config: result,
      managedAutoAcceptDisabled,
      managedPermissions,
      permissionLayers,
      directories,
      deps,
      mcpSources,
    }
  }

  export async function managedPermissions(): Promise<Permission[]> {
    return (await state()).managedPermissions
  }

  /** Preserve source boundaries so sampling grants cannot shadow another layer's denial. */
  export async function permissionLayers(): Promise<Permission[]> {
    return (await state()).permissionLayers
  }

  export async function autoAcceptManagedDisabled(): Promise<boolean> {
    return (await state()).managedAutoAcceptDisabled
  }

  export async function waitForDependencies() {
    const deps = await state().then((x) => x.deps)
    await withTimeout(Promise.all(deps), 60_000, "config dependency installation timed out after 60s")
  }

  function normalizeDependencyPackageJson(pkg: string, value: unknown) {
    if (!isRecord(value)) throw new Error(`Config package.json must be a JSON object in ${pkg}`)
    if (value.dependencies !== undefined && !isRecord(value.dependencies)) {
      throw new Error(`Config package.json dependencies must be a JSON object in ${pkg}`)
    }
    return value as Record<string, unknown> & { dependencies?: Record<string, string> }
  }

  export async function installDependencies(dir: string) {
    const pkg = path.join(dir, "package.json")
    const marker = path.join(dir, DEPENDENCY_INSTALL_FAILURE_MARKER)
    const targetVersion = Installation.isLocal() ? "*" : Installation.VERSION

    // Acquire install lock before read-modify-write to prevent races
    using _ = await Lock.write("bun-install")

    let packageJsonExisted = true
    const originalPackageJson = await fs.readFile(pkg, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        packageJsonExisted = false
        return undefined
      }
      throw error
    })
    const restorePackageJson = async (originalError: unknown) => {
      try {
        if (packageJsonExisted) {
          await Filesystem.write(pkg, originalPackageJson!)
        } else {
          await fs.unlink(pkg).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error
          })
        }
      } catch (restoreError) {
        log.error("failed to restore package.json after dependency setup failure", {
          dir,
          error: restoreError,
        })
        throw new AggregateError([originalError, restoreError], `Failed to install dependencies and restore ${pkg}`)
      }
    }
    const raw = packageJsonExisted ? await Filesystem.readJson<unknown>(pkg) : { dependencies: {} }
    const json = normalizeDependencyPackageJson(pkg, raw)
    json.dependencies = {
      ...json.dependencies,
      "@ax-code/plugin": targetVersion,
    }

    const gitignore = path.join(dir, ".gitignore")
    const hasGitIgnore = await Filesystem.exists(gitignore)
    if (!hasGitIgnore) {
      await Filesystem.write(
        gitignore,
        [
          "node_modules",
          "package.json",
          "bun.lock",
          "package-lock.json",
          DEPENDENCY_INSTALL_FAILURE_MARKER,
          ".gitignore",
        ].join("\n"),
      )
    } else {
      const ignore = await Filesystem.readText(gitignore)
      const entries = ignore.split(/\r?\n/)
      if (!entries.includes(DEPENDENCY_INSTALL_FAILURE_MARKER)) {
        await Filesystem.write(
          gitignore,
          `${ignore}${ignore.length > 0 && !ignore.endsWith("\n") ? "\n" : ""}${DEPENDENCY_INSTALL_FAILURE_MARKER}\n`,
        )
      }
    }
    await Filesystem.writeJson(pkg, json)
    // Create the failure marker before starting the package manager. It also
    // covers process crashes or forced termination during installation.
    await Filesystem.write(marker, `${targetVersion}\n`).catch(async (error) => {
      await restorePackageJson(error)
      throw error
    })
    try {
      await (packageManagerKind() === "npm"
        ? Process.run([NpmManager.executable, ...NpmManager.installArgs(dir)], { cwd: dir })
        : BunProc.run(["install", ...BunProc.installCacheWorkaroundArgs()], { cwd: dir }))
      await fs.unlink(marker).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error
      })
    } catch (err) {
      // Restore the declaration while leaving the failure marker in place.
      // needsInstall() will retry even if npm created a partial node_modules
      // tree or the prior declaration already named the target version.
      await restorePackageJson(err)

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
    }
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

    if (await Filesystem.exists(path.join(dir, DEPENDENCY_INSTALL_FAILURE_MARKER))) return true

    const nodeModules = path.join(dir, "node_modules")
    if (!existsSync(nodeModules)) return true

    const pkg = path.join(dir, "package.json")
    const pkgExists = await Filesystem.exists(pkg)
    if (!pkgExists) return true

    const raw = await Filesystem.readJson<unknown>(pkg)
    const parsed = normalizeDependencyPackageJson(pkg, raw)
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

  async function publishConfigLoadError(message: string) {
    const { Session } = await import("@/session")
    Session.publishError({ message })
  }

  type ConfigLoadKind = "command" | "agent" | "mode"

  async function loadMarkdownConfig(item: string, kind: ConfigLoadKind) {
    return ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse ${kind} ${item}`
      await publishConfigLoadError(message)
      log.error(`failed to load ${kind}`, { [kind]: item, err })
      return undefined
    })
  }

  async function isConfigDirectoryFile(dir: string, item: string) {
    const root = await fs.realpath(path.resolve(dir)).catch(() => path.resolve(dir))
    const resolved = await fs.realpath(path.resolve(item)).catch(() => undefined)
    return !!resolved && Filesystem.contains(root, resolved)
  }

  async function loadContainedMarkdownConfig(dir: string, item: string, kind: ConfigLoadKind) {
    if (!(await isConfigDirectoryFile(dir, item))) {
      log.warn("ignoring markdown config symlink outside config directory", { [kind]: item, dir })
      return undefined
    }
    return loadMarkdownConfig(item, kind)
  }

  async function loadCommand(dir: string, scope: FileCommand.Scope, trusted = true) {
    const result: Record<string, Command> = {}
    for (const item of await Glob.scan("{command,commands}/**/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await loadContainedMarkdownConfig(dir, item, "command")
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
        const fileCommand = await FileCommand.parse({
          name: config.name,
          location: item,
          sourceTool: "ax-code",
          scope,
          data: md.data as Record<string, unknown>,
          content: md.content,
        })
        result[config.name] = Command.parse({
          ...parsed.data,
          workflow: fileCommand.workflow,
          location: fileCommand.location,
          sourceTool: fileCommand.sourceTool,
          scope: fileCommand.scope,
          warnings: fileCommand.warnings,
          allowShell: trusted ? fileCommand.allowShell : false,
        })
        continue
      }
      log.warn("invalid command definition, skipping", { path: item, issues: parsed.error.issues })
    }
    return result
  }

  async function loadAgent(dir: string, trusted = true) {
    const result: Record<string, Agent> = {}

    for (const item of await Glob.scan("{agent,agents}/**/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await loadContainedMarkdownConfig(dir, item, "agent")
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
        result[config.name] = (trusted ? parsed.data : restrictUntrustedAgent(parsed.data)) as Agent
        continue
      }
      log.warn("invalid agent definition, skipping", { path: item, issues: parsed.error.issues })
    }
    return result
  }

  async function loadMode(dir: string, trusted = true) {
    const result: Record<string, Agent> = {}
    for (const item of await Glob.scan("{mode,modes}/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await loadContainedMarkdownConfig(dir, item, "mode")
      if (!md) continue

      const config = {
        name: path.basename(item, ".md"),
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        const mode = {
          ...parsed.data,
          mode: "primary" as const,
        }
        result[config.name] = (trusted ? mode : restrictUntrustedAgent(mode)) as Agent
        continue
      }
      log.warn("invalid mode definition, skipping", { path: item, issues: parsed.error.issues })
    }
    return result
  }

  async function loadPlugin(dir: string) {
    const plugins: string[] = []
    const root = await fs.realpath(path.resolve(dir)).catch(() => path.resolve(dir))

    for (const item of await Glob.scan("{plugin,plugins}/*.{ts,js}", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const resolved = await fs.realpath(path.resolve(item)).catch(() => undefined)
      if (!resolved || !Filesystem.contains(root, resolved)) {
        log.warn("ignoring plugin symlink outside config directory", { plugin: item, dir })
        continue
      }
      plugins.push(pathToFileURL(item).href)
    }
    return plugins
  }

  async function isLocalFilePlugin(plugin: string, dir: string) {
    if (!isFileUrl(plugin)) return false
    try {
      const pluginPath = fileURLToPath(plugin)
      const resolved = await fs.realpath(path.resolve(pluginPath))
      const root = await fs.realpath(path.resolve(dir)).catch(() => path.resolve(dir))
      return Filesystem.contains(root, resolved)
    } catch {
      return false
    }
  }

  async function hasLocalFilePlugin(plugins: string[], dir: string) {
    for (const plugin of plugins) {
      if (await isLocalFilePlugin(plugin, dir)) return true
    }
    return false
  }

  function resolvePluginSpecifier(plugin: string, configPath: string) {
    // Resolve relative to the config file's directory. Node's `import.meta.resolve`
    // ignores its second (parent) argument and returns a wrong path without
    // throwing; it would resolve against this module instead of the user's
    // config. `createRequire(configPath)` honors the config directory for both
    // relative paths and package names on Node and Bun.
    try {
      const require = createRequire(configPath)
      return { value: pathToFileURL(require.resolve(plugin)).href }
    } catch (err) {
      return { value: plugin, err }
    }
  }

  function isAllowedUntrustedPlugin(plugin: string, source: string) {
    log.warn("ignoring plugin from untrusted config", { plugin, source })
    return false
  }

  async function filterAllowedUntrustedPlugins(plugins: string[], source: string) {
    const allowed: string[] = []
    for (const plugin of plugins) {
      if (isAllowedUntrustedPlugin(plugin, source)) allowed.push(plugin)
    }
    return allowed
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
    if (isFileUrl(plugin)) {
      try {
        return path.parse(new URL(plugin).pathname).name
      } catch {
        return plugin
      }
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

  async function loadFile(filepath: string, opts?: { trusted?: boolean; projectTrust?: boolean }): Promise<Info> {
    log.info("loading", { path: filepath })
    const text = await readFile(filepath)
    if (!text) return {}
    return load(text, { path: filepath, trusted: opts?.trusted, projectTrust: opts?.projectTrust })
  }

  async function load(
    text: string,
    options: ({ path: string } | { dir: string; source: string }) & {
      trusted?: boolean
      projectTrust?: boolean
    },
  ) {
    const original = text
    const source = "path" in options ? options.path : options.source
    const isFile = "path" in options
    const trusted = options.trusted !== false || (options.projectTrust === true && ProjectConfigTrust.enabled())
    // Trust defaults to true for backward compatibility. Call sites
    // loading untrusted sources (project-level configs inside the
    // worktree, remote well-known configs, network account configs)
    // pass `trusted: false` explicitly — see the loader below and
    // the remote/account paths in state().
    const data = await ConfigPaths.parseText(
      text,
      "path" in options ? options.path : { source: options.source, dir: options.dir },
      { trusted },
    )

    const normalized = (() => {
      if (!isRecord(data)) return data
      const copy = { ...data }
      const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
      if (hadLegacy) {
        delete copy.theme
        delete copy.keybinds
        delete copy.tui
        log.warn("tui keys in ax-code config are deprecated; move them to tui.json", { path: source })
      }
      // Source trust is resolved by the loader; the policy only transforms data.
      // Remote sources never gain trust from the out-of-band project opt-in.
      return trusted ? copy : restrictUntrustedConfig(copy)
    })()

    const parsed = Info.safeParse(normalized)
    if (parsed.success) {
      if (!parsed.data.$schema && isFile) {
        parsed.data.$schema = CONFIG_SCHEMA_URL
        const updated = applyEdits(
          original,
          modify(original, ["$schema"], CONFIG_SCHEMA_URL, {
            formattingOptions: {
              insertSpaces: true,
              tabSize: 2,
            },
          }),
        )
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
          const resolved = resolvePluginSpecifier(data.plugin[i], options.path)
          data.plugin[i] = resolved.value
          if (resolved.err) {
            log.debug("plugin resolve failed — may be string identifier", {
              plugin: data.plugin[i],
              configPath: options.path,
              err: resolved.err,
            })
          }
        }
      }
      if (data.plugin && !trusted) {
        data.plugin = await filterAllowedUntrustedPlugins(data.plugin, source)
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

  // Last resolved config per directory. Synchronous consumers that cannot
  // afford an await — e.g. the permission idle-once gate, which must stay
  // await-free between pending registration and the asked-event publish —
  // read the same cached snapshot the async path uses via peek(). Entries
  // are dropped by invalidate()/invalidateAll() BEFORE the cache is dropped,
  // so a mid-session config edit is either observed fresh or fails closed
  // (peek returns undefined) while the re-read is in flight. Bounded so a
  // long-lived server opening many projects cannot grow without limit.
  const PEEKED_MAX_ENTRIES = 32
  const peeked = new Map<string, Info>()
  // Bumped on every invalidation. A get() that captured its generation before
  // an invalidate MUST NOT publish its (stale) result afterwards: a slow
  // in-flight load from before the edit could otherwise finish after the
  // fresh re-read and overwrite peeked with the pre-edit config, reopening
  // the stale-snapshot window peek() exists to close.
  let peekedGeneration = 0

  function peekKey() {
    try {
      return Instance.directory
    } catch {
      return undefined
    }
  }

  /**
   * Synchronously read the cached config for the active directory, or
   * undefined when the cache has not been populated or was just invalidated.
   * Never reads disk; use get()/getFresh() when you can await.
   */
  export function peek(): Info | undefined {
    const key = peekKey()
    return key ? peeked.get(key) : undefined
  }

  function peekedSet(key: string, config: Info) {
    if (!peeked.has(key) && peeked.size >= PEEKED_MAX_ENTRIES) {
      const oldest = peeked.keys().next().value
      if (oldest !== undefined) peeked.delete(oldest)
    }
    peeked.set(key, config)
  }

  export async function get() {
    const generation = peekedGeneration
    const x = await state()
    const key = peekKey()
    // Skip publishing when an invalidate() landed while this load was in
    // flight — the value predates the edit and must not shadow the fresh
    // re-read that the invalidation triggers.
    if (key && generation === peekedGeneration) peekedSet(key, x.config)
    return x.config
  }

  /**
   * Drop the cached config so the next `get()` re-reads disk.
   * Use after mid-session edits to `ax-code.json` (e.g. enabling arena)
   * without a full `Instance.reload()` (which tears down LSP/MCP/etc.).
   * Prefer this over restarting the session for `modes.*` opt-ins.
   */
  export async function invalidate() {
    peekedGeneration++
    const key = peekKey()
    if (key) peeked.delete(key)
    await state.invalidate()
  }

  /**
   * Drop the cached config for every live project without tearing down the
   * rest of each Instance. Global provider enablement is shared across
   * projects, so changing it must refresh every merged config snapshot while
   * preserving active sessions, LSP clients, MCP connections, and tools.
   */
  export async function invalidateAll(): Promise<void> {
    peekedGeneration++
    peeked.clear()
    state.invalidateAll()
  }

  /**
   * Invalidate cache then return a freshly loaded config.
   * Ensemble tools (council/arena) call this so mid-session config edits apply.
   */
  export async function getFresh() {
    await invalidate()
    return get()
  }

  export async function mcpEntries() {
    const { config, mcpSources } = await state()
    return Object.fromEntries(
      Object.entries(config.mcp ?? {}).map(([name, mcp]) => [
        name,
        {
          config: mcp,
          source: mcpSources[name] ?? trustedMcpSource("unknown"),
        },
      ]),
    )
  }

  export async function mcpEntry(name: string) {
    return (await mcpEntries())[name]
  }

  export async function getGlobal() {
    return global()
  }

  /**
   * The injected product default (ADR-170; read tier per ADR-171, interact tier per ADR-174). One
   * definition shared by the injection and by the write-path filter, so the
   * two can never drift apart.
   */
  function productDefaultWebMcpEntry() {
    return WebMcpLaunch.config({ allowedOrigins: [], read: true, interact: true }, false)
  }

  /**
   * ADR-170 injects the WebMCP bridge entry as a product default while the
   * config is loaded, so the merged object a client reads (GET /config)
   * carries an entry no file configured. Echoing that merged object back into
   * a write path must not turn the product default into a persisted project
   * artifact: drop the entry when it is exactly the unrestricted default and
   * the target file does not already carry it.
   */
  function isProductDefaultWebMcpEntry(entry: unknown) {
    const parsed = ConfigSchema.McpLocal.safeParse(entry)
    if (!parsed.success) return false
    // Zod emits keys in schema order, so this comparison stays stable across a
    // JSON round-trip of the injected entry.
    const injected = ConfigSchema.McpLocal.parse(productDefaultWebMcpEntry())
    return JSON.stringify(parsed.data) === JSON.stringify(injected)
  }

  function withoutInjectedWebMcpDefault(config: Info, existing: Info): Info {
    const current = config.mcp
    if (current === undefined) return config
    if (existing.mcp?.webmcp !== undefined) return config
    if (!isProductDefaultWebMcpEntry(current.webmcp)) return config
    const { webmcp: _injected, ...mcp } = current
    if (Object.keys(mcp).length === 0) {
      const { mcp: _empty, ...rest } = config
      return rest
    }
    return { ...config, mcp }
  }

  export async function update(config: Info) {
    const filepath = projectConfigFile()
    await editConfigFile(
      filepath,
      (before) => {
        // This is a raw JSONC edit, not config evaluation: never materialize
        // repository-controlled {file:} or {env:} references into literal secrets.
        const text = before?.trim() ? before : "{}"
        const existing = before ? parseConfig(before, filepath) : {}
        const merged = mergeConfig(existing, withoutInjectedWebMcpDefault(config, existing))
        const patch = changedJsoncPatch(existing, merged)
        return patch === JSONC_UNCHANGED ? text : patchJsonc(text, patch)
      },
      { skipUnchanged: true },
    )
    await Instance.reload({
      directory: Instance.directory,
    })
  }

  // Project files load .json before .jsonc, so the .jsonc wins when both
  // exist: writing a project that uses ax-code.jsonc into a fresh ax-code.json
  // would be silently shadowed on reload. Prefer the file that is live.
  export function projectConfigFile() {
    // @scan-suppress security_scan - file is the fixed leaf ax-code.jsonc or ax-code.json under the instance directory.
    const candidates = ["ax-code.jsonc", "ax-code.json"].map((file) => path.join(Instance.directory, file))
    for (const file of candidates) {
      if (existsSync(file)) return file
    }
    return candidates[1]!
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

  function isProviderEnablementUpdate(config: Info) {
    return Object.keys(config).every((key) => key === "disabled_providers" || key === "enabled_providers")
  }

  async function refreshProviderEnablementCaches() {
    await invalidateAll().catch((err) => {
      log.error("failed to invalidate config after provider enablement update", { err })
    })

    // Provider state captures enabled_providers / disabled_providers when it
    // initializes. Invalidate that cache separately so the next provider list
    // or model lookup sees the persisted change. Use a dynamic import to avoid
    // the Config <-> Provider module cycle during startup.
    await import("../provider/provider")
      .then(({ Provider }) => Provider.invalidateAll())
      .catch((err) => {
        log.error("failed to invalidate providers after provider enablement update", { err })
      })
  }

  async function refreshAfterGlobalUpdate(providerEnablementOnly: boolean) {
    global.reset()
    if (providerEnablementOnly) {
      await refreshProviderEnablementCaches()
    } else {
      await Instance.disposeAll().catch((err) => {
        log.error("failed to dispose instances during config reload", { err })
      })
    }
    GlobalBus.emit("event", {
      directory: "global",
      payload: { type: RuntimeEvent.Disposed.type, properties: {} },
    })
  }

  function globalPatch(config: Info): (before: string | undefined) => string {
    // Patch raw JSONC in place to retain comments and unevaluated references.
    return (before) => patchJsonc(before ?? "{}", config)
  }

  export async function updateGlobal(config: Info) {
    const filepath = globalConfigFile()
    const next = await editConfigFile(filepath, globalPatch(config))

    await refreshAfterGlobalUpdate(isProviderEnablementUpdate(config))

    return next
  }

  /** Patch global config and retain a restore operation for that exact write. */
  export async function updateGlobalWithRollback(config: Info): Promise<() => Promise<boolean>> {
    const filepath = globalConfigFile()
    const updated = await editConfigFileWithRollback(filepath, globalPatch(config))
    if (!updated) throw new Error("Global config patch produced no edit")
    return refreshGlobalEdit(filepath, updated.rollback, isProviderEnablementUpdate(config))
  }

  /**
   * ADR-170: persist the WebMCP chip toggle to the user-level (global) config
   * so the choice survives restarts. Unlike updateGlobal this neither
   * invalidates nor disposes instances: the runtime connection state already
   * reflects the toggle, and disposing mid-gesture would tear down the
   * connection the user just asked for. The persisted value applies from the
   * next process start.
   */
  export async function persistWebMcpToggle(name: string, entry: NonNullable<Info["mcp"]>[string], enabled: boolean) {
    const filepath = globalConfigFile()
    await editConfigFile(filepath, (before) => {
      // ADR-173: regenerate profiled entries so drifted stored commands
      // cannot survive the toggle.
      const normalized =
        "webmcp" in entry && entry.webmcp !== undefined && entry.type === "local"
          ? WebMcpLaunch.config(entry.webmcp, enabled)
          : { ...entry, enabled }
      return patchJsonc(before ?? "{}", { mcp: { [name]: normalized } })
    })
    // The runtime connection state already reflects the toggle, so live
    // instances are not disposed; just drop the memoized global config so the
    // next load (another instance or the next process start) sees the choice.
    global.reset()
  }

  /** Replace one global provider without retaining stale nested model entries. */
  export async function setGlobalProvider(providerID: string, provider: Provider) {
    const filepath = globalConfigFile()
    const next = await editConfigFile(
      filepath,
      (before) => {
        const text = before ?? "{}"
        parseConfig(text, filepath)
        return applyEdits(
          text,
          modify(text, ["provider", providerID], provider, {
            formattingOptions: { insertSpaces: true, tabSize: 2 },
          }),
        )
      },
      { skipUnchanged: true },
    )
    await refreshAfterGlobalUpdate(false)
    return next
  }

  function providerRemoval(
    filepath: string,
    providerID: string,
    guard?: (provider: Provider) => boolean,
  ): (before: string | undefined) => string | undefined {
    return (before) => {
      const text = before ?? "{}"
      const existing = parseConfig(text, filepath)
      const providers = existing.provider
      if (!providers || !Object.hasOwn(providers, providerID)) return
      const provider = providers[providerID]
      if (guard && !guard(provider)) return
      return applyEdits(
        text,
        modify(text, ["provider", providerID], undefined, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      )
    }
  }

  /** Remove exactly one provider from the writable global config. */
  export async function removeGlobalProvider(providerID: string): Promise<boolean> {
    const filepath = globalConfigFile()
    const removed = await editConfigFile(filepath, providerRemoval(filepath, providerID))
    if (removed) await refreshAfterGlobalUpdate(false)
    return removed !== undefined
  }

  async function refreshGlobalEdit(
    filepath: string,
    restoreFile: () => Promise<boolean>,
    enablementOnly: boolean,
  ): Promise<() => Promise<boolean>> {
    const restore = async (): Promise<boolean> => {
      if (globalConfigFile() !== filepath) return false
      const restored = await restoreFile()
      if (restored) await refreshAfterGlobalUpdate(enablementOnly)
      return restored
    }
    let pending: Promise<boolean> | undefined
    const rollback = (): Promise<boolean> => (pending ??= restore())
    try {
      await refreshAfterGlobalUpdate(enablementOnly)
    } catch (error) {
      try {
        await rollback()
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Failed to refresh global config and restore its previous revision",
        )
      }
      throw error
    }
    return rollback
  }

  /** Restore the captured raw document only while this removal still owns it. */
  export async function removeGlobalProviderWithRollback(
    providerID: string,
    guard?: (provider: Provider) => boolean,
  ): Promise<(() => Promise<boolean>) | undefined> {
    const filepath = globalConfigFile()
    const removed = await editConfigFileWithRollback(filepath, providerRemoval(filepath, providerID, guard))
    if (!removed) return
    return refreshGlobalEdit(filepath, removed.rollback, false)
  }

  export async function directories() {
    return state().then((x) => x.directories)
  }
}
