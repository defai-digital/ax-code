/** Default deadline for MCP connect, request, and tool-list operations. */
export const MCP_DEFAULT_TIMEOUT_MS = 30_000

/** Total connect attempts per remote transport, including the first try. */
export const MCP_CONNECT_ATTEMPTS = 2

/** Delay between transient remote-connect retries. Keep short so a hard failure stays fast. */
export const MCP_CONNECT_RETRY_DELAY_MS = 250

/** How long `tools()` waits for startup connects before returning whatever is already up. */
export const MCP_TOOLS_READY_WAIT_MS = 5_000

/** Official Figma endpoints used by registration diagnostics and Desktop setup. */
export const FIGMA_MCP_ORIGIN = "https://mcp.figma.com"
export const FIGMA_MCP_REQUIREMENTS_URL =
  "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/"
export const FIGMA_DESKTOP_MCP_URL = "http://127.0.0.1:3845/mcp"
