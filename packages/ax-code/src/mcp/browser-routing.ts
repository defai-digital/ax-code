export namespace BrowserRouting {
  export type Mode = "chrome" | "embedded"
  // Launcher state is captured once. Project configuration and MCP child env
  // overrides cannot change the browser selected for this runtime process.
  const launcher = {
    AX_CODE_BROWSER_MODE: process.env.AX_CODE_BROWSER_MODE,
    AX_CODE_DESKTOP_BROWSER_TOKEN: process.env.AX_CODE_DESKTOP_BROWSER_TOKEN,
  }

  export function resolve(env: { AX_CODE_BROWSER_MODE?: string; AX_CODE_DESKTOP_BROWSER_TOKEN?: string }): Mode {
    const mode = env.AX_CODE_BROWSER_MODE
    if (mode !== undefined && mode !== "chrome" && mode !== "embedded") {
      throw new Error("AX_CODE_BROWSER_MODE must be chrome or embedded")
    }
    // Preserve the existing trusted Desktop launcher identity during rollout.
    return mode ?? (/^[A-Za-z0-9_-]{43}$/.test(env.AX_CODE_DESKTOP_BROWSER_TOKEN ?? "") ? "embedded" : "chrome")
  }

  export function mode(): Mode {
    return resolve(launcher)
  }

  export function externalBridgeBlocked(server: { webmcp?: unknown; type?: string; command?: string[] }): boolean {
    if (mode() !== "embedded") return false
    // Include legacy unprofiled Chrome DevTools registrations, not only the
    // canonical profile. Other MCP servers remain available.
    return (
      server.webmcp !== undefined ||
      (server.type === "local" &&
        Boolean(
          server.command?.some((arg) =>
            // Case-insensitive: Windows resolves command names and suffixes
            // without regard to case, so an uppercase spelling must be blocked
            // too (`CHROME-DEVTOOLS-MCP.CMD`).
            /(?:^|[/\\\s"'=])chrome-devtools-mcp(?:@[^/\\\s"']+)?(?:\.(?:m?js|cjs|cmd|exe))?(?:[/\\\s"']|$)/i.test(arg),
          ),
        ))
    )
  }
}
