import { afterEach, describe, expect, test } from "bun:test"
import { Clipboard } from "@tui/util/clipboard"
import { Selection } from "@tui/util/selection"

const originalCopy = Clipboard.copy

afterEach(() => {
  Clipboard.copy = originalCopy
})

describe("Selection.copy", () => {
  test("clears the current selection only after clipboard copy succeeds", async () => {
    let resolveCopy!: () => void
    Clipboard.copy = (() => new Promise<void>((resolve) => {
      resolveCopy = resolve
    })) as typeof Clipboard.copy

    let cleared = 0
    const renderer = {
      getSelection: () => ({ getSelectedText: () => "selected text" }),
      clearSelection: () => {
        cleared++
      },
    }
    const shown: string[] = []
    const errors: unknown[] = []
    const toast = {
      show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => {
        shown.push(input.message)
      },
      error: (error: unknown) => {
        errors.push(error)
      },
    }

    expect(Selection.copy(renderer, toast)).toBe(true)
    expect(cleared).toBe(0)

    resolveCopy()
    await Promise.resolve()

    expect(cleared).toBe(1)
    expect(shown).toEqual(["Copied to clipboard"])
    expect(errors).toEqual([])
  })

  test("preserves the current selection when clipboard copy fails", async () => {
    const failure = new Error("copy failed")
    Clipboard.copy = (() => Promise.reject(failure)) as typeof Clipboard.copy

    let cleared = 0
    const renderer = {
      getSelection: () => ({ getSelectedText: () => "selected text" }),
      clearSelection: () => {
        cleared++
      },
    }
    const shown: string[] = []
    const errors: unknown[] = []
    const toast = {
      show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => {
        shown.push(input.message)
      },
      error: (error: unknown) => {
        errors.push(error)
      },
    }

    expect(Selection.copy(renderer, toast)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(cleared).toBe(0)
    expect(shown).toEqual([])
    expect(errors).toEqual([failure])
  })
})
