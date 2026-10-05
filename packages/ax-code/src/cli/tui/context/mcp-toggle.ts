/**
 * Connect or disconnect one MCP server from a TUI control, then re-read the
 * status. connect/disconnect publish no bus event, so without an explicit
 * refresh the store keeps the stale status and the control (for example the
 * sidebar WebMCP chip) looks like it ignored the click.
 */
export async function toggleMcpServer(input: {
  connected: boolean
  connect: () => Promise<unknown>
  disconnect: () => Promise<unknown>
  refresh: () => Promise<void>
}) {
  try {
    if (input.connected) await input.disconnect()
    else await input.connect()
  } finally {
    await input.refresh().catch(() => undefined)
  }
}
