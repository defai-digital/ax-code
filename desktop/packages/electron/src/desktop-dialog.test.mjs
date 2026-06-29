import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { buildDesktopOpenDialogOptions, resolveDesktopDialogOwnerWindow } = require("./desktop-dialog.js")

const windowRef = (destroyed = false) => ({
  isDestroyed: () => destroyed,
})

describe("buildDesktopOpenDialogOptions", () => {
  test("builds sanitized open-file dialog options", () => {
    expect(
      buildDesktopOpenDialogOptions({
        directory: false,
        multiple: true,
        title: " Select File ",
        defaultPath: " /tmp/project ",
        filters: [
          { name: "Markdown", extensions: [" md ", "txt"] },
          { name: "Invalid", extensions: [""] },
        ],
      }),
    ).toEqual({
      properties: ["openFile", "multiSelections"],
      title: "Select File",
      defaultPath: "/tmp/project",
      filters: [{ name: "Markdown", extensions: ["md", "txt"] }],
    })
  })

  test("builds open-directory options by defaulting invalid optional fields away", () => {
    expect(
      buildDesktopOpenDialogOptions({
        directory: true,
        title: " ",
        defaultPath: "",
        filters: "not filters",
      }),
    ).toEqual({
      properties: ["openDirectory"],
    })
  })
})

describe("resolveDesktopDialogOwnerWindow", () => {
  test("uses the sender window before the main-window fallback", () => {
    const senderOwner = windowRef(false)
    const fallback = windowRef(false)
    const BrowserWindow = {
      fromWebContents: (sender) => (sender === "sender-webcontents" ? senderOwner : null),
    }

    expect(resolveDesktopDialogOwnerWindow(BrowserWindow, { sender: "sender-webcontents" }, fallback)).toBe(senderOwner)
  })

  test("falls back when the sender window is missing or destroyed", () => {
    const fallback = windowRef(false)
    const BrowserWindow = {
      fromWebContents: () => windowRef(true),
    }

    expect(resolveDesktopDialogOwnerWindow(BrowserWindow, { sender: "sender-webcontents" }, fallback)).toBe(fallback)
    expect(resolveDesktopDialogOwnerWindow(BrowserWindow, { sender: "sender-webcontents" }, windowRef(true))).toBe(
      undefined,
    )
  })
})
