import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"
import { Env } from "../util/env"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { NamedError } from "@ax-code/util/error"
import { Lock } from "../util/lock"
import { PackageRegistry } from "./registry"
import { NpmManager, packageManagerKind } from "./package-manager"
import { proxied } from "@/util/proxied"
import { Process } from "../util/process"
import { runtimeMode, type RuntimeMode } from "../installation/runtime-mode"

export namespace BunProc {
  const log = Log.create({ service: "bun" })

  export async function run(cmd: string[], options?: Process.RunOptions) {
    const full = [which(), ...cmd]
    log.info("running", {
      cmd: full,
      ...options,
    })
    const result = await Process.run(full, {
      cwd: options?.cwd,
      abort: options?.abort,
      kill: options?.kill,
      timeout: options?.timeout,
      nothrow: options?.nothrow,
      env: {
        ...Env.sanitize(),
        ...options?.env,
        BUN_BE_BUN: "1",
      },
    })
    log.info("done", {
      code: result.code,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })
    return result
  }

  export function resolveExecutable(
    input: {
      execPath?: string
      runtimeMode?: RuntimeMode
      which?: (command: string) => string | null | undefined
    } = {},
  ) {
    const execPath = input.execPath ?? process.execPath
    const mode = input.runtimeMode ?? runtimeMode()
    if (mode !== "compiled") return execPath

    const external = (input.which ?? Bun.which)("bun")
    if (external && path.resolve(external) !== path.resolve(execPath)) return external

    log.warn("external bun runtime not found; refusing to use compiled ax-code as bun")
    return "bun"
  }

  export function which() {
    return resolveExecutable()
  }

  /**
   * Return the extra `bun install` flags needed to work around
   * https://github.com/oven-sh/bun/issues/19936 — a performance regression
   * where the local bun cache makes `bun install` slower than `--no-cache`
   * when running behind a proxy or in CI. We flip cache off in those
   * environments to avoid the regression; otherwise we leave the cache on
   * because it is faster in the default case.
   *
   * Centralized so there is one place to remove the workaround when the
   * upstream issue is fixed. Callers: BunProc.installArgs and the config
   * plugin-install path in src/config/config.ts.
   *
   * To verify status: check whether #19936 is closed in Bun's tracker
   * and whether the installed Bun version post-dates the fix. When both
   * are true, delete this helper and its two call sites.
   */
  export function installCacheWorkaroundArgs(env: { proxied?: boolean; ci?: boolean } = {}): string[] {
    const isProxied = env.proxied ?? proxied()
    const isCi = env.ci ?? !!process.env.CI
    return isProxied || isCi ? ["--no-cache"] : []
  }

  export const InstallFailedError = NamedError.create(
    "BunInstallFailedError",
    z.object({
      pkg: z.string(),
      version: z.string(),
    }),
  )

  export function installArgs(
    pkg: string,
    version: string,
    dep = {
      proxied: proxied(),
      ci: !!process.env.CI,
      cwd: Global.Path.cache,
    },
  ) {
    return ["add", "--force", "--exact", ...installCacheWorkaroundArgs(dep), "--cwd", dep.cwd, pkg + "@" + version]
  }

  // Validate npm package name to prevent path traversal. Packages are
  // either bare names (`lodash`) or scoped (`@scope/name`). Anything
  // containing `..`, starting with `/`, or not matching the npm naming
  // convention is rejected before it reaches `path.join`. This is the
  // primary defense for callers that pass user-controlled config values
  // (e.g. plugin loading from `ax-code.json`).
  const VALID_NPM_PKG = /^(@[\w][\w.-]*\/)?[\w][\w.-]*$/

  // How long a successful "is this 'latest' SDK outdated?" registry check is
  // trusted before we hit the network again. One day keeps the first prompt
  // of every session fast while still picking up SDK updates within 24h.
  const VERSION_CHECK_TTL_MS = 1000 * 60 * 60 * 24

  function versionCheckPath() {
    return path.join(Global.Path.cache, "version-checks.json")
  }

  async function recentlyVersionChecked(pkg: string): Promise<boolean> {
    const data = await Filesystem.readJson<Record<string, number>>(versionCheckPath()).catch(() => null)
    const at = data?.[pkg]
    if (typeof at !== "number") return false
    return Date.now() - at < VERSION_CHECK_TTL_MS
  }

  async function recordVersionChecked(pkg: string) {
    const data = await Filesystem.readJson<Record<string, number>>(versionCheckPath()).catch((err) => {
      if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return {} as Record<string, number>
      log.warn("failed to read provider version check cache", { pkg, error: err })
      return undefined
    })
    if (!data) return
    data[pkg] = Date.now()
    await Filesystem.writeJson(versionCheckPath(), data).catch((err) =>
      log.warn("failed to record provider version check", { pkg, error: err }),
    )
  }

  export async function install(pkg: string, version = "latest") {
    if (!VALID_NPM_PKG.test(pkg) || pkg.includes("..")) {
      throw new Error(`Invalid package name: ${pkg}`)
    }

    // Use lock to ensure only one install at a time
    using _ = await Lock.write("bun-install")

    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const pkgjsonPath = path.join(Global.Path.cache, "package.json")
    const parsed = await Filesystem.readJson<{ dependencies: Record<string, string> }>(pkgjsonPath).catch(
      async (error) => {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") throw error
        const result = { dependencies: {} as Record<string, string> }
        await Filesystem.writeJson(pkgjsonPath, result)
        return result
      },
    )
    if (!parsed.dependencies) parsed.dependencies = {} as Record<string, string>
    const dependencies = parsed.dependencies
    const modExists = await Filesystem.exists(mod)
    const cachedVersion = dependencies[pkg]

    if (!modExists || !cachedVersion) {
      // continue to install
    } else if (version !== "latest" && cachedVersion === version) {
      return mod
    } else if (version === "latest") {
      // Only hit the npm registry (PackageRegistry.isOutdated → `bun info`, a
      // network round-trip serialized behind this install lock) once per TTL
      // window. Without this gate, every session's first `getSDK(model)`
      // re-checks "latest" for an already-installed SDK — adding a registry
      // round-trip (and a full timeout when offline, e.g. a local-only LLM
      // user whose model uses @ai-sdk/openai-compatible) before the first
      // prompt can run. A stale check at worst delays picking up a newer SDK
      // by the TTL; explicit version pins and mismatches still force install.
      if (await recentlyVersionChecked(pkg)) return mod
      const isOutdated = await PackageRegistry.isOutdated(pkg, cachedVersion, Global.Path.cache)
      await recordVersionChecked(pkg)
      if (!isOutdated) return mod
      log.info("Cached version is outdated, proceeding with install", { pkg, cachedVersion })
    }

    const onInstallFailed = (e: unknown) => {
      throw new InstallFailedError(
        { pkg, version },
        {
          cause: e,
        },
      )
    }

    if (packageManagerKind() === "npm") {
      // node-bundled runtime: drive npm (bundled with Node). npm resolves the
      // registry from .npmrc / its default just like bun does — no --registry.
      await Process.run([NpmManager.executable, ...NpmManager.addArgs(pkg, version, Global.Path.cache)], {
        cwd: Global.Path.cache,
        abort: AbortSignal.timeout(60_000),
        env: Env.sanitize(),
      }).catch(onInstallFailed)
    } else {
      // Build command arguments
      const args = installArgs(pkg, version)

      // Let Bun handle registry resolution:
      // - If .npmrc files exist, Bun will use them automatically
      // - If no .npmrc files exist, Bun will default to https://registry.npmjs.org
      // - No need to pass --registry flag
      log.info("installing package using Bun's default registry resolution", {
        pkg,
        version,
      })

      await BunProc.run(args, {
        cwd: Global.Path.cache,
        abort: AbortSignal.timeout(60_000),
      }).catch(onInstallFailed)
    }

    // Resolve actual version from installed package when using "latest"
    // This ensures subsequent starts use the cached version until explicitly updated
    let resolvedVersion = version
    if (version === "latest") {
      const installedPkg = await Filesystem.readJson<{ version?: string }>(path.join(mod, "package.json")).catch(
        () => null,
      )
      if (installedPkg?.version) {
        resolvedVersion = installedPkg.version
      }
    }

    parsed.dependencies[pkg] = resolvedVersion
    await Filesystem.writeJson(pkgjsonPath, parsed)
    return mod
  }
}
