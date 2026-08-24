import fs from "node:fs"
import path from "node:path"
import { ComputerSession, ComputerUseError, ExternalComputerProvider, McpClientError } from "@ax-code/computer/index"
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
import { Recorder } from "@/replay/recorder"
import type { SessionID, MessageID } from "@/session/schema"

/**
 * Instance-scoped computer-use service and the single source of truth for
 * mapping `computer.provider` config (+ command/args overrides) to a provider
 * instance. Provider selection is manual only — no auto-routing or failover
 * between backends (PRD-2026-08-22 non-goal for early phases).
 *
 * Every provider value ("axnative", "cua", "external") routes through an
 * MCP server speaking the canonical AX Computer protocol, driven by
 * ExternalComputerProvider (ADR-061: the engine lives in the closed
 * ax-computer repo; the open repo carries the client only). The aliases
 * select the server's backend via `mcp --backend <alias>`; "external" treats
 * the configured command as a complete canonical-protocol server.
 *
 * The configured default provider is constructed lazily on first use and
 * wrapped in a ComputerSession. Optional `computer.overrides` adds one extra
 * session per distinct override value, so a single instance can route
 * observations to backend X for app A and backend Y for app B.
 *
 * Each ComputerSession owns the one-active-provider rule and
 * epoch-namespaced element targets; element ids issued by session S are only
 * valid on S, so cross-provider element acts are rejected with a clear
 * re-observe message (never sent as dangling indices to the wrong backend).
 *
 * The session(s) and per-app overrides are disposed with the instance.
 * Successful observe/act/watch executions emit replay events through the
 * standard Recorder seam so AX-Trust reviewers see the trajectory.
 */
export namespace Computer {
  const log = Log.create({ service: "computer" })

  /** recognized computer.provider values, for resolution and diagnostics */
  const BACKENDS = ["cua", "axnative", "external"] as const

  export type BackendName = (typeof BACKENDS)[number]
  export type ProviderName = BackendName | string

  export interface ResolvedBackend {
    provider: ProviderName
    command: string
    args: string[]
  }

  /** sync PATH lookup for the ax-computer server binary (access-based, no spawn) */
  function findExecutableOnPath(name: string): string | undefined {
    const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      if (!dir) continue
      for (const extension of extensions) {
        const candidate = path.join(dir, name + extension)
        try {
          fs.accessSync(candidate, fs.constants.X_OK)
          return candidate
        } catch {
          // not in this entry — keep scanning
        }
      }
    }
    return undefined
  }

  /**
   * Resolve the server command for a computer config: computer.command >
   * AX_COMPUTER_COMMAND > ax-computer on PATH. Aliases get canonical args
   * `["mcp", "--backend", <alias>]`; "external" takes the user's args (or
   * none). Throws a clear install hint when no command is resolvable. Shared
   * by the session provider construction and the doctor preflight so both
   * report the exact command that would be spawned.
   */
  export function resolveBackend(computer: Config.Info["computer"]): ResolvedBackend | undefined {
    if (!computer?.provider) return undefined
    const command = computer.command ?? process.env.AX_COMPUTER_COMMAND ?? findExecutableOnPath("ax-computer")
    if (!command) {
      throw new Error(
        `computer.provider "${computer.provider}" requires the ax-computer server: install it so "ax-computer" is on PATH, or set computer.command / AX_COMPUTER_COMMAND to the server command.`,
      )
    }
    return {
      provider: computer.provider,
      command,
      args:
        computer.provider === "external"
          ? (computer.args ?? [])
          : (computer.args ?? ["mcp", "--backend", computer.provider]),
    }
  }

  /**
   * Pick which backend should serve a scope. App-scoped observations honor
   * `computer.overrides`; windowId and bare desktop go to the default. An
   * override value that names an unknown backend is rejected at config
   * validation, so this never has to defend against typos.
   */
  export function resolveProvider(computer: Config.Info["computer"], scope: ObserveScope): ProviderName | undefined {
    if (!computer?.provider) return undefined
    if ("app" in scope) {
      const override = computer.overrides?.[scope.app]
      if (override) return override
    }
    return computer.provider
  }

  /**
   * Audit context passed from tool calls so the namespace can emit replay
   * events with the correct session / message ids. Optional; emission is
   * skipped when no context is supplied (tests, doctor preflight, etc.).
   */
  export interface AuditContext {
    sessionID: SessionID
    messageID?: MessageID
    callID?: string
    tool: "computer_snapshot" | "computer_action" | "computer_watch" | "computer_plan"
  }

  /**
   * Test injection shape: a map keyed by provider name. The presence of
   * `default` is required for unscoped scopes; per-app overrides look up
   * the entry whose key matches the provider name (e.g. `cua` or `axnative`).
   * When `default` is absent, unscoped acts throw — tests that only
   * exercise overrides must stub the default or always pass a scope.
   */
  /**
   * Test injection shape, mirrors the runtime config surface. Providers
   * themselves are keyed by provider name (e.g. "cua", "axnative", or any
   * arbitrary string); `overrides` is app-keyed routing just like
   * `computer.overrides` in ax-code.json. `default` is the fallback used
   * when no override matches.
   */
  interface InjectedMap {
    /** providers keyed by provider name */
    providers: Record<string, ComputerUseProvider>
    /** explicit default-slot reference (must be a key inside `providers`) */
    default?: string
    /** app → provider-name; same semantics as `computer.overrides` */
    overrides?: Record<string, ProviderName>
  }

  interface State {
    /** lazy sessions, keyed by provider name (default + override values) */
    sessions?: Map<ProviderName, ComputerSession>
    /** test-only provider overrides, keyed by provider name (incl. "default") */
    injected?: InjectedMap
    /** provider name that issued the most recent successful observation */
    lastProvider?: ProviderName
    /** most recent successful observation (grounder input); reset by useProvider */
    lastObservation?: ComputerObservation
    /** the scope the last observation came from (so reobserve and scopeLabel work) */
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
      if (s.sessions) for (const session of s.sessions.values()) await session.dispose()
      s.sessions = undefined
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

  /**
   * Test-only: substitute one or more providers. Accepts either a single
   * provider (bound to the default slot), a `Map<providerName, provider>`
   * keyed by provider name, or a `UseProviderOptions` object with optional
   * `overrides`. Passing `undefined` clears every session and the injection.
   */
  export interface UseProviderOptions {
    /** providers keyed by provider name; one of them is the default */
    providers: Map<ProviderName, ComputerUseProvider>
    /** name of the default provider inside `providers`; defaults to the first key */
    default?: ProviderName
    /** app → provider-name; same semantics as `computer.overrides` */
    overrides?: Record<string, ProviderName>
  }

  export async function useProvider(provider: ComputerUseProvider | undefined): Promise<void>
  export async function useProvider(providers: Map<ProviderName, ComputerUseProvider>): Promise<void>
  export async function useProvider(options: UseProviderOptions): Promise<void>
  export async function useProvider(
    arg: ComputerUseProvider | Map<ProviderName, ComputerUseProvider> | UseProviderOptions | undefined,
  ): Promise<void> {
    const s = await state()
    if (s.sessions) for (const session of s.sessions.values()) await session.dispose()
    s.sessions = undefined
    s.lastObservation = undefined
    s.lastProvider = undefined
    if (arg === undefined) {
      s.injected = undefined
      return
    }
    // single provider (default slot). Use the provider's own `name` as the
    // default key, falling back to the literal "default" when the provider
    // didn't set a name (matches how the runtime default slot is keyed).
    if (typeof (arg as ComputerUseProvider).capabilities === "function" && !(arg instanceof Map)) {
      const provider = arg as ComputerUseProvider
      const key = provider.name || "default"
      s.injected = { providers: { [key]: provider }, default: key }
      return
    }
    // Map → first key is the default unless caller passes UseProviderOptions
    if (arg instanceof Map) {
      const providers: Record<string, ComputerUseProvider> = {}
      let first: ProviderName | undefined
      for (const [name, p] of arg) {
        providers[name] = p
        if (first === undefined) first = name
      }
      s.injected = { providers, default: first }
      return
    }
    // full options object
    const opts = arg as UseProviderOptions
    const providers: Record<string, ComputerUseProvider> = {}
    let first: ProviderName | undefined
    for (const [name, p] of opts.providers) {
      providers[name] = p
      if (first === undefined) first = name
    }
    s.injected = {
      providers,
      default: opts.default ?? first,
      ...(opts.overrides ? { overrides: { ...opts.overrides } } : {}),
    }
  }

  /** the most recent successful observation; undefined until the first observe */
  export async function lastObservation(): Promise<ComputerObservation | undefined> {
    return (await state()).lastObservation
  }

  export async function configured(): Promise<boolean> {
    const s = await state()
    if (s.injected) return true
    const cfg = await Config.get()
    return cfg.computer?.provider !== undefined
  }

  function createProvider(computer: Config.Info["computer"], target: ProviderName): ComputerUseProvider {
    if (!computer?.provider) {
      throw new Error(
        'Computer use is not configured. Set computer.provider ("axnative", "cua", or "external") in ax-code.json to enable computer tools.',
      )
    }
    switch (target) {
      case "cua":
      case "axnative":
      case "external": {
        // every provider value routes through a canonical-protocol MCP server
        // (ADR-061); resolveBackend throws a clear install hint when no server
        // command is resolvable
        const resolved = resolveBackend({ ...computer, provider: target as BackendName })
        if (!resolved) throw new Error(`Computer use provider "${target}" could not be resolved.`)
        return new ExternalComputerProvider({ command: resolved.command, args: resolved.args })
      }
      default:
        throw new Error(
          `Computer use override "${target}" is not a recognized backend; use "axnative", "cua", or "external".`,
        )
    }
  }

  /**
   * Look up or create the ComputerSession for the named provider. The default
   * session is keyed under the resolved provider name (which is also the
   * override value) so per-app routing can share a session across overlapping
   * override names without collisions.
   */
  async function sessionFor(name: ProviderName): Promise<ComputerSession> {
    const s = await state()
    const sessions = (s.sessions ??= new Map())
    const cached = sessions.get(name)
    if (cached) return cached
    // Config load is the only yield point before assignment; a concurrent
    // first use may have installed a session for the same name while this
    // call awaited. Providers connect lazily, so discarding the
    // never-used duplicate leaks nothing.
    const computer = s.injected ? undefined : (await Config.get()).computer
    if (sessions.has(name)) return sessions.get(name)!
    const provider = pickProvider(s, computer, name)
    log.info("starting computer session", { provider: provider.name, injected: s.injected !== undefined })
    const session = new ComputerSession(provider)
    sessions.set(name, session)
    return session
  }

  function pickProvider(
    s: State,
    computer: Config.Info["computer"] | undefined,
    name: ProviderName,
  ): ComputerUseProvider {
    if (s.injected) {
      // Test injection takes precedence over real provider construction.
      // The named slot wins; otherwise the default slot's provider is used.
      const direct = s.injected.providers[name]
      if (direct) return direct
      if (s.injected.default) {
        const fallback = s.injected.providers[s.injected.default]
        if (fallback) return fallback
      }
    }
    return createProvider(computer, name)
  }

  /** backend spawn/transport failures get an actionable diagnostic naming the command tried and the env override */
  async function unavailable(err: unknown, name: ProviderName): Promise<Error> {
    const cfg = await Config.get()
    let resolved: ResolvedBackend | undefined
    try {
      resolved = resolveBackend(cfg.computer)
    } catch {
      // no server command resolvable at all — the install hint in the detail matters more than the command
      resolved = undefined
    }
    const command = resolved ? `${resolved.command} ${resolved.args.join(" ")}`.trim() : "unknown"
    const detail = err instanceof Error ? err.message : String(err)
    return new Error(
      `Computer-use backend "${name}" is unavailable (tried "${command}"; override with AX_COMPUTER_COMMAND or computer.command config). ${detail}`,
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

  function descriptorForScope(scope: ObserveScope): string {
    if ("app" in scope) return `app:${scope.app}`
    if ("windowId" in scope) return `window:${scope.windowId}`
    return "desktop"
  }

  function elementTargetCount(action: ComputerAction): number {
    let count = 0
    switch (action.type) {
      case "click":
      case "set_value":
        if (action.target.kind === "element") count++
        break
      case "scroll":
        if (action.target?.kind === "element") count++
        break
      case "drag":
        if (action.from.kind === "element") count++
        if (action.to.kind === "element") count++
        break
      case "move":
        if (action.target.kind === "element") count++
        break
      case "wait":
        if (action.condition.type !== "screen_stable" && action.condition.target.kind === "element") count++
        break
    }
    return count
  }

  export interface ObserveOptions {
    /** emit a replay event (audit/risk seam) when sessionID is provided */
    audit?: AuditContext
  }

  export async function observe(scope: ObserveScope, options: ObserveOptions = {}): Promise<ComputerObservation> {
    const s = await state()
    const name = await resolveObserveProvider(s, scope)
    if (!name) {
      throw new Error(
        'Computer use is not configured. Set computer.provider ("axnative", "cua", or "external") in ax-code.json to enable computer tools.',
      )
    }
    const session = await sessionFor(name)
    const start = Date.now()
    let observation: ComputerObservation
    try {
      observation = await session.observe(scope)
    } catch (err) {
      if (isUnavailable(err)) throw await unavailable(err, name)
      throw err
    }
    s.lastScope = scope
    s.lastProvider = name
    s.lastObservation = observation
    if (options.audit) emitObserve(options.audit, name, scope, observation, Date.now() - start, true)
    return observation
  }

  /**
   * Resolve the provider name for an observation scope. Honors
   * `computer.overrides` from config when running for real; with an
   * injected map (tests), mirrors the same precedence: app-scoped
   * observations find the override entry, otherwise the default.
   */
  async function resolveObserveProvider(s: State, scope: ObserveScope): Promise<ProviderName | undefined> {
    if (s.injected) {
      if ("app" in scope) {
        const overrideName = s.injected.overrides?.[scope.app]
        if (overrideName && s.injected.providers[overrideName]) return overrideName
      }
      // app-scoped without an override, or non-app scope: default slot,
      // falling back to the first keyed provider so a test that only
      // injects one named provider still has something to observe.
      if (s.injected.default && s.injected.providers[s.injected.default]) return s.injected.default
      for (const [name, provider] of Object.entries(s.injected.providers)) {
        if (provider) return name
      }
      return undefined
    }
    const computer = (await Config.get()).computer
    return resolveProvider(computer, scope)
  }

  export interface ActOptions {
    audit?: AuditContext
  }

  export async function act(action: ComputerAction, options: ActOptions = {}): Promise<ActionResult> {
    const s = await state()
    const start = Date.now()
    const elements = elementTargetCount(action)
    let target: ProviderName | undefined
    if (elements > 0) {
      // Element acts MUST run on the session that issued the element ids;
      // the PRD rejects cross-provider element acts before the wrong backend
      // sees the dangling index.
      if (!s.lastProvider) {
        throw new Error(
          "computer_action with an element target requires a prior computer_snapshot to issue the element id; call computer_snapshot first.",
        )
      }
      target = s.lastProvider
    } else {
      target = await resolveNonElementTarget(action)
    }
    if (!target) {
      throw new Error(
        "computer_action has no resolvable provider; configure computer.provider or call computer_snapshot first.",
      )
    }
    const session = await sessionFor(target)
    let result: ActionResult
    try {
      result = await session.act(action)
    } catch (err) {
      if (isUnavailable(err)) throw await unavailable(err, target)
      throw err
    }
    if (options.audit) emitAction(options.audit, target, action, result, s.lastScope, Date.now() - start, undefined)
    return result
  }

  /**
   * Resolve the provider for an act that carries no element targets. Element
   * targets are pinned to the issuing session above; everything else can be
   * routed by the action's inherent scope. launch_app routes through the
   * override map; type/keypress/activate_window inherit the last observation's
   * provider (typically the desktop default).
   */
  async function resolveNonElementTarget(action: ComputerAction): Promise<ProviderName | undefined> {
    const s = await state()
    if (action.type === "launch_app") {
      if (s.injected) {
        const overrideName = s.injected.overrides?.[action.app]
        if (overrideName && s.injected.providers[overrideName]) return overrideName
        return s.injected.default
      }
      const computer = (await Config.get()).computer
      return resolveProvider(computer, { app: action.app })
    }
    return s.lastProvider ?? s.injected?.default ?? (await Config.get()).computer?.provider
  }

  /** Re-observe the most recent scope (verify-after-act); desktop when nothing was observed yet. */
  export async function reobserve(options: ObserveOptions = {}): Promise<ComputerObservation> {
    const s = await state()
    return observe(s.lastScope ?? { desktop: true }, options)
  }

  /** App/window inventory for scope discovery; listWindows is optional on providers. */
  export async function listTargets(): Promise<{ apps: AppInfo[]; windows: WindowInfo[] }> {
    const s = await state()
    // Reuse the same provider resolution as observe: tests inject a default
    // map; production uses the configured default. Either way, this must
    // hit a session that observe() would also route to — otherwise the
    // injected map and the real config silently spawn a second session.
    const name = await resolveObserveProvider(s, { desktop: true })
    if (!name) {
      throw new Error(
        'Computer use is not configured. Set computer.provider ("axnative", "cua", or "external") in ax-code.json to enable computer tools.',
      )
    }
    const session = await sessionFor(name)
    try {
      const provider = session.activeProvider
      const apps = await provider.listApps()
      const windows = (await provider.listWindows?.()) ?? []
      return { apps, windows }
    } catch (err) {
      if (isUnavailable(err)) throw await unavailable(err, name)
      throw err
    }
  }

  /** label for permission patterns: the app/window the action lands on */
  export async function scopeLabel(action: ComputerAction): Promise<string | undefined> {
    if (action.type === "launch_app") return `app:${action.app}`
    if (action.type === "activate_window") return `window:${action.windowId}`
    const scope = (await state()).lastScope
    if (!scope) return undefined
    return descriptorForScope(scope)
  }

  /**
   * Descriptor of the most recent observation scope (e.g. "desktop",
   * "app:TextEdit"), without needing a translated action. Lets callers build
   * permission patterns before an action is translated — so a permission ask
   * can precede expensive or privacy-sensitive translation work (grounding).
   */
  export async function lastScopeDescriptor(): Promise<string | undefined> {
    const scope = (await state()).lastScope
    return scope ? descriptorForScope(scope) : undefined
  }

  /**
   * Cross-provider element-act guard. If the model calls an act that targets
   * element ids issued by a different provider than the currently active one,
   * we throw before the wrong backend ever sees the ids. Returns the provider
   * name the act would route to.
   */
  export function checkElementTargetRouting(
    action: ComputerAction,
    lastProvider: ProviderName | undefined,
  ): ProviderName | undefined {
    if (elementTargetCount(action) === 0) return undefined
    if (!lastProvider) return undefined
    return lastProvider
  }

  export interface StatusReport {
    configured: boolean
    provider?: ProviderName
    overrides: Record<string, ProviderName>
    activeProviders: ProviderName[]
  }

  export async function status(): Promise<StatusReport> {
    const s = await state()
    const cfg = await Config.get()
    return {
      configured: s.injected !== undefined || cfg.computer?.provider !== undefined,
      provider: cfg.computer?.provider,
      overrides: { ...(cfg.computer?.overrides ?? {}) },
      activeProviders: s.sessions ? [...s.sessions.keys()] : [],
    }
  }

  function emitObserve(
    audit: AuditContext,
    name: ProviderName,
    scope: ObserveScope,
    observation: ComputerObservation,
    durationMs: number,
    ok: boolean,
    error?: string,
  ) {
    if (!Recorder.active(audit.sessionID)) return
    Recorder.emit({
      type: "computer.observe",
      sessionID: audit.sessionID,
      messageID: audit.messageID,
      tool:
        audit.tool === "computer_plan" || audit.tool === "computer_snapshot" ? "computer_snapshot" : "computer_watch",
      provider: name,
      scope: descriptorForScope(scope),
      elementCount: observation.elements.length,
      durationMs,
      ok,
      error,
    })
  }

  function emitAction(
    audit: AuditContext,
    name: ProviderName,
    action: ComputerAction,
    result: ActionResult,
    scope: ObserveScope | undefined,
    durationMs: number,
    reobserveError: string | undefined,
  ) {
    if (!Recorder.active(audit.sessionID)) return
    Recorder.emit({
      type: "computer.action",
      sessionID: audit.sessionID,
      messageID: audit.messageID,
      actionType: action.type,
      provider: name,
      scope: scope ? descriptorForScope(scope) : "desktop",
      summary: result.detail ?? `${action.type} ${result.ok ? "ok" : "failed"}`,
      ok: result.ok,
      refusal: result.refusal,
      detail: result.detail,
      reobserveError,
      durationMs,
    })
  }
}
