// Shared mode chip row (work mode / run mode / sandbox).
//
// Rendered in the session sidebar footer and, on Home, in the prompt footer
// (right-aligned, just before the ctrl+c hint, via the Prompt `footerRight` prop).
// All three states are app-global or directory-scoped and fully populated
// before any session exists, and the cycle/toggle commands are registered
// app-wide, so the row is safe to render on every route.

import { createMemo } from "solid-js"
import { RGBA } from "ax-tui"
import { WorkMode } from "@/mode/work-mode"
import { selectedForeground, useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useKV } from "@tui/context/kv"
import { useCommandDialog } from "@tui/component/dialog-command"
import { runMode, runModeLabel, type RunMode } from "./prompt/run-mode-view-model"
import { footerToggleLabel } from "./prompt/footer-toggle"
import { workModeAvailability, workModeChipView } from "./work-mode-availability"

// Chrome fills come from the active theme so chips follow the palette
// instead of a hardcoded green/blue/purple/pink set. Labels distinguish
// work modes; brand identity stays on the Home logo gradient.

const SANDBOX_LABEL = "Sandbox"

/** Display width of a single chip, including its toggle glyph and padding. */
export function modeChipWidth(label: string) {
  return footerToggleLabel(label, false).length
}

/** Total row width of the three chips in their current state. */
export function modeChipsRowWidth(input: { workMode: WorkMode.Id; runMode: RunMode }) {
  return (
    modeChipWidth(WorkMode.label(input.workMode)) +
    modeChipWidth(runModeLabel(input.runMode)) +
    modeChipWidth(SANDBOX_LABEL)
  )
}

export function ModeChips() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const command = useCommandDialog()

  const chipRunMode = createMemo(() => runMode({ autonomous: sync.data.autonomous, superLong: sync.data.superLong }))
  const chipWorkMode = createMemo(() => WorkMode.parse(kv.get("work_mode", WorkMode.DEFAULT)))
  // Availability follows the reactive provider list and config: provider
  // connect/disconnect, bootstrap, and new-session resets all update the chip
  // with no manual refresh (ADR-097).
  const workModeView = createMemo(() =>
    workModeChipView(
      chipWorkMode(),
      workModeAvailability({
        mode: chipWorkMode(),
        providers: sync.data.provider,
        providerLoaded: sync.data.provider_loaded,
        config: sync.data.config?.modes,
      }),
    ),
  )

  function modeChip(input: {
    label: string
    active: boolean
    activeFg: unknown
    inactiveFg: unknown
    background?: unknown
    onMouseUp: () => void
  }) {
    const fg = input.active
      ? input.background
        ? selectedForeground(theme, input.background as RGBA)
        : input.activeFg
      : input.inactiveFg

    // onMouseUp lives on the wrapping <box>, not the inner <text>: text
    // elements in AX Code TUI primarily handle text selection, and click events
    // on them are unreliable when nested inside a flex box.
    return (
      <box flexShrink={0} onMouseUp={input.onMouseUp}>
        <text>
          <span
            style={{
              fg: fg as RGBA,
              bg: input.active ? (input.background as RGBA) : undefined,
              bold: input.active,
            }}
          >
            {footerToggleLabel(input.label, input.active)}
          </span>
        </text>
      </box>
    )
  }

  return (
    <box flexDirection="row" flexShrink={0}>
      {modeChip({
        // One mode at a time; click cycles to the next available mode.
        // Unavailable modes render hollow with the reason in the label.
        label: workModeView().label,
        active: workModeView().active,
        activeFg: theme.text,
        inactiveFg: theme.textMuted,
        background: theme.primary,
        onMouseUp: () => command.trigger("app.cycle.work_mode"),
      })}
      {modeChip({
        label: runModeLabel(chipRunMode()),
        active: chipRunMode() !== "none",
        activeFg: theme.text,
        inactiveFg: theme.textMuted,
        background: theme.warning,
        onMouseUp: () => command.trigger("app.cycle.run_mode"),
      })}
      {modeChip({
        label: SANDBOX_LABEL,
        active: sync.data.isolation.mode !== "full-access",
        activeFg: theme.text,
        inactiveFg: theme.error,
        background: theme.success,
        onMouseUp: () => command.trigger("app.toggle.sandbox"),
      })}
    </box>
  )
}
