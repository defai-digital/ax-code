import { createEffect, onCleanup, onMount, type Accessor } from "solid-js"
import { base64Encode } from "@ax-code/util/encode"
import { getFilename } from "@ax-code/util/path"
import type { PermissionRequest } from "@ax-code/sdk/v2/client"
import { showToast, toaster } from "@ax-code/ui/toast"
import { playSoundById } from "@/utils/sound"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { workspaceKey } from "./helpers"

type Kind = "permission.asked" | "question.asked"

type Session = {
  id: string
  title?: string
  parentID?: string
}

type Event = {
  name: string
  details?: {
    type?: string
    properties?: Record<string, unknown>
  }
}

type Input = {
  currentDir: Accessor<string | undefined>
  currentSession: Accessor<string | undefined>
  globalSDK: {
    event: {
      listen: (fn: (event: Event) => void) => () => void
    }
  }
  globalSync: {
    child: (directory: string, input: { bootstrap: boolean }) => [{ session: Session[] }, unknown]
  }
  language: {
    t: (key: string, vars?: Record<string, string | number | boolean>) => string
  }
  navigate: (href: string) => void
  permission: {
    autoResponds: (input: PermissionRequest, directory?: string) => boolean
  }
  platform: {
    notify?: (title: string, body: string, href?: string) => Promise<unknown> | unknown
  }
  setBusy: (directory: string, value: boolean) => void
  settings: {
    notifications: {
      permissions: () => boolean
      agent: () => boolean
    }
    sounds: {
      permissionsEnabled: () => boolean
      permissions: () => string
    }
  }
}

export const sessionAlertKey = (directory: string, sessionID: string) => `${directory}:${sessionID}`

export const sessionAlertHref = (directory: string, sessionID: string) =>
  `/${base64Encode(directory)}/session/${sessionID}`

export const sessionAlertContent = (
  kind: Kind,
  t: Input["language"]["t"],
  sessionTitle: string,
  projectName: string,
) => {
  if (kind === "permission.asked") {
    return {
      title: t("notification.permission.title"),
      description: t("notification.permission.description", { sessionTitle, projectName }),
      icon: "checklist" as const,
    }
  }

  return {
    title: t("notification.question.title"),
    description: t("notification.question.description", { sessionTitle, projectName }),
    icon: "bubble-5" as const,
  }
}

export const shouldAlertSession = (now: number, last = 0, cooldown = 5000) => now - last >= cooldown

export const shouldSkipSessionAlert = (input: {
  currentDir?: string
  currentSession?: string
  directory: string
  sessionID: string
  parentID?: string
}) => {
  if (workspaceKey(input.directory) !== workspaceKey(input.currentDir ?? "")) return false
  if (input.sessionID === input.currentSession) return true
  return input.parentID === input.currentSession
}

export const relatedSessionAlertKeys = (directory: string, currentSession: string, sessions: Session[]) => [
  sessionAlertKey(directory, currentSession),
  ...sessions.filter((item) => item.parentID === currentSession).map((item) => sessionAlertKey(directory, item.id)),
]

export function useSDKNotificationToasts(input: Input) {
  onMount(() => {
    const toastBySession = new Map<string, number>()
    const alertedAtBySession = new Map<string, number>()

    const dismiss = (key: string) => {
      const id = toastBySession.get(key)
      if (id === undefined) return
      toaster.dismiss(id)
      toastBySession.delete(key)
      alertedAtBySession.delete(key)
    }

    const unsub = input.globalSDK.event.listen((event) => {
      if (event.details?.type === "worktree.ready") {
        input.setBusy(event.name, false)
        WorktreeState.ready(event.name)
        return
      }

      if (event.details?.type === "worktree.failed") {
        input.setBusy(event.name, false)
        const message = event.details.properties?.message
        WorktreeState.failed(
          event.name,
          typeof message === "string" ? message : input.language.t("common.requestFailed"),
        )
        return
      }

      if (
        event.details?.type === "question.replied" ||
        event.details?.type === "question.rejected" ||
        event.details?.type === "permission.replied"
      ) {
        const sessionID = event.details.properties?.sessionID
        if (typeof sessionID === "string") dismiss(sessionAlertKey(event.name, sessionID))
        return
      }

      if (event.details?.type !== "permission.asked" && event.details?.type !== "question.asked") return

      const props = event.details.properties
      const sessionID = props?.sessionID
      if (typeof sessionID !== "string") return

      if (
        event.details.type === "permission.asked" &&
        props &&
        input.permission.autoResponds(props as PermissionRequest, event.name)
      )
        return

      const [store] = input.globalSync.child(event.name, { bootstrap: false })
      const session = store.session.find((item) => item.id === sessionID)
      const key = sessionAlertKey(event.name, sessionID)
      const sessionTitle = session?.title ?? input.language.t("command.session.new")
      const projectName = getFilename(event.name)
      const alert = sessionAlertContent(event.details.type, input.language.t, sessionTitle, projectName)
      const href = sessionAlertHref(event.name, sessionID)

      const now = Date.now()
      const last = alertedAtBySession.get(key) ?? 0
      if (!shouldAlertSession(now, last)) return
      alertedAtBySession.set(key, now)

      if (event.details.type === "permission.asked") {
        if (input.settings.sounds.permissionsEnabled()) {
          void playSoundById(input.settings.sounds.permissions())
        }
        if (input.settings.notifications.permissions()) {
          void input.platform.notify?.(alert.title, alert.description, href)
        }
      }

      if (event.details.type === "question.asked" && input.settings.notifications.agent()) {
        void input.platform.notify?.(alert.title, alert.description, href)
      }

      if (
        shouldSkipSessionAlert({
          currentDir: input.currentDir(),
          currentSession: input.currentSession(),
          directory: event.name,
          sessionID,
          parentID: session?.parentID,
        })
      )
        return

      dismiss(key)

      const id = showToast({
        persistent: true,
        icon: alert.icon,
        title: alert.title,
        description: alert.description,
        actions: [
          {
            label: input.language.t("notification.action.goToSession"),
            onClick: () => input.navigate(href),
          },
          {
            label: input.language.t("common.dismiss"),
            onClick: "dismiss",
          },
        ],
      })
      toastBySession.set(key, id)
    })
    onCleanup(unsub)

    createEffect(() => {
      const directory = input.currentDir()
      const sessionID = input.currentSession()
      if (!directory || !sessionID) return
      const [store] = input.globalSync.child(directory, { bootstrap: false })
      for (const key of relatedSessionAlertKeys(directory, sessionID, store.session)) {
        dismiss(key)
      }
    })
  })
}
