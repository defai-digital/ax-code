import { createSignal, onCleanup, Match, Show, Switch } from "solid-js"
import type { FixedContextOutput } from "@ax-code/sdk/v2"
import { useKeyboard, useTerminalDimensions } from "ax-tui/solid"
import { useSDK } from "@tui/context/sdk"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { fixedContextQuestion, type FixedQuestionState } from "./fixed-context-question"

export function DialogFixedContext() {
  const sdk = useSDK()
  const local = useLocal()
  const model = local.model.current()
  const client = sdk.client
  const directory = sdk.directory
  return (
    <FixedContextDialog
      model={model ? `${model.providerID}/${model.modelID}` : undefined}
      directory={directory}
      run={async (files, question, signal) => {
        if (!model) throw new Error("Select an AX Trust model first.")
        const response = await client.experimental.ask(
          { directory, fixedContextInput: { ...model, files, question } },
          { signal, throwOnError: true },
        )
        if (!response.data) throw new Error("The server returned no answer.")
        return response.data
      }}
    />
  )
}

export function FixedContextDialog(props: {
  model?: string
  directory?: string
  run: (files: string[], question: string, signal: AbortSignal) => Promise<FixedContextOutput>
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [state, setState] = createSignal<FixedQuestionState>({ phase: "files", files: [], question: "" })
  const request = fixedContextQuestion(props.run, setState)
  onCleanup(() => request.close())
  useKeyboard((event) => {
    if (state().phase === "result" && event.name === "r" && !event.ctrl && !event.meta) {
      event.preventDefault()
      request.editQuestion()
    }
  })
  const description = () => (
    <box gap={1}>
      <text fg={theme.textMuted}>Answer only from selected files. Files are reread for each question.</text>
      <text fg={theme.textMuted}>{props.model ?? "Select an AX Trust model first."}</text>
      <Show when={props.directory}>{(directory) => <text fg={theme.textMuted}>Directory: {directory()}</text>}</Show>
      <Show when={state().error}>{(error) => <text fg={theme.error}>{error()}</text>}</Show>
    </box>
  )
  // A stable renderable root keeps dialog phase changes from remounting its state.
  return (
    <box>
      <Switch>
        <Match when={state().phase === "files"}>
          <DialogPrompt
            title="Ask about fixed files"
            placeholder="One relative file path per line"
            value={state().files.join("\n")}
            description={description}
            autoClose={false}
            onConfirm={request.files}
          />
        </Match>
        <Match when={state().phase === "question"}>
          <DialogPrompt
            title="Question about selected files"
            placeholder="What does this function return?"
            value={state().question}
            autoClose={false}
            onConfirm={request.submit}
            description={() => (
              <box gap={1}>
                {description()}
                <text fg={theme.textMuted}>{state().files.join(", ")}</text>
                <text fg={theme.primary} onMouseUp={request.editFiles}>
                  Change files
                </text>
              </box>
            )}
          />
        </Match>
        <Match when={state().phase === "pending"}>
          <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
            <text fg={theme.text}>Asking AX Trust...</text>
            <text fg={theme.textMuted}>Escape closes this question and cancels the request.</text>
          </box>
        </Match>
        <Match when={state().phase === "result"}>
          <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
            <text fg={theme.primary}>AX Trust cache: {state().result?.cache.status}</text>
            <scrollbox focused height={Math.max(3, Math.min(12, dimensions().height - 12))}>
              <text fg={theme.text} wrapMode="word">
                {state().result?.answer}
              </text>
            </scrollbox>
            <Show when={state().result?.requestID}>{(id) => <text fg={theme.textMuted}>Request: {id()}</text>}</Show>
            <text fg={theme.primary} onMouseUp={request.editQuestion}>
              r Ask another question
            </text>
            <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
              esc Close
            </text>
          </box>
        </Match>
      </Switch>
    </box>
  )
}
