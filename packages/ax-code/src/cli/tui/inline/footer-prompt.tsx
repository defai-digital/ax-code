import { Prompt, type PromptRef } from "../component/prompt"

export function FooterPrompt(props: {
  sessionID?: string
  disabled?: boolean
  rows: number
  onRows: (rows: number) => void
  ref?: (ref: PromptRef) => void
}) {
  return (
    <Prompt
      disabled={props.disabled}
      sessionID={props.sessionID}
      inline
      maxInputRows={props.rows}
      onDraftRows={props.onRows}
      ref={props.ref}
    />
  )
}
