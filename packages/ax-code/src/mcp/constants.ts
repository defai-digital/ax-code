/** Default deadline for MCP connect, request, and tool-list operations. */
export const MCP_DEFAULT_TIMEOUT_MS = 30_000

/** Total connect attempts per remote transport, including the first try. */
export const MCP_CONNECT_ATTEMPTS = 2

/** Delay between transient remote-connect retries. Keep short so a hard failure stays fast. */
export const MCP_CONNECT_RETRY_DELAY_MS = 250

/** How long `tools()` waits for startup connects before returning whatever is already up. */
export const MCP_TOOLS_READY_WAIT_MS = 5_000
