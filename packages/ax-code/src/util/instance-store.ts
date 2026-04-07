import { Instance } from "@/project/instance"
import { registerDisposer } from "@/effect/instance-registry"

/**
 * Plain-TS replacement for Effect's InstanceState.
 *
 * Provides per-directory scoped state with lazy initialization and cleanup.
 * Uses a Map keyed by directory path instead of Effect's ScopedCache.
 *
 * @example
 * ```ts
 * // Define store at module level
 * const toolRegistry = InstanceStore.create(async (ctx) => {
 *   return new Map<string, Tool>()
 * })
 *
 * // Use in any async context where Instance.directory is set
 * const registry = await toolRegistry.get()
 * registry.set("edit", editTool)
 *
 * // Select a value
 * const tools = await toolRegistry.use((reg) => [...reg.values()])
 * ```
 */

interface StoreShape {
  directory: string
  worktree: string
  project: { id: string }
}

export namespace InstanceStore {
  interface Store<A> {
    /** Get the state for the current directory. Lazily initializes on first access. */
    get(): Promise<A>
    /** Get and transform the state. */
    use<B>(select: (value: A) => B): Promise<B>
    /** Check if state exists for the current directory. */
    has(): boolean
    /** Invalidate (remove) state for the current directory. */
    invalidate(): void
  }

  /**
   * Create a per-directory store with lazy initialization.
   *
   * @param init - Called once per directory to create the initial state.
   *               Receives the instance context (directory, worktree, project).
   */
  export function create<A>(init: (ctx: StoreShape) => A | Promise<A>): Store<A> {
    const entries = new Map<string, A>()
    const pending = new Map<string, Promise<A>>()

    // Register cleanup so directory disposal removes stale entries
    registerDisposer(async (directory) => {
      entries.delete(directory)
      pending.delete(directory)
    })

    return {
      async get(): Promise<A> {
        const dir = Instance.directory
        const cached = entries.get(dir)
        if (cached !== undefined) return cached

        // Check if initialization is already in-flight
        const inflight = pending.get(dir)
        if (inflight) return inflight

        const promise = Promise.resolve(init({
          directory: dir,
          worktree: Instance.worktree,
          project: Instance.project,
        })).then((value) => {
          entries.set(dir, value)
          pending.delete(dir)
          return value
        }).catch((err) => {
          pending.delete(dir)
          throw err
        })

        pending.set(dir, promise)
        return promise
      },

      async use<B>(select: (value: A) => B): Promise<B> {
        const value = await this.get()
        return select(value)
      },

      has(): boolean {
        return entries.has(Instance.directory)
      },

      invalidate(): void {
        const dir = Instance.directory
        entries.delete(dir)
        pending.delete(dir)
      },
    }
  }
}
