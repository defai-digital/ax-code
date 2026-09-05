import { InstanceBootstrap, InstanceBootstrapReadonly } from "../project/bootstrap"
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

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
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
