import path from "path"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { FileLock } from "@/util/filelock"
import { Lock } from "@/util/lock"
import { Log } from "@/util/log"

const log = Log.create({ service: "project-config" })

function filepath() {
  return path.join(Instance.directory, "ax-code.json")
}

function parse(text: string) {
  try {
    const value = JSON.parse(text)
    const next = Config.Info.safeParse(value)
    if (next.success) return next.data
    log.warn("invalid project config, resetting to empty object", { issueCount: next.error.issues.length })
    return {}
  } catch (error) {
    log.warn("failed to parse project config, resetting to empty object", { error })
    return {}
  }
}

export async function readProjectConfig() {
  const file = filepath()
  const text = await Filesystem.readText(file).catch(() => "{}")
  return parse(text)
}

export async function updateProjectConfig<T>(fn: (config: Config.Info) => T | Promise<T>) {
  const file = filepath()
  using _inProcess = await Lock.write(file)
  using _crossProcess = await FileLock.acquire(file)
  const text = await Filesystem.readText(file).catch(() => "{}")
  const config = parse(text)
  const result = await fn(config)
  await Filesystem.writeJson(file, config)
  return result
}
