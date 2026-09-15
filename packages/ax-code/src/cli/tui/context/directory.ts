import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { Global } from "@/global"
import { directoryLabel } from "./directory-view-model"

export function useDirectory() {
  const sync = useSync()
  return createMemo(() =>
    directoryLabel({
      directory: sync.data.path.directory,
      fallbackDirectory: process.cwd(),
      homeDirectory: Global.Path.home,
      branch: sync.data.vcs?.branch,
    }),
  )
}
