import React, { act } from "react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, type Root } from "react-dom/client"

import { useChatInputDraftPersistence } from "./useChatInputDraftPersistence"
import { CHAT_DRAFT_PERSIST_DEBOUNCE_MS, getDraftKey, getStoredDraft, saveStoredDraft } from "../chatInputDraftPersistence"
import { getConfirmedMentionsKey, loadConfirmedMentions, saveConfirmedMentions } from "../chatInputMentions"

// jsdom in this repo provides no localStorage — install the same Map-backed
// mock used by neighboring store tests (see useOpenInAppsStore.test.ts).
const installMockLocalStorage = (): Storage => {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(String(key))
    },
    setItem: (key, value) => {
      values.set(String(key), String(value))
    },
  }
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  })
  return storage
}

interface HarnessApi {
  setMessage: React.Dispatch<React.SetStateAction<string>>
  confirmedMentionsRef: React.RefObject<Set<string>>
}

interface HarnessProps {
  api: HarnessApi
  sessionId: string | null
  persistChatDraft: boolean
  restoredDraft?: string | null
}

// Mimics the ChatInput mount-time wiring: the message state initializer reads
// the stored draft and records it in initialDraftRef/initialSessionIdRef.
const Harness = ({ api, sessionId, persistChatDraft, restoredDraft = null }: HarnessProps) => {
  const initialDraftRef = React.useRef<string | null>(null)
  const initialSessionIdRef = React.useRef<string | null>(null)
  const [message, setMessage] = React.useState(() => {
    initialSessionIdRef.current = sessionId
    if (restoredDraft) {
      initialDraftRef.current = restoredDraft
    }
    return restoredDraft ?? ""
  })
  const [inputMode, setInputMode] = React.useState<"normal" | "shell">("normal")
  const messageRef = React.useRef(message)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const confirmedMentionsRef = React.useRef<Set<string>>(new Set())

  api.setMessage = setMessage
  api.confirmedMentionsRef = confirmedMentionsRef

  useChatInputDraftPersistence({
    currentSessionId: sessionId,
    persistChatDraft,
    message,
    setMessage,
    setInputMode,
    messageRef,
    textareaRef,
    confirmedMentionsRef,
    initialDraftRef,
    initialSessionIdRef,
  })

  return <textarea ref={textareaRef} value={message} data-input-mode={inputMode} readOnly />
}

describe("useChatInputDraftPersistence", () => {
  let container: HTMLDivElement
  let root: Root
  let storage: Storage
  let api: HarnessApi

  const textarea = (): HTMLTextAreaElement => {
    const element = container.querySelector("textarea")
    expect(element).not.toBeNull()
    return element as HTMLTextAreaElement
  }

  const render = (props: Omit<HarnessProps, "api">) => {
    act(() => {
      root.render(<Harness {...props} api={api} />)
    })
  }

  beforeEach(() => {
    storage = installMockLocalStorage()
    vi.useFakeTimers()
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    api = {} as HarnessApi
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  test("persists a changed draft only after the 500ms debounce", () => {
    render({ sessionId: "s1", persistChatDraft: true })

    act(() => {
      api.setMessage("hello")
    })
    expect(getStoredDraft("s1")).toBe("")

    act(() => {
      vi.advanceTimersByTime(CHAT_DRAFT_PERSIST_DEBOUNCE_MS - 1)
    })
    expect(getStoredDraft("s1")).toBe("")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(getStoredDraft("s1")).toBe("hello")
  })

  test("clears the stored draft when the persist setting is disabled", () => {
    saveStoredDraft("s1", "old draft")
    const removeItem = vi.spyOn(storage, "removeItem")

    render({ sessionId: "s1", persistChatDraft: false })
    expect(getStoredDraft("s1")).toBe("")
    expect(removeItem).toHaveBeenCalledWith(getDraftKey("s1"))

    // Re-running the effect with the same (empty) draft is deduped
    removeItem.mockClear()
    act(() => {
      api.setMessage("typed but not persisted")
    })
    expect(removeItem).not.toHaveBeenCalled()
    expect(getStoredDraft("s1")).toBe("")
  })

  test("saves the old session draft and restores the new session draft on switch", () => {
    saveStoredDraft("s2", "draft for s2")
    render({ sessionId: "s1", persistChatDraft: true })

    act(() => {
      api.setMessage("work in s1")
    })

    render({ sessionId: "s2", persistChatDraft: true })
    expect(getStoredDraft("s1")).toBe("work in s1")
    expect(textarea().value).toBe("draft for s2")

    // The skip flag is consumed: subsequent edits persist normally again
    act(() => {
      api.setMessage("draft for s2 extended")
    })
    act(() => {
      vi.advanceTimersByTime(CHAT_DRAFT_PERSIST_DEBOUNCE_MS)
    })
    expect(getStoredDraft("s2")).toBe("draft for s2 extended")
  })

  test("clears the input without saving on switch when persist is disabled", () => {
    render({ sessionId: "s1", persistChatDraft: false })
    act(() => {
      api.setMessage("ephemeral")
    })

    render({ sessionId: "s2", persistChatDraft: false })
    expect(textarea().value).toBe("")
    expect(getStoredDraft("s1")).toBe("")
  })

  test("restores confirmed mentions on switch and prunes them to the draft on persist", () => {
    saveStoredDraft("s2", "see @a.ts")
    saveConfirmedMentions("s2", new Set(["a.ts", "b.ts"]))
    render({ sessionId: "s1", persistChatDraft: true })

    render({ sessionId: "s2", persistChatDraft: true })
    expect(api.confirmedMentionsRef.current).toEqual(new Set(["a.ts", "b.ts"]))

    act(() => {
      vi.advanceTimersByTime(CHAT_DRAFT_PERSIST_DEBOUNCE_MS)
    })
    expect(loadConfirmedMentions("s2")).toEqual(new Set(["a.ts"]))
    expect(api.confirmedMentionsRef.current).toEqual(new Set(["a.ts"]))
    expect(storage.getItem(getConfirmedMentionsKey("s2"))).toBe(JSON.stringify(["a.ts"]))
  })

  test("selects the restored draft text on mount when persist is enabled", () => {
    saveStoredDraft("s1", "abc")
    render({ sessionId: "s1", persistChatDraft: true, restoredDraft: "abc" })

    expect(textarea().value).toBe("abc")
    expect(textarea().selectionStart).toBe(0)
    expect(textarea().selectionEnd).toBe(3)
  })

  test("clears the restored draft on mount when persist is disabled", () => {
    saveStoredDraft("s1", "abc")
    render({ sessionId: "s1", persistChatDraft: false, restoredDraft: "abc" })

    expect(textarea().value).toBe("")
    expect(getStoredDraft("s1")).toBe("")
  })

  test("flushes the current draft on unmount", () => {
    render({ sessionId: "s1", persistChatDraft: true })
    act(() => {
      api.setMessage("bye")
    })

    act(() => {
      root.unmount()
    })
    expect(getStoredDraft("s1")).toBe("bye")

    // Remount so afterEach unmount does not double-flush stale state
    root = createRoot(container)
  })

  test("does not flush on unmount when persist is disabled", () => {
    render({ sessionId: "s1", persistChatDraft: false })
    act(() => {
      api.setMessage("bye")
    })

    act(() => {
      root.unmount()
    })
    expect(getStoredDraft("s1")).toBe("")

    root = createRoot(container)
  })
})
