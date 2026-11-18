import { Instance } from "./instance"

async function runWithInit<T>(directory: string, init: () => Promise<unknown>, cb: () => Promise<T>): Promise<T> {
  return Instance.provide({
    directory,
    init,
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
      }
    },
  })
}

// Load project services on use so CLI help and embedded API imports do not
// evaluate providers, sessions, plugins or LSP/DRE glue. Initializers still
// register the hosts before callers touch code intelligence.
async function loadProjectBootstrap(): Promise<typeof import("./bootstrap")> {
  return import("./bootstrap")
}

/** Transient caller with session services, without ownership of unrelated durable work. */
export async function withTransientInstance<T>(directory: string, cb: () => Promise<T>): Promise<T> {
  const { InstanceBootstrapTransient } = await loadProjectBootstrap()
  return runWithInit(directory, InstanceBootstrapTransient, cb)
}

/** Persistent backend that retains scheduled-work ownership. */
export async function withOwnedInstance<T>(directory: string, cb: () => Promise<T>): Promise<T> {
  const { InstanceBootstrap } = await loadProjectBootstrap()
  return runWithInit(directory, InstanceBootstrap, cb)
}

/**
 * Bootstrap for read-only CLI commands. Uses the minimal instance bootstrap —
 * no interactive-session warmups — so one-shot commands (session list,
 * skill list, context) exit as soon as the handler completes.
 */
export async function withReadonlyInstance<T>(directory: string, cb: () => Promise<T>): Promise<T> {
  const { InstanceBootstrapReadonly } = await loadProjectBootstrap()
  return runWithInit(directory, InstanceBootstrapReadonly, cb)
}
