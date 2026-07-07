/**
 * Input Store — pending input text, synthetic parts, and attached files.
 * Extracted from session-ui-store for subscription isolation.
 */

import { create } from "zustand"
import type { AttachedFile } from "@/stores/types/sessionTypes"

let attachmentReadGeneration = 0

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
    reader.onabort = () => reject(new Error("File read aborted"))
    reader.readAsDataURL(file)
  })

const getDataUrlByteSize = (url: string): number => {
  if (!url.startsWith("data:")) return 0
  const commaIndex = url.indexOf(",")
  if (commaIndex < 0) return 0
  const metadata = url.slice(0, commaIndex).toLowerCase()
  const payload = url.slice(commaIndex + 1)
  if (!metadata.endsWith(";base64")) return 0
  let padding = 0
  if (payload.endsWith("==")) {
    padding = 2
  } else if (payload.endsWith("=")) {
    padding = 1
  }
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

export type SyntheticContextPart = {
  text: string
  attachments?: AttachedFile[]
  synthetic?: boolean
}

export type InputState = {
  pendingInputText: string | null
  pendingInputMode: "replace" | "append" | "append-inline"
  pendingSyntheticParts: SyntheticContextPart[] | null
  /**
   * Text a draft preset chip asked to submit immediately. Set by surfaces that
   * render the chips outside ChatInput (e.g. under the welcome message on
   * narrow layouts); consumed by ChatInput, which owns the command-aware submit.
   */
  pendingPresetSubmit: string | null
  attachedFiles: AttachedFile[]

  setPendingInputText: (text: string | null, mode?: "replace" | "append" | "append-inline") => void
  consumePendingInputText: () => { text: string; mode: "replace" | "append" | "append-inline" } | null
  requestPresetSubmit: (text: string) => void
  consumePendingPresetSubmit: () => string | null
  setPendingSyntheticParts: (parts: SyntheticContextPart[] | null) => void
  consumePendingSyntheticParts: () => SyntheticContextPart[] | null
  addAttachedFile: (file: File) => Promise<void>
  removeAttachedFile: (id: string) => void
  setAttachedFiles: (files: AttachedFile[]) => void
  clearAttachedFiles: () => void
  /** Add attachments restored from a reverted message (file already on server) */
  addRestoredAttachment: (file: { url: string; mimeType: string; filename: string }) => void
  addMcpResourceAttachment: (resource: { client: string; name: string; uri: string; mimeType?: string }) => void
}

export const useInputStore = create<InputState>()((set, get) => ({
  pendingInputText: null,
  pendingInputMode: "replace",
  pendingSyntheticParts: null,
  pendingPresetSubmit: null,
  attachedFiles: [],

  setPendingInputText: (text, mode = "replace") => set({ pendingInputText: text, pendingInputMode: mode }),

  consumePendingInputText: () => {
    const { pendingInputText, pendingInputMode } = get()
    if (pendingInputText === null) return null
    set({ pendingInputText: null, pendingInputMode: "replace" })
    return { text: pendingInputText, mode: pendingInputMode }
  },

  requestPresetSubmit: (text) => set({ pendingPresetSubmit: text }),

  consumePendingPresetSubmit: () => {
    const { pendingPresetSubmit } = get()
    if (pendingPresetSubmit === null) return null
    set({ pendingPresetSubmit: null })
    return pendingPresetSubmit
  },

  setPendingSyntheticParts: (parts) => set({ pendingSyntheticParts: parts }),

  consumePendingSyntheticParts: () => {
    const { pendingSyntheticParts } = get()
    if (pendingSyntheticParts !== null) {
      set({ pendingSyntheticParts: null })
    }
    return pendingSyntheticParts
  },

  addAttachedFile: async (file: File) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const generation = attachmentReadGeneration
    let dataUrl: string
    try {
      dataUrl = await readFileAsDataUrl(file)
    } catch {
      return
    }
    if (generation !== attachmentReadGeneration) return
    const attached: AttachedFile = {
      id,
      file,
      dataUrl,
      mimeType: file.type,
      filename: file.name,
      size: file.size,
      source: "local",
    }
    set((s) => ({ attachedFiles: [...s.attachedFiles, attached] }))
  },

  removeAttachedFile: (id) => set((s) => ({ attachedFiles: s.attachedFiles.filter((f) => f.id !== id) })),

  setAttachedFiles: (files) => {
    attachmentReadGeneration += 1
    set({ attachedFiles: files })
  },

  clearAttachedFiles: () => {
    attachmentReadGeneration += 1
    set({ attachedFiles: [] })
  },

  addRestoredAttachment: ({ url, mimeType, filename }) => {
    const id = `restored-${Date.now()}-${Math.random().toString(36).slice(2)}`
    // Use "local" source so the file renders in AttachedFilesList.
    // Set serverPath to the URL so ImagePreview can use it as the img src
    // when dataUrl is not a data: URL. sanitizeAttachmentsForSend leaves
    // dataUrl alone for non-server sources, so the URL stays intact on send.
    const attached: AttachedFile = {
      id,
      file: new File([], filename, { type: mimeType }),
      dataUrl: url,
      mimeType,
      filename,
      size: getDataUrlByteSize(url),
      source: "local",
      serverPath: url,
    }
    set((s) => ({ attachedFiles: [...s.attachedFiles, attached] }))
  },

  addMcpResourceAttachment: (resource) => {
    const filename = resource.name.trim() || resource.uri.split("/").filter(Boolean).pop() || resource.uri
    const mimeType = resource.mimeType?.trim() || "text/plain"
    const attached: AttachedFile = {
      id: `mcp-resource-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file: new File([], filename, { type: mimeType }),
      dataUrl: resource.uri,
      mimeType,
      filename,
      size: 0,
      source: "mcp-resource",
      resource: {
        clientName: resource.client,
        uri: resource.uri,
      },
    }
    set((s) => ({ attachedFiles: [...s.attachedFiles, attached] }))
  },
}))
