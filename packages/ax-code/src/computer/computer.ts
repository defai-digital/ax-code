import { ComputerSession, ComputerUseError, CuaProvider, McpClientError, OcuProvider } from "@ax-code/computer/index"
import type {
  ActionResult,
  AppInfo,
  ComputerAction,
  ComputerObservation,
  ComputerUseProvider,
  ObserveScope,
  WindowInfo,
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

  /** default backend commands and their env overrides, for resolution and diagnostics */
  const BACKENDS = {
    cua: { command: "cua-driver", env: "AX_COMPUTER_CUA_COMMAND" },
    ocu: { command: "open-computer-use", env: "AX_COMPUTER_OCU_COMMAND" },
  } as const

  export interface ResolvedBackend {
    provider: "cua" | "ocu"
    command: string
    args: string[]
    /** env var that overrides the command */
    env: string
  }

  /**
   * Resolve the backend command for a computer config. Precedence:
   * config.command > env override > default command name; args default to
   * ["mcp"]. Shared by the session provider construction and the doctor
   * preflight so both report the exact command that would be spawned.
   */
  export function resolveBackend(computer: Config.Info["computer"]): ResolvedBackend | undefined {
    if (!computer?.provider) return undefined
    const backend = BACKENDS[computer.provider]
    return {
      provider: computer.provider,
      command: computer.command ?? process.env[backend.env] ?? backend.command,
      args: computer.args ?? ["mcp"],
      env: backend.env,
    }
  }

  interface State {
    session?: ComputerSession
    /** test hook: provider substitute, bypasses config and process spawning */
    injected?: ComputerUseProvider
    lastScope?: ObserveScope
    /** recent observe/act history, oldest first, capped at TRAJECTORY_CAP */
    trajectory?: TrajectoryEntry[]
  }

  /**
   * One step of computer-use history. Recorded by the computer_* tools so the
   * model can see its recent GUI trajectory (reflection aid) and so a future
   * behavior judge can render a behavior narrative from it.
   */
  export interface TrajectoryEntry {
    /** epoch milliseconds */
    at: number
    kind: "observe" | "act" | "plan"
    /** e.g. "observe desktop", "click element e1:3" */
    summary: string
    /** act outcome; omitted for observes and plans */
    ok?: boolean
    /** backend refusal code or error detail */
    detail?: string
  }

  const TRAJECTORY_CAP = 20

  const state = Instance.state(
    async (): Promise<State> => ({}),
    async (s) => {
      await s.session?.dispose()
    },
  )

  /** append one step to the instance's computer-use trajectory (ring buffer) */
  export async function record(entry: Omit<TrajectoryEntry, "at">) {
    const s = await state()
    const trajectory = (s.trajectory ??= [])
    trajectory.push({ ...entry, at: Date.now() })
    if (trajectory.length > TRAJECTORY_CAP) trajectory.splice(0, trajectory.length - TRAJECTORY_CAP)
  }

  /** the recorded trajectory, oldest first (empty when nothing recorded yet) */
  export async function trajectory(): Promise<TrajectoryEntry[]> {
    return [...((await state()).trajectory ?? [])]
  }

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
    if (s.session) return s.session
    // Config load is the only yield point before assignment; a concurrent
    // first use may have installed a session (or a test may have injected a
    // provider) while this call awaited. Providers connect lazily, so
    // discarding the never-used duplicate leaks nothing.
    const computer = s.injected ? undefined : (await Config.get()).computer
    if (s.session) return s.session
    const provider = s.injected ?? createProvider(computer)
    log.info("starting computer session", { provider: provider.name, injected: s.injected !== undefined })
    s.session = new ComputerSession(provider)
    return s.session
  }

  /** backend spawn/transport failures get an actionable diagnostic naming the command tried and the env override */
  async function unavailable(err: unknown): Promise<Error> {
    const cfg = await Config.get()
    const resolved = resolveBackend(cfg.computer)
    const command = resolved ? `${resolved.command} ${resolved.args.join(" ")}` : "unknown"
    const env = resolved?.env ?? "AX_COMPUTER_CUA_COMMAND / AX_COMPUTER_OCU_COMMAND"
    const detail = err instanceof Error ? err.message : String(err)
    return new Error(
      `Computer-use backend "${resolved?.provider ?? "unknown"}" is unavailable (tried "${command}"; override with ${env} or computer.command config). ${detail}`,
      { cause: err },
    )
  }

  /** failures that mean the configured backend itself is not usable */
  function isUnavailable(err: unknown): boolean {
    if (err instanceof McpClientError) return true
    // provider_error is deliberately excluded: providers use it for routine,
    // user-fixable scoping failures (app/window not found, non-numeric window
    // id) — wrapping those as "backend unavailable" would send the model
    // chasing the command path instead of fixing the scope.
    if (err instanceof ComputerUseError) return err.code === "provider_unavailable"
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

  /** App/window inventory for scope discovery; listWindows is optional on providers. */
  export async function listTargets(): Promise<{ apps: AppInfo[]; windows: WindowInfo[] }> {
    try {
      const provider = (await session()).activeProvider
      const apps = await provider.listApps()
      const windows = (await provider.listWindows?.()) ?? []
      return { apps, windows }
    } catch (err) {
      if (isUnavailable(err)) throw await unavailable(err)
      throw err
    }
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
