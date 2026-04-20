import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { Global } from "@/global"

export function useDirectory() {
  const sync = useSync()
  return createMemo(() => {
    const directory = sync.data.path.directory || process.cwd()
    const result =
      directory === Global.Path.home || directory.startsWith(Global.Path.home + "/")
        ? directory.replace(Global.Path.home, "~")
        : directory
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}
