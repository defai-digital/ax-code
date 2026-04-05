import { batch, createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import type { AssistantMessage, UserMessage } from "@ax-code/sdk/v2"
import type { Prompt } from "@/context/prompt"
import { same } from "@/utils/same"

const emptyTabs: string[] = []

type Tabs = {
  active: Accessor<string | undefined>
  all: Accessor<string[]>
}

type TabsInput = {
  tabs: Accessor<Tabs>
  pathFromTab: (tab: string) => string | undefined
  normalizeTab: (tab: string) => string
  review?: Accessor<boolean>
  hasReview?: Accessor<boolean>
}

export const getSessionKey = (dir: string | undefined, id: string | undefined) => `${dir ?? ""}${id ? `/${id}` : ""}`

export const createSessionTabs = (input: TabsInput) => {
  const review = input.review ?? (() => false)
  const hasReview = input.hasReview ?? (() => false)
  const contextOpen = createMemo(() => input.tabs().active() === "context" || input.tabs().all().includes("context"))
  const openedTabs = createMemo(
    () => {
      const seen = new Set<string>()
      return input
        .tabs()
        .all()
        .flatMap((tab) => {
          if (tab === "context" || tab === "review") return []
          const value = input.pathFromTab(tab) ? input.normalizeTab(tab) : tab
          if (seen.has(value)) return []
          seen.add(value)
          return [value]
        })
    },
    emptyTabs,
    { equals: same },
  )
  const activeTab = createMemo(() => {
    const active = input.tabs().active()
    if (active === "context") return active
    if (active === "review" && review()) return active
    if (active && input.pathFromTab(active)) return input.normalizeTab(active)

    const first = openedTabs()[0]
    if (first) return first
    if (contextOpen()) return "context"
    if (review() && hasReview()) return "review"
    return "empty"
  })
  const activeFileTab = createMemo(() => {
    const active = activeTab()
    if (!openedTabs().includes(active)) return
    return active
  })
  const closableTab = createMemo(() => {
    const active = activeTab()
    if (active === "context") return active
    if (!openedTabs().includes(active)) return
    return active
  })

  return {
    contextOpen,
    openedTabs,
    activeTab,
    activeFileTab,
    closableTab,
  }
}

export const focusTerminalById = (id: string) => {
  const wrapper = document.getElementById(`terminal-wrapper-${id}`)
  const terminal = wrapper?.querySelector('[data-component="terminal"]')
  if (!(terminal instanceof HTMLElement)) return false

  const textarea = terminal.querySelector("textarea")
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus()
    return true
  }

  terminal.focus()
  terminal.dispatchEvent(
    typeof PointerEvent === "function"
      ? new PointerEvent("pointerdown", { bubbles: true, cancelable: true })
      : new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
  )
  return true
}

const skip = new Set(["Alt", "Control", "Meta", "Shift"])

export const visibleUserMessages = (messages: UserMessage[], revert?: string) => {
  if (!revert) return messages
  return messages.filter((message) => message.id < revert)
}

export const lastCompletedAssistant = (messages: (AssistantMessage | UserMessage)[], parent?: string) => {
  let fallback: AssistantMessage | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i]
    if (item.role !== "assistant") continue
    if (typeof item.time.completed !== "number" || item.error) continue
    if (!fallback) fallback = item
    if (parent && item.parentID === parent) return item
  }

  return fallback
}

export const reviewStats = <T>(diffs: readonly T[], kind: (diff: T) => "added" | "modified" | "deleted") => {
  const out = {
    all: diffs.length,
    added: 0,
    modified: 0,
    deleted: 0,
  }

  for (const diff of diffs) {
    out[kind(diff)]++
  }

  return out
}

export const filterReviewDiffs = <T>(
  diffs: readonly T[],
  pick: "all" | "added" | "modified" | "deleted",
  kind: (diff: T) => "added" | "modified" | "deleted",
) => {
  if (pick === "all") return [...diffs]
  return diffs.filter((diff) => kind(diff) === pick)
}

export const selectedReviewFile = <T extends { file: string }>(diffs: readonly T[], active?: string) => {
  if (active && diffs.some((diff) => diff.file === active)) return active
  return diffs[0]?.file
}

type PromptPart = {
  type: string
  content?: string
  filename?: string
}

export const promptDraftLine = (parts: PromptPart[], attachmentLabel: string) => {
  const text = parts
    .map((part) => (part.type === "image" ? `[image:${part.filename}]` : part.content ?? ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
  if (text) return text
  return `[${attachmentLabel}]`
}

export const updateSessionInfo = <T extends { id: string }>(list: readonly T[], next: T) => {
  const idx = list.findIndex((item) => item.id === next.id)
  if (idx < 0) return [...list]
  const out = list.slice()
  out[idx] = next
  return out
}

export const updateSessionRevert = <T extends { id: string; revert?: unknown }>(
  list: readonly T[],
  sessionID: string,
  revert: T["revert"],
) => {
  const idx = list.findIndex((item) => item.id === sessionID)
  if (idx < 0) return [...list]
  const out = list.slice()
  out[idx] = { ...out[idx], revert }
  return out
}

export const isSessionBusy = (
  status: { type: string } | undefined,
  messages: readonly (AssistantMessage | UserMessage)[],
) => {
  if ((status ?? { type: "idle" }).type !== "idle") return true
  return messages.some((item) => item.role === "assistant" && typeof item.time.completed !== "number")
}

export const nextUserMessage = (messages: readonly UserMessage[], id: string) => messages.find((item) => item.id > id)

export const revertPlan = (input: {
  sessionID: string
  messageID: string
  draft: (id: string) => Prompt
}) => ({
  request: {
    sessionID: input.sessionID,
    messageID: input.messageID,
  },
  revert: {
    messageID: input.messageID,
  },
  prompt: input.draft(input.messageID),
})

export const restorePlan = (input: {
  sessionID: string
  messageID: string
  messages: readonly UserMessage[]
  draft: (id: string) => Prompt
}) => {
  const next = nextUserMessage(input.messages, input.messageID)
  if (!next) {
    return {
      request: {
        type: "unrevert" as const,
        sessionID: input.sessionID,
      },
      revert: undefined,
      reset: true,
    }
  }

  return {
    request: {
      type: "revert" as const,
      sessionID: input.sessionID,
      messageID: next.id,
    },
    revert: {
      messageID: next.id,
    },
    prompt: input.draft(next.id),
    reset: false,
  }
}

export const rolledMessages = (
  messages: readonly UserMessage[],
  revertID: string | undefined,
  text: (id: string) => string,
) => {
  if (!revertID) return []
  return messages.filter((item) => item.id >= revertID).map((item) => ({ id: item.id, text: text(item.id) }))
}

export const shouldFocusTerminalOnKeyDown = (event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">) => {
  if (skip.has(event.key)) return false
  return !(event.ctrlKey || event.metaKey || event.altKey)
}

export const createOpenReviewFile = (input: {
  showAllFiles: () => void
  tabForPath: (path: string) => string
  openTab: (tab: string) => void
  setActive: (tab: string) => void
  loadFile: (path: string) => any | Promise<void>
}) => {
  return (path: string) => {
    batch(() => {
      input.showAllFiles()
      const maybePromise = input.loadFile(path)
      const open = () => {
        const tab = input.tabForPath(path)
        input.openTab(tab)
        input.setActive(tab)
      }
      if (maybePromise instanceof Promise) maybePromise.then(open)
      else open()
    })
  }
}

export const createOpenSessionFileTab = (input: {
  normalizeTab: (tab: string) => string
  openTab: (tab: string) => void
  pathFromTab: (tab: string) => string | undefined
  loadFile: (path: string) => void
  openReviewPanel: () => void
  setActive: (tab: string) => void
}) => {
  return (value: string) => {
    const next = input.normalizeTab(value)
    input.openTab(next)

    const path = input.pathFromTab(next)
    if (!path) return

    input.loadFile(path)
    input.openReviewPanel()
    input.setActive(next)
  }
}

export const getTabReorderIndex = (tabs: readonly string[], from: string, to: string) => {
  const fromIndex = tabs.indexOf(from)
  const toIndex = tabs.indexOf(to)
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return undefined
  return toIndex
}

export const createSizing = () => {
  const [state, setState] = createStore({ active: false })
  let t: number | undefined

  const stop = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", false)
  }

  const start = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", true)
  }

  onMount(() => {
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    window.addEventListener("blur", stop)
    onCleanup(() => {
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      window.removeEventListener("blur", stop)
    })
  })

  onCleanup(() => {
    if (t !== undefined) clearTimeout(t)
  })

  return {
    active: () => state.active,
    start,
    touch() {
      start()
      t = window.setTimeout(stop, 120)
    },
  }
}

export type Sizing = ReturnType<typeof createSizing>
