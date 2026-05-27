import whichPkg from "which"
import path from "path"
import { Global } from "../global"

function searchPath(base: string) {
  const extra = [
    Global.Path.bin,
    path.join(Global.Path.home, ".local", "bin"),
    path.join(Global.Path.home, "bin"),
    path.join(Global.Path.home, ".grok", "bin"),
  ]
  return [...(base ? base.split(path.delimiter) : []), ...extra].filter(Boolean).join(path.delimiter)
}

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: searchPath(base),
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  })
  return typeof result === "string" ? result : null
}
