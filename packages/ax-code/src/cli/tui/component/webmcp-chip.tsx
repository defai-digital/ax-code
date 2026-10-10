import { createMemo, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useLanguage } from "@tui/context/language"
import { useTheme } from "@tui/context/theme"
import { ChromeAction } from "./chrome-action"
import { useCommandDialog } from "./dialog-command"
import { ModeToggle } from "./mode-chips"
import { webMcpChipModel, webMcpServers } from "./webmcp-chip-model"

/**
 * Accent-colored link beside the WebMCP chip that opens the project-scoped
 * allowlist dialog (ADR-178) through the `app.webmcp.allowlist` command, so
 * the same entry is reachable from the command palette and `/webmcp-allowlist`.
 * It shares the chip's visibility rule: a webmcp-profiled server must exist.
 */
export function WebMcpAllowlistLink() {
  const sync = useSync()
  const { theme } = useTheme()
  const { t } = useLanguage()
  const command = useCommandDialog()
  const servers = createMemo(() => webMcpServers(sync.data.config?.mcp))
  return (
    <Show when={servers().length > 0}>
      <box flexShrink={0} paddingLeft={1}>
        <ChromeAction link fg={theme.accent} onMouseUp={() => command.trigger("app.webmcp.allowlist")}>
          {t("ui.webMcpAllowlist")}
        </ChromeAction>
      </box>
    </Show>
  )
}

/**
 * Toggle chip for the experimental WebMCP bridge, rendered in the session
 * sidebar footer and, on Home, in the prompt footer's right-side hint row
 * (after ModeChips, via the Prompt `footerRight` prop). It appears only when
 * a webmcp-profiled MCP server is configured, is off by default, and toggles
 * the runtime connections; for user-configured webmcp entries the toggle also
 * persists the enabled state to the user config (ADR-170). A
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

  const model = createMemo(() =>
    webMcpChipModel(
      sync.data.config?.mcp,
      sync.data.mcp,
      (sync.data.config as { webmcp?: unknown } | undefined)?.webmcp,
    ),
  )

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
                background={theme.error}
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
