import React from "react"

export type SidebarResizeEdge = "left" | "right"

interface UseSidebarResizeOptions {
  /** Which side of the window the panel sits on. Left panels grow rightward, right panels grow leftward. */
  edge: SidebarResizeEdge
  isOpen: boolean
  isMobile?: boolean
  width: number
  setWidth: (width: number) => void
  defaultWidth: number
  minWidth: number
  maxWidth: number
  /** CSS custom property kept in sync with the live width while dragging. */
  cssVariable: string
}

export function useSidebarResize({
  edge,
  isOpen,
  isMobile = false,
  width,
  setWidth,
  defaultWidth,
  minWidth,
  maxWidth,
  cssVariable,
}: UseSidebarResizeOptions) {
  const [isResizing, setIsResizing] = React.useState(false)
  const startXRef = React.useRef(0)
  const startWidthRef = React.useRef(width || defaultWidth)
  const resizingWidthRef = React.useRef<number | null>(null)
  const activeResizePointerIDRef = React.useRef<number | null>(null)
  const sidebarRef = React.useRef<HTMLElement | null>(null)

  const clampWidth = React.useCallback(
    (value: number) => {
      return Math.min(maxWidth, Math.max(minWidth, value))
    },
    [minWidth, maxWidth],
  )

  const applyLiveWidth = React.useCallback(
    (nextWidth: number) => {
      const sidebar = sidebarRef.current
      if (!sidebar) {
        return
      }

      sidebar.style.width = `${nextWidth}px`
      sidebar.style.minWidth = `${nextWidth}px`
      sidebar.style.maxWidth = `${nextWidth}px`
      sidebar.style.setProperty(cssVariable, `${nextWidth}px`)
    },
    [cssVariable],
  )

  React.useEffect(() => {
    if (isMobile && isResizing) {
      setIsResizing(false)
    }
  }, [isMobile, isResizing])

  React.useEffect(() => {
    if (!isResizing) {
      resizingWidthRef.current = null
      activeResizePointerIDRef.current = null
    }
  }, [isResizing])

  const openWidth = Math.min(maxWidth, Math.max(minWidth, width || defaultWidth))
  const appliedWidth = isOpen ? openWidth : 0

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!isOpen) {
      return
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // ignore
    }

    activeResizePointerIDRef.current = event.pointerId
    setIsResizing(true)
    startXRef.current = event.clientX
    startWidthRef.current = appliedWidth
    resizingWidthRef.current = appliedWidth
    applyLiveWidth(appliedWidth)
    event.preventDefault()
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    if (isMobile || !isResizing || activeResizePointerIDRef.current !== event.pointerId) {
      return
    }

    const delta = edge === "left" ? event.clientX - startXRef.current : startXRef.current - event.clientX
    const nextWidth = clampWidth(startWidthRef.current + delta)
    if (resizingWidthRef.current === nextWidth) {
      return
    }

    resizingWidthRef.current = nextWidth
    applyLiveWidth(nextWidth)
  }

  const handlePointerEnd = (event: React.PointerEvent) => {
    if (activeResizePointerIDRef.current !== event.pointerId || isMobile) {
      return
    }

    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }

    const finalWidth = clampWidth(resizingWidthRef.current ?? appliedWidth)
    activeResizePointerIDRef.current = null
    resizingWidthRef.current = null
    setIsResizing(false)
    setWidth(finalWidth)
  }

  const currentWidth = isResizing ? (resizingWidthRef.current ?? appliedWidth) : appliedWidth

  // For right-edge panels ArrowLeft widens the panel (it grows leftward) and ArrowRight narrows it.
  const handleResizeKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16
    let nextWidth: number

    switch (event.key) {
      case "ArrowLeft":
        nextWidth = edge === "left" ? openWidth - step : openWidth + step
        break
      case "ArrowRight":
        nextWidth = edge === "left" ? openWidth + step : openWidth - step
        break
      case "Home":
        nextWidth = minWidth
        break
      case "End":
        nextWidth = maxWidth
        break
      default:
        return
    }

    event.preventDefault()
    setWidth(clampWidth(nextWidth))
  }

  return {
    sidebarRef,
    isResizing,
    openWidth,
    appliedWidth,
    currentWidth,
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    handleResizeKeyDown,
  }
}
