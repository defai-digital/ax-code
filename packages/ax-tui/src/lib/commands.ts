import { EventEmitter } from "node:events"
import type { CliRenderer } from "../core/renderer.js"
import { Renderable, RenderableEvents } from "../core/renderable.js"
import { stripAnsiSequences } from "./paste.js"

export interface CommandContext {
  readonly renderer: CliRenderer
  readonly focused: Renderable | null
}

export interface CommandDefinition {
  id: string
  title: string
  description?: string
  keywords?: readonly string[]
  enabled?: (context: CommandContext) => boolean
  run: (context: CommandContext) => void | Promise<void>
}

export interface CommandMetadata {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly keywords: readonly string[]
  readonly enabled: boolean
}

export type CommandResult =
  | { status: "executed" | "not-found" | "disabled" | "stale-context" | "disposed" }
  | { status: "error"; error: unknown }

interface Registration {
  definition: CommandDefinition
  target?: Renderable
  remove: () => void
}

const registries = new WeakMap<CliRenderer, CommandRegistry>()

function plainLine(value: string): string {
  return stripAnsiSequences(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim()
}

function attached(renderer: CliRenderer, node: Renderable): boolean {
  for (let ancestor: Renderable | null = node; ancestor;
    ancestor = ancestor.parent instanceof Renderable ? ancestor.parent : null) {
    if (ancestor.isDestroyed || !ancestor.visible) return false
    if (ancestor === renderer.root) return true
  }
  return false
}

export function captureCommandContext(renderer: CliRenderer): CommandContext {
  return Object.freeze({ renderer, focused: renderer.currentFocusedRenderable })
}

/** A separate execution registry; shortcut-help snapshots never provide command handlers. */
export class CommandRegistry extends EventEmitter<{ change: [] }> {
  private commands = new Map<string, Registration>()
  private disposed = false

  private constructor(readonly renderer: CliRenderer) {
    super()
    renderer.once("destroy", this.dispose)
  }

  static forRenderer(renderer: CliRenderer): CommandRegistry {
    if (renderer.isDestroyed) throw new Error("Cannot register commands on a destroyed renderer")
    let registry = registries.get(renderer)
    if (!registry) {
      registry = new CommandRegistry(renderer)
      registries.set(renderer, registry)
    }
    return registry
  }

  register(command: CommandDefinition, target?: Renderable): () => void {
    if (this.disposed || this.renderer.isDestroyed) throw new Error("Command registry is disposed")
    if (!command.id || command.id !== plainLine(command.id) || !plainLine(command.title) ||
      typeof command.run !== "function" || this.commands.has(command.id)) {
      throw new Error("Commands require a unique nonempty ID, title and handler")
    }
    if (target && (target.isDestroyed || target.ctx !== this.renderer)) {
      throw new Error("Command target must belong to this live renderer")
    }
    const definition = { ...command, title: plainLine(command.title),
      description: plainLine(command.description ?? ""), keywords: command.keywords?.map(plainLine) }
    const registration: Registration = { definition, target, remove: () => {} }
    registration.remove = () => {
      if (this.commands.get(definition.id) !== registration) return
      this.commands.delete(definition.id)
      target?.off(RenderableEvents.DESTROYED, registration.remove)
      this.emit("change")
    }
    this.commands.set(command.id, registration)
    target?.once(RenderableEvents.DESTROYED, registration.remove)
    this.emit("change")
    return registration.remove
  }

  private validContext(context: CommandContext): boolean {
    return context.renderer === this.renderer && !this.renderer.isDestroyed &&
      (!context.focused || attached(this.renderer, context.focused))
  }

  private enabled(registration: Registration, context: CommandContext): boolean {
    if (registration.target && !attached(this.renderer, registration.target)) return false
    const enabled = registration.definition.enabled?.(context) !== false
    return enabled && !this.disposed && this.validContext(context) &&
      this.commands.get(registration.definition.id) === registration &&
      (!registration.target || attached(this.renderer, registration.target))
  }

  search(query = "", context = captureCommandContext(this.renderer)): readonly CommandMetadata[] {
    if (this.disposed || !this.validContext(context)) return []
    const needle = Array.from(plainLine(query).normalize("NFKC").toLowerCase()).slice(0, 256)
    const entries: { metadata: CommandMetadata; score: number; index: number }[] = []
    for (const registration of [...this.commands.values()]) {
      const { definition } = registration
      let enabled = false
      try { enabled = this.enabled(registration, context) } catch { /* A broken predicate disables only its command. */ }
      if (this.disposed || this.commands.get(definition.id) !== registration) continue
      const haystack = Array.from([definition.title, definition.id, definition.description,
        ...(definition.keywords ?? [])].join(" ").normalize("NFKC").toLowerCase())
      let cursor = 0
      let score = 0
      let matches = true
      for (const character of needle) {
        const found = haystack.indexOf(character, cursor)
        if (found < 0) {
          matches = false
          break
        }
        score += found - cursor
        cursor = found + 1
      }
      if (!matches) continue
      const metadata = Object.freeze({ id: definition.id, title: definition.title,
        description: definition.description ?? "", keywords: Object.freeze([...(definition.keywords ?? [])]), enabled })
      entries.push({ metadata, score, index: entries.length })
    }
    return Object.freeze(entries.sort((a, b) => a.score - b.score || a.index - b.index).map(({ metadata }) => metadata))
  }

  async execute(id: string, context = captureCommandContext(this.renderer)): Promise<CommandResult> {
    if (this.disposed) return { status: "disposed" }
    if (!this.validContext(context)) return { status: "stale-context" }
    const registration = this.commands.get(id)
    if (!registration) return { status: "not-found" }
    try {
      if (!this.enabled(registration, context)) return { status: "disabled" }
      await registration.definition.run(context)
      return { status: "executed" }
    } catch (error) {
      return { status: "error", error }
    }
  }

  dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    for (const registration of [...this.commands.values()]) registration.remove()
    this.renderer.off("destroy", this.dispose)
    registries.delete(this.renderer)
    this.removeAllListeners()
  }
}

export function getCommandRegistry(renderer: CliRenderer): CommandRegistry {
  return CommandRegistry.forRenderer(renderer)
}
