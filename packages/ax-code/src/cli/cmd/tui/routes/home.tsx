import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, createSignal, on, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Logo } from "../component/logo"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRoute, useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import type { AssistantMessage } from "@ax-code/sdk/v2"

export function Home() {
  const { theme } = useTheme()
  const route = useRouteData("home")
  const router = useRoute()
  const promptRef = usePromptRef()
  const sync = useSync()
  const [pendingSessionID, setPendingSessionID] = createSignal<string>()

  let prompt: PromptRef
  let once = false
  let pendingNavigation = false
  const args = useArgs()
  const local = useLocal()
  onMount(() => {
    if (once) return
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
    }
  })

  // Wait for the model store to be ready before auto-submitting --prompt.
  createEffect(
    on(
      () => local.model.ready,
      (ready) => {
        if (!ready) return
        if (!args.prompt) return
        if (prompt.current?.input !== args.prompt) return
        prompt.submit()
      },
    ),
  )

  const pendingMessages = createMemo(() => {
    const sessionID = pendingSessionID()
    if (!sessionID) return []
    return sync.data.message[sessionID] ?? []
  })
  const pendingAssistant = createMemo(() => pendingMessages().findLast((message) => message.role === "assistant") as
    | AssistantMessage
    | undefined)
  const pendingSessionSettled = createMemo(() => {
    const assistant = pendingAssistant()
    if (!assistant) return false
    return !!assistant.time.completed || !!assistant.error
  })

  createEffect(() => {
    const sessionID = pendingSessionID()
    if (!sessionID) return
    if (!pendingSessionSettled()) return
    if (pendingNavigation) return
    pendingNavigation = true
    setTimeout(() => {
      router.navigate({
        type: "session",
        sessionID,
      })
    }, 0)
  })

  const directory = useDirectory()

  const contentWidth = 75

  return (
    <>
      <box flexGrow={1} flexDirection="row">
        <box width={2} flexShrink={0} />
        <box flexGrow={1} alignItems="center">
          <box flexGrow={1} />
          <box height={4} flexShrink={0} />
          <box flexShrink={0}>
            <Logo />
          </box>
          <box height={2} flexShrink={0} />
          <box width="100%" maxWidth={contentWidth} zIndex={1000} flexShrink={0}>
            <Prompt
              ref={(r) => {
                prompt = r
                promptRef.set(r)
              }}
              workspaceID={route.workspaceID}
              minimalChrome
              onSessionCreated={(sessionID) => {
                pendingNavigation = false
                setPendingSessionID(sessionID)
              }}
            />
          </box>
          <box flexGrow={1} />
        </box>
        <box width={2} flexShrink={0} />
      </box>
      <box height={1} flexShrink={0} />
      <box flexDirection="row" flexShrink={0}>
        <box width={2} flexShrink={0} />
        <text fg={theme.textMuted}>{directory()}</text>
        <box flexGrow={1} />
        <text fg={theme.textMuted}>{Installation.VERSION}</text>
        <box width={2} flexShrink={0} />
      </box>
      <box height={1} flexShrink={0} />
    </>
  )
}
