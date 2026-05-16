import { ParentProps } from "solid-js"
import { Accordion } from "./accordion"

export function StickyAccordionHeader(
  props: ParentProps<{ class?: string; classList?: Record<string, boolean | undefined> }>,
) {
  return (
    <Accordion.Header
      data-component="sticky-accordion-header"
      classList={{
        ...(props.classList ?? {}),
        [props.class ?? ""]: !!props.class,
      }}
    >
      {props.children}
    </Accordion.Header>
  )
}
