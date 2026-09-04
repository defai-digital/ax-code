import path from "path"
import { produce } from "solid-js/store"
import { decodePasteBytes, type PasteEvent } from "@ax-code/tui"
import type { FilePart } from "@ax-code/sdk/v2"
import { stringWidth } from "@/bun/node-compat"
import { Filesystem } from "@/util/filesystem"
import { Clipboard } from "../../util/clipboard"
import { parsePastedFilePath } from "./prompt-filepath"
import { windowsClipboardTextPaste } from "./view-model"
import type { PromptInfo } from "./history"

type PromptPasteComposer = {
  visualCursor: { offset: number }
  insertText: (text: string) => void
  extmarks: {
    create: (opts: { start: number; end: number; virtual: boolean; styleId: number; typeId: number }) => number
  }
}

type PromptPasteStore = {
  prompt: { parts: PromptInfo["parts"] }
}

export type PromptPasteHost = {
  input: PromptPasteComposer
  store: PromptPasteStore
  setStore: (...args: any[]) => void
  pasteStyleId: number
  promptPartTypeId: () => number
  inputBlocked: () => boolean
  disablePasteSummary: () => boolean
  suppressAutocompleteForNextContentChange: () => void
  requestInputLayoutRefresh: (options?: { autocomplete?: boolean }) => void
  pasteSubmitGate: {
    beginPasteHandling: () => void
    finishPasteHandling: (options?: { submitDeferred?: boolean }) => void
  }
  log: { warn: (message: string, extra?: Record<string, unknown>) => void }
  toast: { show: (input: { message: string; variant: "error" | "warning" | "info" | "success" }) => void }
}

export function createPromptPaste(host: PromptPasteHost) {
  function pasteText(text: string, virtualText: string) {
    const currentOffset = host.input.visualCursor.offset
    const extmarkStart = currentOffset
    // extmark offsets are display-width (cell) units, not UTF-16 length —
    // a non-ASCII filename in the SVG placeholder would otherwise misplace
    // extmarkEnd and desync the highlighted range from the inserted text.
    const extmarkEnd = extmarkStart + stringWidth(virtualText)

    host.suppressAutocompleteForNextContentChange()
    host.input.insertText(virtualText + " ")

    const extmarkId = host.input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: host.pasteStyleId,
      typeId: host.promptPartTypeId(),
    })

    host.setStore(
      produce((draft: PromptPasteStore & { extmarkToPartIndex: Map<number, number> }) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    host.requestInputLayoutRefresh({ autocomplete: false })
  }

  async function pasteImage(file: { filename?: string; content: string; mime: string }) {
    const currentOffset = host.input.visualCursor.offset
    const extmarkStart = currentOffset
    const count = host.store.prompt.parts.filter((x) => x.type === "file" && x.mime.startsWith("image/")).length
    const virtualText = `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    host.suppressAutocompleteForNextContentChange()
    host.input.insertText(textToInsert)

    const extmarkId = host.input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: host.pasteStyleId,
      typeId: host.promptPartTypeId(),
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    host.setStore(
      produce((draft: PromptPasteStore & { extmarkToPartIndex: Map<number, number> }) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    host.requestInputLayoutRefresh({ autocomplete: false })
    return
  }

  async function pasteClipboardImage() {
    const content = await Clipboard.read()
    if (!content?.mime.startsWith("image/")) return false
    await pasteImage({
      filename: "clipboard",
      mime: content.mime,
      content: content.data,
    })
    return true
  }

  async function handleTerminalPaste(event: PasteEvent) {
    if (host.inputBlocked()) {
      event.preventDefault()
      return
    }

    let submitDeferred: boolean | undefined
    host.pasteSubmitGate.beginPasteHandling()
    try {
      // Normalize line endings at the boundary.
      // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste.
      const normalizedText = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      const pastedContent = normalizedText.trim()
      if (!normalizedText) {
        event.preventDefault()
        submitDeferred = await pasteClipboardImage()
        return
      }

      // Drag/drop into terminal arrives as pasted text with shell-style
      // backslash escapes (spaces, iCloud's com\~apple\~CloudDocs,
      // parentheses, etc.). Decode those before filesystem access.
      const filepath = parsePastedFilePath(pastedContent)
      const isUrl = /^(https?):\/\//.test(filepath)
      if (pastedContent && !isUrl) {
        try {
          const mime = Filesystem.mimeType(filepath)
          const filename = path.basename(filepath)
          // Handle SVG as raw text content, not as base64 image.
          if (mime === "image/svg+xml") {
            event.preventDefault()
            const content = await Filesystem.readText(filepath).catch((error) => {
              host.log.warn("prompt svg paste read failed", { error, filepath })
              host.toast.show({
                message: error instanceof Error ? error.message : "Failed to read pasted SVG",
                variant: "error",
              })
              return undefined
            })
            if (content) {
              pasteText(content, `[SVG: ${filename ?? "image"}]`)
              return
            }
            // Fall through to plain-text paste if read failed.
          } else if (mime.startsWith("image/")) {
            event.preventDefault()
            const content = await Filesystem.readArrayBuffer(filepath)
              .then((buffer) => Buffer.from(buffer).toString("base64"))
              .catch((error) => {
                host.log.warn("prompt image paste read failed", { error, filepath, mime })
                host.toast.show({
                  message: error instanceof Error ? error.message : "Failed to read pasted image",
                  variant: "error",
                })
                return undefined
              })
            if (content) {
              await pasteImage({
                filename,
                mime,
                content,
              })
              return
            }
            // Fall through to plain-text paste if read failed.
          }
        } catch {}
      }

      const lineCount = (normalizedText.match(/\n/g)?.length ?? 0) + 1
      if ((lineCount >= 3 || normalizedText.length > 150) && !host.disablePasteSummary()) {
        event.preventDefault()
        host.suppressAutocompleteForNextContentChange()
        pasteText(normalizedText, `[Pasted ~${lineCount} lines]`)
        return
      }

      event.preventDefault()
      host.suppressAutocompleteForNextContentChange()
      host.input.insertText(normalizedText)
      host.requestInputLayoutRefresh({ autocomplete: false })
    } finally {
      host.pasteSubmitGate.finishPasteHandling({ submitDeferred })
    }
  }

  async function pasteWindowsClipboardText() {
    host.pasteSubmitGate.beginPasteHandling()
    let handledPaste = false
    try {
      const text = windowsClipboardTextPaste({
        content: await Clipboard.read(),
        platform: process.platform,
      })
      if (!text) return false

      host.input.insertText(text)
      host.requestInputLayoutRefresh({ autocomplete: false })
      handledPaste = true
      return true
    } finally {
      host.pasteSubmitGate.finishPasteHandling({ submitDeferred: handledPaste })
    }
  }

  return {
    pasteText,
    pasteImage,
    pasteClipboardImage,
    handleTerminalPaste,
    pasteWindowsClipboardText,
  }
}
