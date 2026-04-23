import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"

const app = "ax-code"

// Fall back to the conventional `~/.local/share`, `~/.cache`, etc. when
// the xdg-basedir helpers return undefined. This happens in minimal
// environments (Docker containers without $HOME, some CI runners,
// sandboxed executions) where the corresponding env vars are unset
// AND the library can't derive defaults. The non-null assertions
// `xdgData!` etc. would otherwise crash at startup with a cryptic
// "path argument must be of type string" TypeError.
const testHome = process.env.AX_CODE_TEST_HOME
const pathHome = testHome || os.homedir()
const fallback = (dir: string | undefined, envName: string, sub: string) => {
  if (process.env[envName]) return dir ?? process.env[envName]
  if (testHome) return path.join(pathHome, sub)
  return dir ?? path.join(pathHome, sub)
}

const data = path.join(fallback(xdgData, "XDG_DATA_HOME", ".local/share"), app)
const cache = path.join(fallback(xdgCache, "XDG_CACHE_HOME", ".cache"), app)
const config = path.join(fallback(xdgConfig, "XDG_CONFIG_HOME", ".config"), app)
const state = path.join(fallback(xdgState, "XDG_STATE_HOME", ".local/state"), app)

function warnGlobalInit(message: string, error: unknown, extra?: Record<string, string>) {
  const suffix = error instanceof Error ? error.message : String(error)
  const detail = extra ? ` ${JSON.stringify(extra)}` : ""
  console.error(`[ax-code global] ${message}: ${suffix}${detail}`)
}

export namespace Global {
  export const Path = {
    // Allow override via AX_CODE_TEST_HOME for test isolation
    get home() {
      return process.env.AX_CODE_TEST_HOME || os.homedir()
    },
    data,
    bin: path.join(cache, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
  }
}

await Promise.allSettled([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
]).then((results) => {
  const entries = [
    ["data", Global.Path.data],
    ["config", Global.Path.config],
    ["state", Global.Path.state],
    ["log", Global.Path.log],
    ["bin", Global.Path.bin],
  ] as const

  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") continue
    const [label, dir] = entries[index] ?? ["unknown", "unknown"]
    warnGlobalInit("failed to prepare global directory", result.reason, { label, dir })
  }
})

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Global.Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  // Only stamp the new cache version after the wipe succeeds. The
  // previous code always advanced the marker even if `fs.rm` threw
  // (permission, disk full, EBUSY), which meant partial cleanups were
  // treated as complete on the next start and stale files were never
  // revisited.
  let cleaned = true
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {
    cleaned = false
    warnGlobalInit("cache cleanup failed, leaving version marker unchanged", e, {
      cache: Global.Path.cache,
    })
  }
  if (cleaned) {
    await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION).catch((error) => {
      warnGlobalInit("failed to stamp cache version", error, {
        cache: Global.Path.cache,
      })
    })
  }
}
