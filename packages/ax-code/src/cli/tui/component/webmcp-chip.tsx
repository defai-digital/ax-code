import { createMemo, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { isRecord } from "@/util/record"
import { ModeToggle } from "./mode-chips"

/**
 * Sidebar footer chip for the experimental WebMCP bridge. It appears only when
 * a webmcp-profiled MCP server is configured, is off by default, and toggles
 * the runtime connection (ephemeral — it never writes the config). A
 * managed-policy denial renders as a locked, non-interactive state so it is
 * never mistaken for an off switch the user can flip.
 */
export function WebMcpChip() {
  const sync = useSync()
  const local = useLocal()
  const { theme } = useTheme()

  const server = createMemo(() => {
    for (const [name, entry] of Object.entries(sync.data.config?.mcp ?? {})) {
      if (isRecord(entry) && isRecord((entry as { webmcp?: unknown }).webmcp)) return name
    }
    return undefined
  })
  const status = createMemo(() => {
    const name = server()
    return name ? sync.data.mcp[name]?.status : undefined
  })

  return (
    <Show when={server()}>
      {(name) => (
        <Show
          when={status() !== "blocked"}
          fallback={
            <box flexShrink={0}>
              <text>
                <span style={{ fg: theme.error, bold: true }}>🔒 WebMCP</span>
              </text>
            </box>
          }
        >
          <ModeToggle
            label="WebMCP"
            active={status() === "connected"}
            activeFg={theme.text}
            inactiveFg={theme.textMuted}
            background={theme.primary}
            onMouseUp={() => void local.mcp.toggle(name())}
          />
        </Show>
      )}
    </Show>
  )
}
