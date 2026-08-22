import { ComputerSession, ComputerUseError, CuaProvider, McpClientError, OcuProvider } from "@ax-code/computer/index"
import type {
  ActionResult,
  ComputerAction,
  ComputerObservation,
  ComputerUseProvider,
  ObserveScope,
} from "@ax-code/computer/index"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

/**
 * Instance-scoped computer-use service and the single source of truth for
 * mapping `computer.provider` config (+ command/args overrides) to a provider
 * instance. Provider selection is manual only — no auto-routing or failover
 * between backends (PRD-2026-08-22 non-goal for early phases). The configured
 * provider is constructed lazily on first use and wrapped in a
 * ComputerSession, which owns the one-active-provider rule and
 * epoch-namespaced element targets. The session is disposed with the instance.
 */
export namespace Computer {
  const log = Log.create({ service: "computer" })

  /** default backend commands and their env overrides, for diagnostics */
  const BACKENDS = {
    cua: { command: "cua-driver mcp", env: "AX_COMPUTER_CUA_COMMAND" },
    ocu: { command: "open-computer-use mcp", env: "AX_COMPUTER_OCU_COMMAND" },
  } as const

  interface State {
    session?: ComputerSession
    /** test hook: provider substitute, bypasses config and process spawning */
    injected?: ComputerUseProvider
    lastScope?: ObserveScope
  }

  const state = Instance.state(
    async (): Promise<State> => ({}),
    async (s) => {
      await s.session?.dispose()
    },
  )

  /** test-only: substitute a provider (undefined clears session + injection) */
  export async function useProvider(provider: ComputerUseProvider | undefined) {
    const s = await state()
    await s.session?.dispose()
    s.session = undefined
    s.injected = provider
  }

  export async function configured(): Promise<boolean> {
    const s = await state()
    if (s.injected) return true
    const cfg = await Config.get()
    return cfg.computer?.provider !== undefined
  }

  function createProvider(computer: Config.Info["computer"]): ComputerUseProvider {
    if (!computer?.provider) {
      throw new Error(
        'Computer use is not configured. Set computer.provider ("cua" or "ocu") in ax-code.json to enable computer tools.',
      )
    }
    // command/args fall through to the providers, which apply the
    // AX_COMPUTER_*_COMMAND env override and then the default command name
    // (precedence: config > env > default).
    const options = { command: computer.command, args: computer.args }
    switch (computer.provider) {
      case "cua":
        return new CuaProvider(options)
      case "ocu":
        return new OcuProvider(options)
    }
  }

  async function session(): Promise<ComputerSession> {
    const s = await state()
    if (!s.session) {
      const provider = s.injected ?? createProvider((await Config.get()).computer)
      log.info("starting computer session", { provider: provider.name, injected: s.injected !== undefined })
      s.session = new ComputerSession(provider)
    }
    return s.session
  }

  /** backend spawn/transport failures get an actionable diagnostic naming the command tried and the env override */
  async function unavailable(err: unknown): Promise<Error> {
    const cfg = await Config.get()
    const provider = cfg.computer?.provider
    const backend = provider ? BACKENDS[provider] : undefined
    const command = cfg.computer?.command ?? backend?.command ?? "unknown"
    const env = backend?.env ?? "AX_COMPUTER_CUA_COMMAND / AX_COMPUTER_OCU_COMMAND"
    const detail = err instanceof Error ? err.message : String(err)
    return new Error(
      `Computer-use backend "${provider ?? "unknown"}" is unavailable (tried "${command}"; override with ${env} or computer.command config). ${detail}`,
      { cause: err },
    )
  }

  /** failures that mean the configured backend itself is not usable */
  function isUnavailable(err: unknown): boolean {
    if (err instanceof McpClientError) return true
    if (err instanceof ComputerUseError) return err.code === "provider_unavailable" || err.code === "provider_error"
    return false
  }

  export async function observe(scope: ObserveScope): Promise<ComputerObservation> {
    const s = await state()
    let observation: ComputerObservation
    try {
      observation = await (await session()).observe(scope)
    } catch (err) {
      if (isUnavailable(err)) throw await unavailable(err)
      throw err
    }
    s.lastScope = scope
    return observation
  }

  export async function act(action: ComputerAction): Promise<ActionResult> {
    try {
      return await (await session()).act(action)
    } catch (err) {
      if (isUnavailable(err)) throw await unavailable(err)
      throw err
    }
  }

  /** Re-observe the most recent scope (verify-after-act); desktop when nothing was observed yet. */
  export async function reobserve(): Promise<ComputerObservation> {
    const s = await state()
    return observe(s.lastScope ?? { desktop: true })
  }

  /** label for permission patterns: the app/window the action lands on */
  export async function scopeLabel(action: ComputerAction): Promise<string | undefined> {
    if (action.type === "launch_app") return `app:${action.app}`
    if (action.type === "activate_window") return `window:${action.windowId}`
    const scope = (await state()).lastScope
    if (!scope) return undefined
    if ("app" in scope) return `app:${scope.app}`
    if ("windowId" in scope) return `window:${scope.windowId}`
    return "desktop"
  }

  export async function status() {
    const s = await state()
    const cfg = await Config.get()
    return {
      configured: s.injected !== undefined || cfg.computer?.provider !== undefined,
      provider: cfg.computer?.provider,
      activeProvider: s.session?.activeProvider.name,
    }
  }
}
