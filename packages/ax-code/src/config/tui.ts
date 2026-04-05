import { existsSync } from "fs"
import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Config } from "./config"
import { ConfigPaths } from "./paths"
import { migrateTuiConfig } from "./migrate-tui-config"
import { TuiInfo } from "./tui-schema"
import { Instance } from "@/project/instance"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"

export namespace TuiConfig {
  const log = Log.create({ service: "tui.config" })

  export const Info = TuiInfo

  export type Info = z.output<typeof Info>

  function mergeInfo(target: Info, source: Info): Info {
    return mergeDeep(target, source)
  }

  function customPath() {
    return Flag.AX_CODE_TUI_CONFIG
  }

  const state = Instance.state(async () => {
    let projectFiles = Flag.AX_CODE_DISABLE_PROJECT_CONFIG
      ? []
      : await ConfigPaths.projectFiles("tui", Instance.directory, Instance.worktree)
    const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)
    const custom = customPath()
    const managed = Config.managedConfigDir()
    await migrateTuiConfig({ directories, custom, managed })
    // Re-compute after migration since migrateTuiConfig may have created new tui.json files
    projectFiles = Flag.AX_CODE_DISABLE_PROJECT_CONFIG
      ? []
      : await ConfigPaths.projectFiles("tui", Instance.directory, Instance.worktree)

    let result: Info = {}

    for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
      result = mergeInfo(result, await loadFile(file))
    }

    if (custom) {
      result = mergeInfo(result, await loadFile(custom))
      log.debug("loaded custom tui config", { path: custom })
    }

    // Project tui.json{,c} files live in the worktree and can be
    // committed by anyone — treat as untrusted so `{file:}` refs
    // inside them can't reach files outside the config's own dir.
    for (const file of projectFiles) {
      result = mergeInfo(result, await loadFile(file, { trusted: false }))
    }

    for (const dir of unique(directories)) {
      if (!dir.endsWith(".ax-code") && dir !== Flag.AX_CODE_CONFIG_DIR) continue
      // Only `.ax-code` dirs inside the worktree are untrusted; the
      // home-level `~/.ax-code/` walk and AX_CODE_CONFIG_DIR are
      // trusted (the user controls them).
      const inWorktree = Filesystem.contains(Instance.worktree, dir)
      const isUserConfigDir = dir === Flag.AX_CODE_CONFIG_DIR
      const trusted = !inWorktree || isUserConfigDir
      for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
        result = mergeInfo(result, await loadFile(file, { trusted }))
      }
    }

    if (existsSync(managed)) {
      for (const file of ConfigPaths.fileInDirectory(managed, "tui")) {
        result = mergeInfo(result, await loadFile(file))
      }
    }

    result.keybinds = Config.Keybinds.parse(result.keybinds ?? {})

    return {
      config: result,
    }
  })

  export async function get() {
    return state().then((x) => x.config)
  }

  async function loadFile(filepath: string, opts?: { trusted?: boolean }): Promise<Info> {
    const text = await ConfigPaths.readFile(filepath)
    if (!text) return {}
    return load(text, filepath, opts?.trusted).catch((error) => {
      log.warn("failed to load tui config", { path: filepath, error })
      return {}
    })
  }

  async function load(text: string, configFilepath: string, trusted?: boolean): Promise<Info> {
    const data = await ConfigPaths.parseText(text, configFilepath, { missing: "empty", trusted })
    if (!data || typeof data !== "object" || Array.isArray(data)) return {}

    // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
    // (mirroring the old opencode.json shape) still get their settings applied.
    const normalized = (() => {
      const copy = { ...(data as Record<string, unknown>) }
      if (!("tui" in copy)) return copy
      if (!copy.tui || typeof copy.tui !== "object" || Array.isArray(copy.tui)) {
        delete copy.tui
        return copy
      }
      const tui = copy.tui as Record<string, unknown>
      delete copy.tui
      return {
        ...tui,
        ...copy,
      }
    })()

    const parsed = Info.safeParse(normalized)
    if (!parsed.success) {
      log.warn("invalid tui config", { path: configFilepath, issues: parsed.error.issues })
      return {}
    }

    return parsed.data
  }
}
