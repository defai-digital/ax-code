// Consumer-side guard for the shared session tree memo (Sync context):
// the memo must rebuild on structural changes to the in-place store array
// (splice insert/remove, parentID writes) and must NOT rebuild on title or
// timestamp writes. This needs the reactive solid-js build, which vitest's
// deterministic lane does not resolve, so it runs as a check script.
import { createMemo, createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSessionTreeIndex } from "../src/cli/tui/util/session-tree"

type Row = { id: string; parentID?: string; title: string; time: { updated: number } }

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

createRoot((dispose) => {
  const [store, setStore] = createStore<{ session: Row[] }>({
    session: [
      { id: "root", title: "Root", time: { updated: 1 } },
      { id: "child", parentID: "root", title: "Child", time: { updated: 1 } },
    ],
  })
  let builds = 0 as number
  const tree = createMemo(() => {
    builds++
    return createSessionTreeIndex(store.session)
  })
  const count = () => builds
  const subtree = (id: string) => [...tree().subtree(id)].sort().join(",")
  if (subtree("root") !== "child,root" || count() !== 1) fail(`initial build: ${subtree("root")} builds=${count()}`)

  setStore(
    produce((draft) => {
      draft.session[1]!.title = "Renamed"
      draft.session[0]!.time.updated = 2
    }),
  )
  tree()
  if (count() !== 1) fail(`title/time write rebuilt the index (builds=${count()})`)

  setStore(produce((draft) => draft.session.splice(2, 0, { id: "grandchild", parentID: "child", title: "G", time: { updated: 3 } })))
  if (subtree("root") !== "child,grandchild,root" || count() !== 2) fail(`insert: ${subtree("root")} builds=${count()}`)

  setStore(produce((draft) => void (draft.session[2]!.parentID = "root")))
  if (subtree("child") !== "child" || count() !== 3) fail(`parentID write: ${subtree("child")} builds=${count()}`)

  setStore(produce((draft) => void draft.session.splice(1, 1)))
  if (subtree("root") !== "grandchild,root" || count() !== 4) fail(`remove: ${subtree("root")} builds=${count()}`)

  dispose()
  console.log("session tree memo: rebuilds on structure only (4 builds, 1 skipped write)")
})
