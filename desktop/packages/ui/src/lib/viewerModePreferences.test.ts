import { describe, expect, test } from "vitest"
import {
  readJsonViewModePreference,
  readPreviewViewModePreference,
  saveJsonViewModePreference,
  savePreviewViewModePreference,
} from "./viewerModePreferences"

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe("viewer mode preferences", () => {
  test("reads preview modes from raw and legacy JSON string values", () => {
    const storage = createMemoryStorage()

    storage.setItem("mode", "preview")
    expect(readPreviewViewModePreference(storage, "mode", "edit")).toBe("preview")

    storage.setItem("mode", JSON.stringify("edit"))
    expect(readPreviewViewModePreference(storage, "mode", "preview")).toBe("edit")
  })

  test("falls back for missing or invalid preview modes", () => {
    const storage = createMemoryStorage()

    expect(readPreviewViewModePreference(storage, "missing", "edit")).toBe("edit")
    storage.setItem("mode", "tree")
    expect(readPreviewViewModePreference(storage, "mode", "preview")).toBe("preview")
    storage.setItem("mode", "{")
    expect(readPreviewViewModePreference(storage, "mode", "edit")).toBe("edit")
  })

  test("saves preview modes as raw strings", () => {
    const storage = createMemoryStorage()
    savePreviewViewModePreference(storage, "mode", "preview")
    expect(storage.getItem("mode")).toBe("preview")
  })

  test("reads json viewer modes from raw and legacy JSON string values", () => {
    const storage = createMemoryStorage()

    storage.setItem("mode", "tree")
    expect(readJsonViewModePreference(storage, "mode", "text")).toBe("tree")

    storage.setItem("mode", JSON.stringify("text"))
    expect(readJsonViewModePreference(storage, "mode", "tree")).toBe("text")
  })

  test("falls back for invalid json viewer modes and saves raw strings", () => {
    const storage = createMemoryStorage()

    storage.setItem("mode", "preview")
    expect(readJsonViewModePreference(storage, "mode", "tree")).toBe("tree")

    saveJsonViewModePreference(storage, "mode", "text")
    expect(storage.getItem("mode")).toBe("text")
  })
})
