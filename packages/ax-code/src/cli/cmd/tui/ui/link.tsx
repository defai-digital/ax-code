import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
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

  return (
    <text
      fg={props.fg}
      onMouseUp={() => {
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
