import { useLanguage } from "@tui/context/language"
import type { useSDK } from "@tui/context/sdk"
import { createSignal, Show } from "solid-js"
import { TextAttributes } from "ax-tui"
import z from "zod"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { useKeyboard } from "ax-tui/solid"
import { responseErrorMessage } from "@tui/util/error-message"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { urlAllowlistServerRoute } from "@tui/util/server-url"

/** Minimal SDK surface the btw route needs; the full useSDK satisfies it. */
export type BtwSdk = Pick<ReturnType<typeof useSDK>, "url" | "directory" | "fetch">

const BtwResponse = z.object({ answer: z.string() })

/**
 * POST /session/:sessionID/btw (ADR-213). Raw fetch instead of the generated
 * SDK client so the TUI works before the SDK regenerates the typed method.
 * The 60s client cap leaves headroom over the server's 30s generation timeout.
 */
export async function askBtwSideQuestion(input: { sdk: BtwSdk; sessionID: string; question: string }) {
  const response = await input.sdk.fetch(
    urlAllowlistServerRoute(input.sdk.url, `/session/${encodeURIComponent(input.sessionID)}/btw`),
    {
      method: "POST",
      headers: directoryRequestHeaders({ directory: input.sdk.directory, contentType: "application/json" }),
      body: JSON.stringify({ question: input.question }),
      signal: AbortSignal.timeout(60_000),
    },
  )
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  return BtwResponse.parse(await response.json())
}

export type DialogBtwRequest = (question: string) => Promise<{ answer: string }>

/** Request factory kept out of the JSX path so tests can verify the wiring. */
export function btwRequestFactory(sdk: BtwSdk, sessionID: string): DialogBtwRequest {
  return (question) => askBtwSideQuestion({ sdk, sessionID, question })
}

/** Open the dismissible side-question dialog (ADR-213). */
export function showBtwDialog(input: { dialog: DialogContext; sdk: BtwSdk; sessionID: string; question: string }) {
  const request = btwRequestFactory(input.sdk, input.sessionID)
  const question = input.question
  input.dialog.replace(() => <DialogBtw question={question} request={request} />)
}

/**
 * Dismissible dialog for a /btw side question (ADR-213): shows a loading
 * line while the one-shot answer generates, then the plain-text answer or
 * the failure reason. Nothing here touches the transcript.
 */
export function DialogBtw(props: { question: string; request: DialogBtwRequest }) {
  const uiText = useLanguage().t
  const dialog = useDialog()
  const { theme } = useTheme()
  const [answer, setAnswer] = createSignal<string>()
  const [error, setError] = createSignal<string>()

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") dialog.clear()
  })

  void props
    .request(props.question)
    .then((result) => setAnswer(result.answer))
    .catch((err: unknown) => {
      setError(err instanceof Error ? err.message : uiText("ui.btwFailed"))
    })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {uiText("ui.btwDialogTitle")}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>{props.question}</text>
      <Show
        when={answer()}
        fallback={
          <Show
            when={error()}
            fallback={
              <box paddingBottom={1}>
                <text fg={theme.textMuted}>{uiText("ui.btwLoading")}</text>
              </box>
            }
          >
            <box paddingBottom={1}>
              <text fg={theme.error}>{error()}</text>
            </box>
          </Show>
        }
      >
        <box paddingBottom={1}>
          <text fg={theme.text}>{answer()}</text>
        </box>
      </Show>
    </box>
  )
}
