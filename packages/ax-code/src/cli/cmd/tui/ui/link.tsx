import type { JSX } from "solid-js"
import type { MouseEvent, RGBA } from "@ax-code/opentui-core"
import { useRenderer } from "@ax-code/opentui-solid"
import open from "open"
import { useToast } from "./toast"
import { Log } from "@/util/log"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
}

/**
 * Link component that renders clickable hyperlinks.
 * Clicking anywhere on the link text opens the URL in the default browser.
 */
export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href
  const toast = useToast()
  const renderer = useRenderer()

  // Track where the press began so that finishing a text-selection drag over
  // the link doesn't open the URL. opentui delivers the terminating mouseup to
  // whatever is under the cursor at release, so a plain click and a drag-end
  // both land here.
  let downX: number | undefined
  let downY: number | undefined

  return (
    <text
      fg={props.fg}
      onMouseDown={(e: MouseEvent) => {
        downX = e.x
        downY = e.y
      }}
      onMouseUp={(e: MouseEvent) => {
        const moved = downX === undefined || downY === undefined || e.x !== downX || e.y !== downY
        downX = undefined
        downY = undefined
        // Bail if the pointer moved (a drag) or a selection was made.
        if (moved) return
        if (renderer.getSelection()?.getSelectedText()) return
        void open(props.href).catch((error) => {
          Log.Default.warn("link open failed", { error, href: props.href })
          toast.show({
            message: error instanceof Error ? error.message : "Failed to open link",
            variant: "error",
          })
        })
      }}
    >
      {displayText}
    </text>
  )
}
