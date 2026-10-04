import { createMemo, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { ModeToggle } from "./mode-chips"
import { webMcpChipModel } from "./webmcp-chip-model"

/**
 * Sidebar footer chip for the experimental WebMCP bridge. It appears only when
 * a webmcp-profiled MCP server is configured, is off by default, and toggles
 * the runtime connections (ephemeral — it never writes the config). A
 * managed-policy denial renders as a locked, non-interactive state so it is
 * never mistaken for an off switch the user can flip; failed and trust-gated
 * bridges render as a warning with the failure reason. Mixed states keep
 * their markers (see webMcpChipModel) so a live sibling never hides a
 * denial or a failure behind a healthy-looking toggle.
 */
export function WebMcpChip() {
  const sync = useSync()
  const local = useLocal()
  const { theme } = useTheme()

  const model = createMemo(() => webMcpChipModel(sync.data.config?.mcp, sync.data.mcp))

  const toggle = () => {
    const current = model()
    if (current.connected.length > 0) {
      // Reconcile: disconnect what is live and retry what needs attention, so
      // a mixed warning marker never dead-ends behind a disconnect-only click.
      for (const name of current.connected) void local.mcp.toggle(name)
      for (const { name } of current.attentions) void local.mcp.toggle(name)
      return
    }
    // Otherwise (re)connect everything that a managed policy has not locked.
    for (const name of current.servers) {
      if (sync.data.mcp?.[name]?.status !== "blocked") void local.mcp.toggle(name)
    }
  }

  const retryAttention = () => {
    // The warning names the failing bridges: retry those instead of fanning
    // out to healthy or disconnected siblings. No attention means the status
    // changed under the click; do nothing rather than toggle unrelated peers.
    for (const { name } of model().attentions) void local.mcp.toggle(name)
  }

  return (
    <Show when={model().servers.length > 0}>
      <Show
        when={model().view === "lock"}
        fallback={
          <Show
            when={model().view === "warning"}
            fallback={
              <ModeToggle
                label={model().label}
                active={model().connected.length > 0}
                activeFg={theme.text}
                inactiveFg={theme.textMuted}
                background={theme.primary}
                onMouseUp={toggle}
              />
            }
          >
            <box flexShrink={0} onMouseUp={retryAttention}>
              <text>
                <span style={{ fg: theme.warning, bold: true }}>{model().warningText}</span>
              </text>
            </box>
          </Show>
        }
      >
        <box flexShrink={0}>
          <text>
            <span style={{ fg: theme.error, bold: true }}>{model().lockText}</span>
          </text>
        </box>
      </Show>
    </Show>
  )
}
