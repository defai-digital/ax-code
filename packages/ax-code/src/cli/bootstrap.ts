import { InstanceBootstrap, InstanceBootstrapReadonly, InstanceBootstrapTransient } from "../project/bootstrap"
import { Instance } from "../project/instance"

async function runWithInit<T>(directory: string, init: () => Promise<any>, cb: () => Promise<T>) {
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

/** One-shot CLI command. It cannot take ownership of unrelated durable work. */
export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return runWithInit(directory, InstanceBootstrapTransient, cb)
}

/** ACP is a persistent backend and must retain scheduled-work ownership. */
export async function bootstrapOwned<T>(directory: string, cb: () => Promise<T>) {
  return runWithInit(directory, InstanceBootstrap, cb)
}

/**
 * Bootstrap for read-only CLI commands. Uses the minimal instance bootstrap —
 * no interactive-session warmups — so one-shot commands (session list,
 * skill list, context) exit as soon as the handler completes.
 */
export async function bootstrapReadonly<T>(directory: string, cb: () => Promise<T>) {
  return runWithInit(directory, InstanceBootstrapReadonly, cb)
}
