import { Global } from "@/global"
import { Log } from "@/util/log"
import { Filesystem } from "@/util/filesystem"
import { createSignal, type Setter } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { readOptionalJsonState } from "@tui/util/optional-json-state"
import path from "path"

const log = Log.create({ service: "tui.kv" })

function isKVStore(input: unknown): input is Record<string, any> {
  return !!input && typeof input === "object" && !Array.isArray(input)
}

// Context init body, exported so tests can exercise the load/write ordering
// without rendering the provider.
export function createKVStore() {
  const [ready, setReady] = createSignal(false)
  const [store, setStore] = createStore<Record<string, any>>({})
  const filePath = path.join(Global.Path.state, "kv.json")
  let writeFailureShown = false
  let persistenceBlocked = false
  // Writes issued before the initial read resolves are buffered here and
  // re-applied on top of the loaded values: persisting immediately would
  // snapshot a near-empty store (wiping kv.json), and the late read would
  // then revert the fresh value in memory.
  let pendingWrites: Record<string, any> | undefined = {}

  const loaded = readOptionalJsonState<Record<string, any>>(filePath)
    .then((result) => {
      if (result.status === "missing") return
      if (result.status === "invalid") {
        persistenceBlocked = true
        log.warn("failed to load kv store; persistence disabled to avoid overwriting state", {
          filePath,
          error: result.error,
        })
        return
      }
      if (!isKVStore(result.value)) {
        persistenceBlocked = true
        log.warn("failed to load kv store; persistence disabled to avoid overwriting invalid state", {
          filePath,
        })
        return
      }
      setStore(result.value)
    })
    .finally(() => {
      const buffered = pendingWrites
      pendingWrites = undefined
      if (buffered && Object.keys(buffered).length > 0) {
        for (const [key, value] of Object.entries(buffered)) setStore(key, value)
        persist()
      }
      setReady(true)
    })

  // Chain all persistence behind the initial load so no write can ever
  // snapshot the store before kv.json has been read.
  let writeQueue: Promise<unknown> = loaded

  function persist() {
    if (persistenceBlocked) return
    const snapshot = structuredClone(unwrap(store))
    writeQueue = writeQueue.finally(() =>
      Filesystem.writeJson(filePath, snapshot)
        .then(() => {
          writeFailureShown = false
        })
        .catch((error) => {
          if (writeFailureShown) return
          writeFailureShown = true
          log.warn("failed to persist kv store", { filePath, error })
        }),
    )
  }

  const result = {
    get ready() {
      return ready()
    },
    get store() {
      return store
    },
    signal<T>(name: string, defaultValue: T) {
      if (store[name] === undefined) setStore(name, defaultValue)
      return [
        function () {
          return result.get(name)
        },
        function setter(next: Setter<T>) {
          result.set(name, next)
        },
      ] as const
    },
    get(key: string, defaultValue?: any) {
      return store[key] ?? defaultValue
    },
    set(key: string, value: any) {
      setStore(key, value)
      if (pendingWrites) {
        pendingWrites[key] = value
        return
      }
      persist()
    },
  }
  return result
}

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: createKVStore,
})
