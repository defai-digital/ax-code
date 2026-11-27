import type { Agent, AgentOptions } from "./types.js"
import { loadRuntime } from "./runtime-loader.js"

/**
 * Create an in-process AX Code agent from an AX Code source checkout.
 *
 * Resolution first tries `ax-code/sdk/programmatic` next to the SDK, then from
 * the current working directory, then from the entry script's directory. Run it
 * under tsx with
 * `pnpm --dir packages/ax-code exec tsx --import ./script/register-node.ts <your script>`,
 * which sets up the Node compatibility shim, `#db` resolution, and `.txt` loading.
 * The private `ax-code` runtime package is not published to any registry.
 *
 * Applications should use `@defai-digital/ax-code-sdk/headless` or
 * `@defai-digital/ax-code-sdk/grpc` with a signed `ax-code` executable.
 */
export async function createAgent(options: AgentOptions): Promise<Agent> {
  const mod = await loadRuntime()
  return mod.createAgent(options)
}
