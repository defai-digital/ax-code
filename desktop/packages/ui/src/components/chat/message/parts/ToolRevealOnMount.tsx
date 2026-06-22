import React from "react"

interface ToolRevealOnMountProps {
  children: React.ReactNode
  animate: boolean
  wipe?: boolean
  delayMs?: number
  className?: string
}

export const ToolRevealOnMount: React.FC<ToolRevealOnMountProps> = ({
  children,
  animate,
  wipe = true,
  delayMs = 0,
  className,
}) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  const clearRevealStyles = React.useCallback((target: HTMLElement | null) => {
    if (!target) {
      return
    }
    target.style.opacity = ""
    // target.style.filter = '';
    target.style.transform = ""
  }, [])

  React.useLayoutEffect(() => {
    const el = rootRef.current

    if (!animate) {
      clearRevealStyles(el)
      return
    }

    if (!el || typeof window === "undefined") {
      return
    }

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      clearRevealStyles(el)
      return
    }

    el.style.opacity = "0"
    // el.style.filter = wipe ? 'blur(3px)' : 'blur(2px)';
    el.style.transform = wipe ? "translateX(-0.06em)" : "translateY(0.04em)"

    let animation: Animation | null = null
    const frame = window.requestAnimationFrame(() => {
      const node = rootRef.current
      if (!node) {
        return
      }

      const keyframes: Keyframe[] = [
        {
          opacity: 0,
          transform: wipe ? "translateX(-0.06em)" : "translateY(0.04em)",
        },
        { opacity: 1, transform: wipe ? "translateX(0)" : "translateY(0)" },
      ]

      animation = node.animate(keyframes, {
        duration: 500,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        delay: delayMs,
        fill: "forwards",
      })

      animation.finished
        .catch(() => undefined)
        .finally(() => {
          const target = rootRef.current
          clearRevealStyles(target)
        })
    })

    return () => {
      window.cancelAnimationFrame(frame)
      animation?.cancel()
      clearRevealStyles(el)
    }
  }, [animate, clearRevealStyles, delayMs, wipe])

  return (
    <div ref={rootRef} className={className}>
      {children}
    </div>
  )
}
