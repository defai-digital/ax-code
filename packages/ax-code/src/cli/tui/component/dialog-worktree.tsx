import { useLanguage } from "@tui/context/language"
import type { useSDK } from "@tui/context/sdk"
import { createSignal, For, Show } from "solid-js"
import { TextAttributes } from "ax-tui"
import z from "zod"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { useKeyboard } from "ax-tui/solid"
import { responseErrorMessage } from "@tui/util/error-message"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { urlAllowlistServerRoute } from "@tui/util/server-url"

/** Minimal SDK surface the worktree routes need; the full useSDK satisfies it. */
export type WorktreeSdk = Pick<ReturnType<typeof useSDK>, "url" | "directory" | "fetch">

const WorktreeInfo = z.object({ name: z.string(), branch: z.string(), directory: z.string() })
export type WorktreeInfo = z.infer<typeof WorktreeInfo>

const WorktreeListItem = z.object({ name: z.string(), directory: z.string(), branch: z.string().optional() })
export type WorktreeListItem = z.infer<typeof WorktreeListItem>

const WorktreeList = z.array(WorktreeListItem)

/**
 * Worktree and session-move routes (ADR-233). Raw fetch instead of the generated
 * SDK client so the TUI works before the SDK regenerates the typed methods.
 */
export async function createWorktree(input: { sdk: WorktreeSdk; name?: string }) {
  const response = await input.sdk.fetch(urlAllowlistServerRoute(input.sdk.url, "/worktree"), {
    method: "POST",
    headers: directoryRequestHeaders({ directory: input.sdk.directory, contentType: "application/json" }),
    body: JSON.stringify(input.name ? { name: input.name } : {}),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  return WorktreeInfo.parse(await response.json())
}

export async function listWorktrees(input: { sdk: WorktreeSdk }): Promise<WorktreeListItem[]> {
  const response = await input.sdk.fetch(urlAllowlistServerRoute(input.sdk.url, "/worktree"), {
    method: "GET",
    headers: directoryRequestHeaders({ directory: input.sdk.directory, accept: "application/json" }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  return WorktreeList.parse(await response.json())
}

export async function removeWorktree(input: { sdk: WorktreeSdk; directory: string }) {
  const response = await input.sdk.fetch(urlAllowlistServerRoute(input.sdk.url, "/worktree"), {
    method: "DELETE",
    headers: directoryRequestHeaders({ directory: input.sdk.directory, contentType: "application/json" }),
    body: JSON.stringify({ directory: input.directory }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  return response.json()
}

export async function moveSessionToDirectory(input: { sdk: WorktreeSdk; sessionID: string; directory: string }) {
  const response = await input.sdk.fetch(
    urlAllowlistServerRoute(input.sdk.url, `/session/${encodeURIComponent(input.sessionID)}/move`),
    {
      method: "POST",
      headers: directoryRequestHeaders({ directory: input.sdk.directory, contentType: "application/json" }),
      body: JSON.stringify({ targetDirectory: input.directory }),
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  return response.json()
}

/** Resolve a user-supplied `name` or `directory` against the project's worktrees. */
export function matchWorktree(items: WorktreeListItem[], target: string): WorktreeListItem | undefined {
  return items.find((item) => item.name === target || item.directory === target)
}

/** Open the read-only worktree list dialog. */
export function showWorktreeListDialog(input: { dialog: DialogContext; sdk: WorktreeSdk }) {
  input.dialog.replace(() => <DialogWorktreeList sdk={input.sdk} />)
}

/** Read-only list of the current project's worktrees (ADR-233). */
export function DialogWorktreeList(props: { sdk: WorktreeSdk }) {
  const uiText = useLanguage().t
  const dialog = useDialog()
  const { theme } = useTheme()
  const [items, setItems] = createSignal<WorktreeListItem[]>()
  const [error, setError] = createSignal<string>()

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") dialog.clear()
  })

  void listWorktrees({ sdk: props.sdk })
    .then((rows) => setItems(rows))
    .catch((err: unknown) => setError(err instanceof Error ? err.message : uiText("ui.worktreeFailed")))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {uiText("ui.worktreeListTitle")}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show
        when={items()}
        fallback={
          <Show when={error()} fallback={<text fg={theme.textMuted}>{uiText("ui.worktreeLoading")}</text>}>
            <text fg={theme.error}>{error()}</text>
          </Show>
        }
      >
        <Show when={items()!.length > 0} fallback={<text fg={theme.textMuted}>{uiText("ui.worktreeListEmpty")}</text>}>
          <For each={items()!}>
            {(item) => (
              <box flexDirection="column">
                <text fg={theme.text}>{item.name}</text>
                <text fg={theme.textMuted}>{item.branch ? `${item.branch} - ${item.directory}` : item.directory}</text>
              </box>
            )}
          </For>
        </Show>
      </Show>
    </box>
  )
}
