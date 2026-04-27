import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount, Show } from "solid-js"
import { Locale } from "@/util/locale"
import { useKeybind } from "../../context/keybind"
import { useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { DialogSessionRename } from "../dialog-session-rename"
import { useKV } from "../../context/kv"
import { createDebouncedSignal } from "../../util/signal"
import { Spinner } from "../spinner"
import { useToast } from "../../ui/toast"
import { createAbortableResourceFetcher } from "../../util/abortable-resource"
import { Log } from "@/util/log"
import type { Session } from "@ax-code/sdk/v2"

const log = Log.create({ service: "tui.workspace-dialog-session-list" })

export function DialogSessionList(props: { workspaceID?: string; localOnly?: boolean } = {}) {
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

  const [listed, listedActions] = createResource(
    () => props.workspaceID,
    createAbortableResourceFetcher<string | undefined, Session[]>(
      async (workspaceID: string | undefined, signal, info) => {
        if (!workspaceID) return undefined
        try {
          const result = await sdk.client.session.list({ directory: workspaceID, roots: true }, { signal })
          return result.data ?? []
        } catch (error) {
          log.warn("workspace session list load failed", { error, workspaceID })
          toast.show({
            message: error instanceof Error ? error.message : "Failed to load workspace sessions",
            variant: "error",
          })
          return info.value
        }
      },
    ),
  )

  const [searchResults] = createResource(
    search,
    createAbortableResourceFetcher<string, Session[]>(async (query: string, signal, info) => {
      if (!query || props.localOnly) return undefined
      try {
        const result = await sdk.client.session.list(
          {
            directory: props.workspaceID,
            search: query,
            limit: 30,
            ...(props.workspaceID ? { roots: true } : {}),
          },
          { signal },
        )
        return result.data ?? []
      } catch (error) {
        log.warn("workspace session list search failed", {
          error,
          query,
          workspaceID: props.workspaceID,
        })
        toast.show({
          message: error instanceof Error ? error.message : "Failed to search sessions",
          variant: "error",
        })
        return info.value
      }
    }),
  )

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const sessions = createMemo<Session[]>(() => {
    const results = searchResults()
    if (results) return results
    if (props.workspaceID) return listed() ?? []
    if (props.localOnly)
      return sync.data.session.filter((session) => session.directory === (sync.data.path.directory || sdk.directory))
    return sync.data.session
  })

  const options = createMemo(() => {
    const today = new Date().toDateString()
    return sessions()
      .filter((x: Session) => {
        if (x.parentID !== undefined) return false
        if (props.workspaceID && listed()) return true
        if (props.workspaceID) return x.directory === props.workspaceID
        if (props.localOnly) return x.directory === (sync.data.path.directory || sdk.directory)
        return true
      })
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
      title={props.workspaceID ? `Workspace Sessions` : props.localOnly ? "Local Sessions" : "Sessions"}
      options={options()}
      skipFilter={!props.localOnly}
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
              if (props.workspaceID) {
                listedActions.mutate((sessions: Session[] | undefined) =>
                  sessions?.filter((session: Session) => session.id !== option.value),
                )
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
