import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useLocal } from "../context/local"
import { DialogSessionRename } from "./dialog-session-rename"
import { createDebouncedSignal } from "../util/signal"
import { Spinner } from "./spinner"
import { useToast } from "../ui/toast"
import { createAbortableResourceFetcher } from "../util/abortable-resource"
import { Log } from "@/util/log"
import type { Session } from "@ax-code/sdk/v2"
import {
  localWorkspaceDirectory,
  normalizeDialogSessions,
  orderRootSessions,
  sessionNavigationEntries,
} from "./session-list-data"
import { createSessionActivityIndex } from "../util/session-activity"

const log = Log.create({ service: "tui.dialog-session-list" })

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error) return error
  if (error && typeof error === "object") {
    const candidate = error as { data?: { message?: string }; message?: string }
    return candidate.data?.message ?? candidate.message ?? fallback
  }
  return fallback
}

// Shared implementation for the main session list and the workspace-scoped
// session list (component/workspace/dialog-session-list.tsx re-exports this).
// Without props it behaves as the global session list; `workspaceID` scopes
// the listing to a workspace root, `localOnly` restricts to sessions in the
// current directory.
export function DialogSessionList(props: { workspaceID?: string; localOnly?: boolean; navigation?: boolean } = {}) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()
  const toast = useToast()
  const local = useLocal()

  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)

  const [listed, listedActions] = createResource(
    () => props.workspaceID,
    createAbortableResourceFetcher<string | undefined, Session[]>(
      async (workspaceID: string | undefined, signal, info) => {
        if (!workspaceID) return undefined
        try {
          const result = await sdk.client.session.list({ directory: workspaceID, roots: true }, { signal })
          if (result.error) {
            if (!signal.aborted) {
              log.warn("workspace session list load failed", { error: result.error, workspaceID })
              toast.show({
                message: errorMessage(result.error, "Failed to load workspace sessions"),
                variant: "error",
              })
            }
            return info.value
          }
          return normalizeDialogSessions(result.data)
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
        if (result.error) {
          if (!signal.aborted) {
            log.warn(props.workspaceID ? "workspace session list search failed" : "session list search failed", {
              error: result.error,
              query,
              workspaceID: props.workspaceID,
            })
            toast.show({
              message: errorMessage(result.error, "Failed to search sessions"),
              variant: "error",
            })
          }
          return info.value
        }
        return normalizeDialogSessions(result.data)
      } catch (error) {
        log.warn(props.workspaceID ? "workspace session list search failed" : "session list search failed", {
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
      return sync.data.session.filter(
        (session) => session.directory === localWorkspaceDirectory(sdk.directory, sync.data.path.directory),
      )
    return sync.data.session
  })

  const options = createMemo(() => {
    const activity = createSessionActivityIndex({
      sessions: sync.data.session,
      statuses: sync.data.session_status,
      permissions: sync.data.permission,
      questions: sync.data.question,
    })
    const today = new Date().toDateString()
    const pinnedIDs = local.session.pinned()
    const slotByID = new Map<string, number>(local.session.slots().map((id, i) => [id, i + 1]))

    const allSessions = sessions()
      .filter((x: Session) => {
        if (x.parentID !== undefined) return false
        if (props.workspaceID && listed()) return true
        if (props.workspaceID) return x.directory === props.workspaceID
        if (props.localOnly) return x.directory === localWorkspaceDirectory(sdk.directory, sync.data.path.directory)
        return true
      })
      .toSorted((a: Session, b: Session) => b.time.updated - a.time.updated)

    const pinnedSet = new Set(pinnedIDs.filter((id) => allSessions.some((s) => s.id === id)))
    const ordered = props.navigation
      ? sessionNavigationEntries(sessions(), pinnedIDs, "all")
      : orderRootSessions(allSessions, pinnedIDs).map((session) => ({ session, depth: 0 }))

    return ordered.map(({ session: x, depth }) => {
      const isPinned = pinnedSet.has(x.id)
      const date = new Date(x.time.updated)
      let category = date.toDateString()
      if (category === today) category = "Today"
      if (isPinned) category = "Pinned"
      if (props.navigation) category = "Sessions and agents"
      const isDeleting = toDelete() === x.id
      const observed =
        sdk.sseConnected && sync.data.session_loaded && x.directory === (sdk.directory ?? sync.data.path.directory)
      const state = observed ? activity.get(x.id) : undefined
      const isWorking = state?.working && !state.attention
      const slot = slotByID.get(x.id)
      const gutter = isWorking ? <Spinner /> : slot !== undefined ? <text fg={theme.accent}>{slot}</text> : undefined
      return {
        title: isDeleting
          ? `Press ${keybind.print("session_delete")} again to confirm`
          : `${"  ".repeat(Math.min(depth, 3))}${x.title}`,
        description: state?.label,
        descriptionFg: state?.attention ? theme.warning : theme.textMuted,
        bg: isDeleting ? theme.error : undefined,
        value: x.id,
        category,
        footer: Locale.time(x.time.updated),
        gutter,
      }
    })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title={
        props.navigation
          ? "Session navigation"
          : props.workspaceID
            ? "Workspace Sessions"
            : props.localOnly
              ? "Local Sessions"
              : "Sessions"
      }
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
          keybind: keybind.all.session_pin_toggle?.[0],
          title: "pin/unpin",
          onTrigger: (option) => {
            local.session.togglePin(option.value)
          },
        },
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              const deleted = await sdk.client.session
                .delete({
                  sessionID: option.value,
                })
                .then((result) => !result.error)
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
