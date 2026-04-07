import { Log } from "../util/log"

const disposers = new Set<(directory: string) => Promise<void>>()

export function registerDisposer(disposer: (directory: string) => Promise<void>) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

export async function disposeInstance(directory: string) {
  const results = await Promise.allSettled([...disposers].map((disposer) => disposer(directory)))
  for (const r of results) {
    if (r.status === "rejected")
      Log.Default.error("disposer failed during instance cleanup", { directory, err: r.reason })
  }
}
