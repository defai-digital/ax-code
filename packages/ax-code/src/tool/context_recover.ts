import { Identifier } from "@/id/id"
import { Tool } from "./tool"
import { SessionEvidence } from "@/session/evidence"
import DESCRIPTION from "./context_recover.txt"

export const ContextRecoverTool = Tool.define("context_recover", {
  description: DESCRIPTION,
  parameters: SessionEvidence.Query.extend({
    // Branded IDs use a Zod custom output type. The provider-facing schema
    // describes their string input; recovery applies the canonical brand.
    messageID: Identifier.schema("message").optional(),
    partID: Identifier.schema("part").optional(),
  }),
  concurrencySafe: () => true,
  async execute(input, ctx) {
    ctx.abort.throwIfAborted()
    await ctx.ask({ permission: "context_recover", patterns: [ctx.sessionID], always: ["*"], metadata: {} })
    const result = await SessionEvidence.recover(ctx.sessionID, input)
    ctx.abort.throwIfAborted()
    return {
      title: `Recovered ${result.entries.length} evidence excerpts`,
      metadata: { truncated: result.more },
      output: JSON.stringify(result),
    }
  },
})
