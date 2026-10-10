import type { Translate } from "../i18n"
import { webMcpChipModel } from "./webmcp-chip-model"
import { webMcpChromeNotice, type WebMcpChromeStatus } from "./webmcp-enable-model"

export type WebMcpToggleModel = {
  servers: string[]
  connected: string[]
  attentions: { name: string }[]
}

export type WebMcpToggleDeps = {
  model: WebMcpToggleModel
  statusOf: (name: string) => string | undefined
  toggle: (name: string) => Promise<unknown>
  /** Advisory Chrome probe for one bridge; failures resolve to undefined. */
  chrome: (name: string) => Promise<WebMcpChromeStatus | undefined>
  warn: (notice: NonNullable<ReturnType<typeof webMcpChromeNotice>>) => void
}

/**
 * Shared by the sidebar chip and `/webmcp`: disconnect what is live and retry
 * what needs attention, otherwise connect every bridge a managed policy has
 * not locked. Before a fresh connect the advisory Chrome probe may warn, but
 * it never blocks: the bridge might find a Chrome the probe does not know.
 */
export async function toggleWebMcpBridges(deps: WebMcpToggleDeps) {
  const { model } = deps
  if (model.connected.length > 0) {
    // Reconcile so a mixed warning marker never dead-ends behind a
    // disconnect-only click.
    await Promise.allSettled([
      ...model.connected.map((name) => deps.toggle(name)),
      ...model.attentions.map(({ name }) => deps.toggle(name)),
    ])
    return
  }
  const targets = model.servers.filter((name) => deps.statusOf(name) !== "blocked")
  if (targets.length === 0) return
  const notice = webMcpChromeNotice(await deps.chrome(targets[0]!).catch(() => undefined))
  if (notice) deps.warn(notice)
  // Toggles reject on a failed connect/disconnect (see dialog-mcp.tsx): settle
  // every bridge so a rejection is handled and the status refresh surfaces the
  // failure, instead of leaking an unhandled rejection per bridge.
  await Promise.allSettled(targets.map((name) => deps.toggle(name)))
}

export type WebMcpTuiContext = {
  t: Translate
  sync: { data: { config?: unknown; mcp?: Record<string, { status?: string } | undefined> } }
  local: { mcp: { toggle: (name: string) => Promise<unknown> } }
  sdk: { client: { mcp: { webMcpChrome: (input: { name: string }) => Promise<{ data?: unknown }> } } }
  toast: { show: (input: { message: string; variant: "warning"; duration?: number }) => void }
}

/** Wire {@link toggleWebMcpBridges} to the live TUI stores for the chip and `/webmcp`. */
export function toggleWebMcpFromTui(ctx: WebMcpTuiContext) {
  const config = ctx.sync.data.config as { mcp?: unknown; webmcp?: unknown } | undefined
  return toggleWebMcpBridges({
    model: webMcpChipModel(config?.mcp, ctx.sync.data.mcp as never, config?.webmcp),
    statusOf: (name) => ctx.sync.data.mcp?.[name]?.status,
    toggle: (name) => ctx.local.mcp.toggle(name),
    chrome: async (name) => (await ctx.sdk.client.mcp.webMcpChrome({ name })).data as WebMcpChromeStatus | undefined,
    warn: (notice) =>
      ctx.toast.show({ message: ctx.t(notice.key, notice.params as never), variant: "warning", duration: 8000 }),
  })
}
