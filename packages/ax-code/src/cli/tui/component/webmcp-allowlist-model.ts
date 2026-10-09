import type { PermissionRequest, WebMcpApprovalSummary } from "@ax-code/sdk/v2"

export function canSaveWebMcpApproval(request: PermissionRequest, stagedRequestID?: string) {
  return (
    request.permission === "webmcp" &&
    !!request.webmcpAllowlist &&
    request.metadata.requireInteractive !== true &&
    (stagedRequestID === undefined || stagedRequestID === request.id)
  )
}

export function webMcpAllowlistPreview(summary: WebMcpApprovalSummary): string[] {
  const clean = (value: string) => value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "")
  const { scope } = summary
  return [
    `Bridge: ${clean(summary.server)}`,
    "Scope: this project, on this machine; saved across restarts.",
    ...(scope.capability === "list_pages"
      ? [
          "Permission: list all open pages in the AX Code browser.",
          "Page titles and URLs can include sites from multiple origins.",
          "Future list_pages calls will run without this prompt.",
          "This does not approve navigation, page reads or page actions.",
        ]
      : [
          `Origin: ${clean(scope.origin)}`,
          scope.capability === "read"
            ? "Permission: snapshots, screenshots, console and network metadata on this origin."
            : scope.capability === "close"
              ? "Permission: close any browser page currently on this origin."
              : "Permission: open and navigate pages to this origin.",
          ...(scope.capability === "close" ? ["Closing a page can discard unsaved work on it."] : []),
          "Future matching calls will run without this prompt.",
          "Other origins and other page actions keep their existing approvals.",
        ]),
    "Navigation restrictions and administrator policy still apply.",
    "Remove saved approvals from MCP settings (Manage WebMCP allowlist).",
  ]
}

export function permissionOptionsStack(width: number, labels: readonly string[]) {
  return (
    width <
    Math.max(
      80,
      labels.reduce((total, label) => total + label.length + 3, 8),
    )
  )
}
