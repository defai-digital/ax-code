import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount, Show } from "solid-js"
import { Locale } from "@/util/locale"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { useKV } from "../context/kv"
import { createDebouncedSignal } from "../util/signal"
import { Spinner } from "./spinner"
import { useToast } from "../ui/toast"
import { createAbortableResourceFetcher } from "../util/abortable-resource"
import { Log } from "@/util/log"
import type { Session } from "@ax-code/sdk/v2"

const log = Log.create({ service: "tui.dialog-session-list" })

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()
  const kv = useKV()
  const toast = useToast()

  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)

  const [searchResults] = createResource(
    search,
    createAbortableResourceFetcher<string, Session[]>(async (query: string, signal, info) => {
      if (!query) return undefined
      try {
        const result = await sdk.client.session.list({ search: query, limit: 30 }, { signal })
        return result.data ?? []
      } catch (error) {
        log.warn("session list search failed", { error, query })
        toast.show({
          message: error instanceof Error ? error.message : "Failed to search sessions",
          variant: "error",
        })
        return info.value
      }
    }),
  )

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const sessions = createMemo<Session[]>(() => searchResults() ?? sync.data.session)

  const options = createMemo(() => {
    const today = new Date().toDateString()
    return sessions()
      .filter((x: Session) => x.parentID === undefined)
      .toSorted((a: Session, b: Session) => b.time.updated - a.time.updated)
      .map((x: Session) => {
        const date = new Date(x.time.updated)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        const isDeleting = toDelete() === x.id
        const status = sync.data.session_status?.[x.id]
        const isWorking = status?.type === "busy"
        return {
          title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
          bg: isDeleting ? theme.error : undefined,
          value: x.id,
          category,
          footer: Locale.time(x.time.updated),
          gutter: isWorking ? <Spinner /> : undefined,
        }
      })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              const deleted = await sdk.client.session
                .delete({
                  sessionID: option.value,
                })
                .then(() => true)
                .catch(() => false)
              setToDelete(undefined)
              if (!deleted) {
                toast.show({
                  message: "Failed to delete session",
                  variant: "error",
                })
                return
              }
              sync.set(
                "session",
                sync.data.session.filter((session) => session.id !== option.value),
              )
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
      ]}
    />
  )
}
