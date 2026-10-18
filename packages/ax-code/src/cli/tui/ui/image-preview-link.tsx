import type { FilePart } from "@ax-code/sdk/v2"
import { MouseButton, type RGBA } from "ax-tui"
import { useRenderer } from "ax-tui/solid"
import type { JSX } from "solid-js"
import { isImagePreviewCandidate } from "./image-preview-source"

export function ImagePreviewLink(props: {
  file: FilePart
  onOpen?: (file: FilePart) => void
  fg: RGBA
  paddingLeft?: number
  children: JSX.Element
}) {
  const renderer = useRenderer()
  let press: { x: number; y: number } | undefined
  return (
    <text
      fg={props.fg}
      paddingLeft={props.paddingLeft}
      onMouseDown={(event) => {
        press = event.button === MouseButton.LEFT ? { x: event.x, y: event.y } : undefined
      }}
      onMouseUp={(event) => {
        const click = press && press.x === event.x && press.y === event.y
        press = undefined
        if (!click || event.button !== MouseButton.LEFT || renderer.getSelection()?.getSelectedText()) return
        if (!props.onOpen || !isImagePreviewCandidate(props.file)) return
        event.stopPropagation()
        props.onOpen(props.file)
      }}
    >
      {props.children}
    </text>
  )
}
