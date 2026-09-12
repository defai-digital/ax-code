import { createMemo, Show } from "solid-js"
import { WorkMode } from "@/mode/work-mode"
import { useSync } from "@tui/context/sync"
import { useKV } from "@tui/context/kv"
import { useTheme } from "@tui/context/theme"
import { workModeAvailability, workModeHint } from "./work-mode-availability"

/** Persistent one-line work-mode hint above the prompt (ADR-097): says what a
 *  Council/Arena prompt will do — or why submit is blocked — before it is
 *  sent. Fully reactive, like the chip row. */
export function WorkModeNotice() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const view = createMemo(() => {
    const mode = WorkMode.parse(kv.get("work_mode", WorkMode.DEFAULT))
    const availability = workModeAvailability({
      mode,
      providers: sync.data.provider,
      providerLoaded: sync.data.provider_loaded,
      config: sync.data.config?.modes,
    })
    return { hint: workModeHint(mode, availability), blocked: availability.state === "unavailable" }
  })
  return (
    <Show when={view().hint}>
      {(text) => (
        <box flexShrink={0} paddingLeft={2}>
          <text fg={view().blocked ? theme.warning : theme.textMuted}>{text()}</text>
        </box>
      )}
    </Show>
  )
}
