import z from "zod"
import { Isolation } from "@/isolation"
import type { Isolation as IsolationConfig } from "@/config/schema"
import { JsonBoolean } from "@/util/schema"

export const PromptIsolationPolicy = z
  .object({
    mode: z.enum(["read-only", "workspace-write", "full-access"]).optional(),
    network: JsonBoolean.optional(),
  })
  .strict()
export type PromptIsolationPolicy = z.infer<typeof PromptIsolationPolicy>

const modeRank: Record<Isolation.Mode, number> = {
  "read-only": 0,
  "workspace-write": 1,
  "full-access": 2,
}

function stricterMode(a: Isolation.Mode, b: Isolation.Mode): Isolation.Mode {
  return modeRank[a] <= modeRank[b] ? a : b
}

export function applyPromptIsolationPolicy(
  base: Isolation.State,
  policy: PromptIsolationPolicy | undefined,
): Isolation.State {
  if (!policy) return base
  const mode = stricterMode(base.mode, policy.mode ?? base.mode)
  const requestedNetwork = policy.network ?? base.network
  return {
    ...base,
    mode,
    network: base.network && requestedNetwork,
  }
}

export function resolvePromptIsolationPolicy(input: {
  config: IsolationConfig | undefined
  policy: PromptIsolationPolicy | undefined
  directory: string
  worktree: string
}): Isolation.State {
  return applyPromptIsolationPolicy(Isolation.resolve(input.config, input.directory, input.worktree), input.policy)
}
