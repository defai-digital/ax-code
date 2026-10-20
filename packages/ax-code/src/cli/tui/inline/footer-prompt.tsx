import { Prompt, type PromptRef } from "../component/prompt"

export function FooterPrompt(props: {
  sessionID?: string
  rows: number
  onRows: (rows: number) => void
  ref?: (ref: PromptRef) => void
}) {
  return (
    <Prompt sessionID={props.sessionID} inline maxInputRows={props.rows} onDraftRows={props.onRows} ref={props.ref} />
  )
}
