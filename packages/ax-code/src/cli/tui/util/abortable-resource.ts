import { onCleanup, type ResourceFetcher, type ResourceFetcherInfo } from "solid-js"

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  )
}

export function createAbortableResourceFetcher<S, T, R = unknown>(
  fetcher: (source: S, signal: AbortSignal, info: ResourceFetcherInfo<T | undefined, R>) => Promise<T | undefined>,
): ResourceFetcher<S, T | undefined, R> {
  let controller: AbortController | undefined

  onCleanup(() => controller?.abort())

  return async (source, info) => {
    controller?.abort()
    const current = new AbortController()
    controller = current

    try {
      const result = await fetcher(source, current.signal, info)
      return current.signal.aborted ? info.value : result
    } catch (error) {
      if (current.signal.aborted || isAbortError(error)) return info.value
      throw error
    } finally {
      if (controller === current) controller = undefined
    }
  }
}
