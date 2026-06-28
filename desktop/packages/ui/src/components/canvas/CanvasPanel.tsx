import React from "react"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon/Icon"
import { API_ENDPOINTS, HTTP_DEFAULTS } from "@/lib/http"
import { cn } from "@/lib/utils"

type CanvasNoteElement = {
  id: string
  type: "note"
  x: number
  y: number
  width: number
  height: number
  text: string
  color: "yellow" | "blue" | "green" | "pink"
}

type CanvasImageSlotElement = {
  id: string
  type: "image-slot"
  x: number
  y: number
  width: number
  height: number
  label: string
  role: "reference" | "generated-target"
  assetId: string | null
}

type CanvasElement = CanvasNoteElement | CanvasImageSlotElement

type CanvasDocument = {
  version: 1
  id: "main"
  title: string
  elements: CanvasElement[]
  updatedAt?: string
}

type CanvasPanelProps = {
  directory: string
}

type SaveState = "idle" | "loading" | "saving" | "saved" | "error"

const CANVAS_WIDTH = 1800
const CANVAS_HEIGHT = 1200
const SAVE_DEBOUNCE_MS = 650

const emptyDocument = (): CanvasDocument => ({
  version: 1,
  id: "main",
  title: "Project Canvas",
  elements: [],
})

const createCanvasId = () => `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const buildCanvasUrl = (directory: string): string => {
  const params = new URLSearchParams({ directory })
  return `${API_ENDPOINTS.canvas}?${params.toString()}`
}

const putCanvasDocument = async (directory: string, document: CanvasDocument): Promise<void> => {
  const response = await fetch(buildCanvasUrl(directory), {
    method: HTTP_DEFAULTS.method.put,
    headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
    credentials: "include",
    body: JSON.stringify({ document }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`)
  }
}

const noteColorClass = (color: CanvasNoteElement["color"]): string => {
  if (color === "blue")
    return "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-50"
  if (color === "green") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50"
  }
  if (color === "pink")
    return "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-50"
  return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
}

export const CanvasPanel: React.FC<CanvasPanelProps> = ({ directory }) => {
  const [document, setDocument] = React.useState<CanvasDocument>(() => emptyDocument())
  const [saveState, setSaveState] = React.useState<SaveState>("loading")
  const [error, setError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const loadedRef = React.useRef(false)
  const latestDocumentRef = React.useRef<CanvasDocument>(emptyDocument())
  const hasPendingSaveRef = React.useRef(false)
  const saveTimerRef = React.useRef<number | null>(null)
  const dragRef = React.useRef<{
    id: string
    startX: number
    startY: number
    elementX: number
    elementY: number
  } | null>(null)

  React.useEffect(() => {
    let disposed = false
    loadedRef.current = false
    hasPendingSaveRef.current = false
    setSaveState("loading")
    setError(null)

    void fetch(buildCanvasUrl(directory), {
      method: HTTP_DEFAULTS.method.get,
      headers: HTTP_DEFAULTS.headers.acceptJson,
      credentials: "include",
      cache: HTTP_DEFAULTS.cache.noStore,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`)
        }
        if (!disposed) {
          const nextDocument = (body?.document as CanvasDocument | undefined) ?? emptyDocument()
          latestDocumentRef.current = nextDocument
          setDocument(nextDocument)
          setSaveState("idle")
          loadedRef.current = true
        }
      })
      .catch((loadError: unknown) => {
        if (!disposed) {
          setSaveState("error")
          setError(loadError instanceof Error ? loadError.message : "Failed to load canvas")
        }
      })

    return () => {
      disposed = true
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      if (loadedRef.current && hasPendingSaveRef.current) {
        hasPendingSaveRef.current = false
        void putCanvasDocument(directory, latestDocumentRef.current).catch((saveError: unknown) => {
          console.error("[CanvasPanel] failed to flush pending canvas save", saveError)
        })
      }
    }
  }, [directory])

  const saveDocument = React.useCallback(
    async (nextDocument: CanvasDocument) => {
      setSaveState("saving")
      setError(null)
      try {
        await putCanvasDocument(directory, nextDocument)
        if (latestDocumentRef.current === nextDocument) {
          hasPendingSaveRef.current = false
        }
        setSaveState("saved")
      } catch (saveError) {
        setSaveState("error")
        setError(saveError instanceof Error ? saveError.message : "Failed to save canvas")
      }
    },
    [directory],
  )

  const updateDocument = React.useCallback(
    (updater: (current: CanvasDocument) => CanvasDocument) => {
      setDocument((current) => {
        const next = updater(current)
        latestDocumentRef.current = next
        if (loadedRef.current) {
          hasPendingSaveRef.current = true
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current)
          }
          saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null
            void saveDocument(next)
          }, SAVE_DEBOUNCE_MS)
        }
        return next
      })
    },
    [saveDocument],
  )

  const addNote = React.useCallback(() => {
    const id = createCanvasId()
    updateDocument((current) => ({
      ...current,
      elements: [
        ...current.elements,
        {
          id,
          type: "note",
          x: 120 + current.elements.length * 24,
          y: 120 + current.elements.length * 24,
          width: 260,
          height: 170,
          text: "New note",
          color: "yellow",
        },
      ],
    }))
    setSelectedId(id)
  }, [updateDocument])

  const addImageSlot = React.useCallback(() => {
    const id = createCanvasId()
    updateDocument((current) => ({
      ...current,
      elements: [
        ...current.elements,
        {
          id,
          type: "image-slot",
          x: 180 + current.elements.length * 24,
          y: 180 + current.elements.length * 24,
          width: 320,
          height: 220,
          label: "Generated image slot",
          role: "generated-target",
          assetId: null,
        },
      ],
    }))
    setSelectedId(id)
  }, [updateDocument])

  const updateElement = React.useCallback(
    (id: string, patch: Partial<CanvasElement>) => {
      updateDocument((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === id ? ({ ...element, ...patch } as CanvasElement) : element,
        ),
      }))
    },
    [updateDocument],
  )

  const deleteSelected = React.useCallback(() => {
    if (!selectedId) return
    updateDocument((current) => ({
      ...current,
      elements: current.elements.filter((element) => element.id !== selectedId),
    }))
    setSelectedId(null)
  }, [selectedId, updateDocument])

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      updateElement(drag.id, {
        x: Math.max(0, Math.min(CANVAS_WIDTH - 40, drag.elementX + dx)),
        y: Math.max(0, Math.min(CANVAS_HEIGHT - 40, drag.elementY + dy)),
      })
    },
    [updateElement],
  )

  const stopDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {}
    dragRef.current = null
  }, [])

  const selectedElement = React.useMemo(
    () => document.elements.find((element) => element.id === selectedId) ?? null,
    [document.elements, selectedId],
  )

  const statusText =
    saveState === "loading"
      ? "Loading"
      : saveState === "saving"
        ? "Saving"
        : saveState === "saved"
          ? "Saved"
          : saveState === "error"
            ? "Error"
            : "Ready"

  if (!directory) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6 text-center text-muted-foreground">
        Open a project to use Canvas.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/40 bg-[var(--surface-background)] px-2">
        <Button type="button" size="xs" variant="outline" className="gap-1" onClick={addNote}>
          <Icon name="sticky-note" className="h-3.5 w-3.5" />
          Note
        </Button>
        <Button type="button" size="xs" variant="outline" className="gap-1" onClick={addImageSlot}>
          <Icon name="file-image" className="h-3.5 w-3.5" />
          Image slot
        </Button>
        <Button type="button" size="xs" variant="ghost" disabled={!selectedElement} onClick={deleteSelected}>
          Delete
        </Button>
        <div className="ml-auto min-w-0 truncate typography-micro text-muted-foreground">
          {statusText}
          {error ? `: ${error}` : ""}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:24px_24px]">
        <div
          className="relative"
          style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onPointerDown={() => setSelectedId(null)}
        >
          {document.elements.length === 0 ? (
            <div className="absolute left-16 top-16 max-w-sm rounded-md border border-dashed border-border bg-background/85 p-4 shadow-sm">
              <div className="flex items-center gap-2 typography-ui-label text-foreground">
                <Icon name="sticky-note" className="h-4 w-4" />
                Start a project canvas
              </div>
              <p className="mt-2 typography-micro text-muted-foreground">
                Add notes or image slots to keep visual planning context with this project.
              </p>
            </div>
          ) : null}

          {document.elements.map((element) => {
            const selected = selectedId === element.id
            return (
              <div
                key={element.id}
                className={cn(
                  "absolute select-none rounded-md border shadow-sm outline-none transition-shadow",
                  selected && "ring-2 ring-[var(--interactive-focus-ring)]",
                  element.type === "note"
                    ? noteColorClass(element.color)
                    : "border-dashed border-muted-foreground/50 bg-[var(--surface-elevated)] text-foreground",
                )}
                style={{ left: element.x, top: element.y, width: element.width, height: element.height }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  setSelectedId(element.id)
                  dragRef.current = {
                    id: element.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    elementX: element.x,
                    elementY: element.y,
                  }
                  try {
                    event.currentTarget.parentElement?.setPointerCapture(event.pointerId)
                  } catch {}
                }}
              >
                {element.type === "note" ? (
                  <textarea
                    value={element.text}
                    onChange={(event) => updateElement(element.id, { text: event.target.value })}
                    onPointerDown={(event) => event.stopPropagation()}
                    className="h-full w-full resize-none rounded-md bg-transparent p-3 typography-body outline-none"
                    spellCheck
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
                    <Icon name="file-image" className="h-8 w-8 text-muted-foreground" />
                    <input
                      value={element.label}
                      onChange={(event) => updateElement(element.id, { label: event.target.value })}
                      onPointerDown={(event) => event.stopPropagation()}
                      className="w-full rounded border border-border/60 bg-background px-2 py-1 text-center typography-micro outline-none focus:border-[var(--interactive-focus-ring)]"
                    />
                    <span className="typography-micro text-muted-foreground">
                      {element.width} x {element.height}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default CanvasPanel
