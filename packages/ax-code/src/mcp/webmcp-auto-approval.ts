import type { WebMcpProfile } from "./webmcp-profile"

/** Runtime-owned authority; page annotations and serialized metadata cannot grant it. */
export namespace WebMcpAutoApproval {
  type Admission = { permission: string; patterns: readonly string[] }
  type Binding = Admission & {
    tier: "pages" | "read" | "interact" | "desktop"
    valid: () => Promise<boolean>
  }
  const bindings = new WeakMap<object, Binding>()
  const PAGE_TOOLS = new Set(["list_pages", "new_page", "navigate_page", "list_webmcp_tools"])

  export function bindBridge(
    metadata: Record<string, unknown>,
    policy: WebMcpProfile.Policy,
    admission: Admission,
    valid: () => Promise<boolean>,
    operation: Record<string, unknown> = metadata,
  ) {
    if (operation.requireInteractive === true || operation.originGrant === true || operation.interactAction === true)
      return
    const tier =
      operation.readGrant === true && policy.profile.read
        ? "read"
        : operation.interactGrant === true && policy.profile.interact
          ? "interact"
          : PAGE_TOOLS.has(policy.toolName)
            ? "pages"
            : undefined
    if (!tier) return
    bindings.set(metadata, { ...admission, patterns: [...admission.patterns], tier, valid })
  }

  export function bindDesktopListing(
    metadata: Record<string, unknown>,
    admission: Admission,
    valid: () => Promise<boolean>,
  ) {
    bindings.set(metadata, { ...admission, patterns: [...admission.patterns], tier: "desktop", valid })
  }

  export function get(metadata: Record<string, unknown>, permission: string, patterns: readonly string[]) {
    const binding = bindings.get(metadata)
    if (
      !binding ||
      binding.permission !== permission ||
      binding.patterns.length !== patterns.length ||
      binding.patterns.some((pattern, index) => pattern !== patterns[index])
    )
      return undefined
    return binding
  }
}
