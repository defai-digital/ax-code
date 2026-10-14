import semver from "semver"
import { Log } from "../util/log"
import { Process } from "../util/process"
import { Env } from "../util/env"
import { NpmManager, packageManagerKind } from "./package-manager"

export namespace PackageRegistry {
  const log = Log.create({ service: "bun" })

  function which() {
    return process.execPath
  }

  export async function info(pkg: string, field: string, cwd?: string): Promise<string | null> {
    // On the node-bundled runtime `process.execPath` is `node`, so `node info`
    // is meaningless — query the registry with `npm view` instead. Bun runtimes
    // keep running `<execPath> info` under BUN_BE_BUN (which lets a compiled
    // ax-code binary act as bun).
    const isNpm = packageManagerKind() === "npm"
    const cmd = isNpm ? [NpmManager.executable, ...NpmManager.infoArgs(pkg, field)] : [which(), "info", pkg, field]
    const env = isNpm ? Env.sanitize() : { ...Env.sanitize(), BUN_BE_BUN: "1" }

    const { code, stdout, stderr } = await Process.run(cmd, {
      cwd,
      env,
      nothrow: true,
      abort: AbortSignal.timeout(10_000),
    })

    if (code !== 0) {
      log.warn("package registry info failed", { pkg, field, code, stderr: stderr.toString() })
      return null
    }

    const value = stdout.toString().trim()
    if (!value) return null
    return value
  }

  export async function isOutdated(pkg: string, cachedVersion: string, cwd?: string): Promise<boolean> {
    const latestVersion = await info(pkg, "version", cwd)
    if (!latestVersion) {
      log.warn("Failed to resolve latest version, using cached", { pkg, cachedVersion })
      return false
    }

    const isRange = /[\s^~*xX<>|=]/.test(cachedVersion)
    if (isRange) return !semver.satisfies(latestVersion, cachedVersion)

    // A non-semver spec — the "latest" BunProc.install persists when its
    // post-install version read fails, or a github:/tarball spec — is not
    // comparable, and semver.lt throws on it. Treat it as outdated so the
    // package is reinstalled instead of failing every future install call.
    if (!semver.valid(cachedVersion)) return true

    return semver.lt(cachedVersion, latestVersion)
  }
}
