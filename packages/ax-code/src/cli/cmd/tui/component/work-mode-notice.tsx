import { createMemo, Show } from "solid-js"
import { WorkMode } from "@/mode/work-mode"
import { useSync } from "@tui/context/sync"
import { useKV } from "@tui/context/kv"
import { useTheme } from "@tui/context/theme"
import {
  isWorkModeHintSeen,
  WORK_MODE_HINT_SEEN_KEY,
  workModeAvailability,
  workModeHint,
} from "./work-mode-availability"

/** One-line work-mode hint above the prompt (ADR-097): blocked/checking
 *  always, available council/arena on first use only. The chip is the
 *  persistent status once a mode has been submitted. */
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
    return {
      hint: workModeHint(mode, availability, {
        explained: isWorkModeHintSeen(kv.get(WORK_MODE_HINT_SEEN_KEY), mode),
      }),
      blocked: availability.state === "unavailable",
    }
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
