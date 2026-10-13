import { WebMcpProfile } from "./webmcp-profile"

/** Runtime-owned authority; page annotations and serialized metadata cannot grant it. */
export namespace WebMcpAutoApproval {
  type Admission = { permission: string; patterns: readonly string[] }
  type Binding = Admission & {
    tier: "pages" | "read" | "interact" | "invoke" | "desktop"
    fullAccessOnly: boolean
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
    bindings.delete(metadata)
    if (
      metadata.requireInteractive === true ||
      metadata.originGrant === true ||
      operation.requireInteractive === true ||
      operation.originGrant === true ||
      !WebMcpProfile.allows(policy.toolName, policy.profile)
    )
      return
    const readGrant = operation.readGrant === true
    const interactGrant = operation.interactGrant === true
    const interactAction = operation.interactAction === true
    // Grant markers must describe a supported operation of that same tier.
    // In particular, a page invocation can never downgrade itself to a read.
    if (Number(readGrant) + Number(interactGrant) + Number(interactAction) > 1) return
    if (
      readGrant &&
      (!policy.profile.read ||
        (!WebMcpProfile.READ_SCOPE_TOOLS.some((name) => name === policy.toolName) && policy.toolName !== "wait_for"))
    )
      return
    if ((interactGrant || interactAction) && !WebMcpProfile.isInteractTool(policy.toolName)) return
    // ADR-189: classify the actual runtime tool, not page annotations. The
    // broader action set requires the user's full-access Auto selection.
    const tier: Binding["tier"] | undefined = readGrant
      ? "read"
      : interactGrant || interactAction
        ? "interact"
        : PAGE_TOOLS.has(policy.toolName)
          ? "pages"
          : policy.toolName === "close_page"
            ? "pages"
            : policy.toolName === "execute_webmcp_tool"
              ? "invoke"
              : undefined
    if (!tier) return
    const fullAccessOnly = interactAction || policy.toolName === "close_page" || tier === "invoke"
    bindings.set(metadata, { ...admission, patterns: [...admission.patterns], tier, fullAccessOnly, valid })
  }

  export function bindDesktopListing(
    metadata: Record<string, unknown>,
    admission: Admission,
    valid: () => Promise<boolean>,
  ) {
    bindDesktop(metadata, admission, valid, "list")
  }

  export function bindDesktop(
    metadata: Record<string, unknown>,
    admission: Admission,
    valid: () => Promise<boolean>,
    operation: "list" | "invoke",
  ) {
    bindings.delete(metadata)
    if (metadata.requireInteractive === true || metadata.originGrant === true) return
    bindings.set(metadata, {
      ...admission,
      patterns: [...admission.patterns],
      tier: "desktop",
      fullAccessOnly: operation === "invoke",
      valid,
    })
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
