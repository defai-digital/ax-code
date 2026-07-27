import { beforeEach, describe, expect, test, vi } from "vitest"

import {
  CHAT_DRAFT_PERSIST_DEBOUNCE_MS,
  getDraftKey,
  getStoredDraft,
  saveStoredDraft,
} from "./chatInputDraftPersistence"

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

describe("chatInputDraftPersistence", () => {
  let storage: Storage

  beforeEach(() => {
    storage = installMockLocalStorage()
    vi.restoreAllMocks()
  })

  test("uses a stable debounce of 500ms", () => {
    expect(CHAT_DRAFT_PERSIST_DEBOUNCE_MS).toBe(500)
  })

  test("builds per-session keys with a 'new' fallback for null sessions", () => {
    expect(getDraftKey("session-1")).toBe("openchamber_chat_input_draft_session-1")
    expect(getDraftKey(null)).toBe("openchamber_chat_input_draft_new")
  })

  test("save/restore round-trips a draft per session", () => {
    saveStoredDraft("session-1", "hello draft")
    saveStoredDraft(null, "new session draft")

    expect(getStoredDraft("session-1")).toBe("hello draft")
    expect(getStoredDraft(null)).toBe("new session draft")
    expect(getStoredDraft("other")).toBe("")
  })

  test("saving an empty draft clears the stored value", () => {
    saveStoredDraft("session-1", "hello draft")
    expect(getStoredDraft("session-1")).toBe("hello draft")

    saveStoredDraft("session-1", "")
    expect(getStoredDraft("session-1")).toBe("")
    expect(storage.getItem(getDraftKey("session-1"))).toBeNull()
  })

  test("returns an empty string when localStorage read fails", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    expect(getStoredDraft("session-1")).toBe("")
  })

  test("ignores localStorage write failures", () => {
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("denied")
    })
    expect(() => saveStoredDraft("session-1", "hello")).not.toThrow()
  })
})
