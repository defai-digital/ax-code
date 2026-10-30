import { TimeToFirstDrawRenderable } from "@defai-digital/ax-tui"
import { extend } from "./elements/index.js"
import type { ExtendedComponentProps } from "./types/elements.js"

extend({ time_to_first_draw: TimeToFirstDrawRenderable })

export type TimeToFirstDrawProps = ExtendedComponentProps<typeof TimeToFirstDrawRenderable>

export const TimeToFirstDraw = (props: TimeToFirstDrawProps) => {
  return <time_to_first_draw {...props} />
}
