import z from "zod"
import { Tool } from "./tool"
import { recordEntry } from "../memory/recorder"
import { Instance } from "../project/instance"

const DESCRIPTION = `Save a memory entry that persists across sessions.

Call this tool when you detect something worth remembering — without waiting for the user to ask. Act on these signals:

SAVE when:
- The user corrects your approach: "don't do X", "use Y instead", "stop doing Z". Save as kind=feedback.
- The user confirms a non-obvious choice without pushback. Save as kind=feedback.
- You learn something about who the user is: role, expertise, workflow style. Save as kind=userPrefs.
- A project-level decision or constraint is revealed that isn't obvious from the code. Save as kind=decisions.
- You learn where to find something outside the repo: issue tracker, dashboard, Slack channel, doc URL. Save as kind=reference.

DO NOT SAVE:
- Code patterns or conventions visible in the codebase (grep for them next time).
- Information already in CLAUDE.md or project config files.
- Ephemeral task state, in-progress work, or current conversation context.
- Git history or who changed what (use git log/blame).
- Anything the user explicitly told you not to remember.

SCOPE:
- scope=project (default): saves to .ax-code/memory.json — project-specific, ignored in other repos.
- scope=global: saves to ~/.ax-code/memory.json — applies to every project. Use for user identity, universal preferences, and cross-project feedback rules.

KINDS:
- feedback: Working rules — what to do or avoid. Lead body with the rule itself. Add why (the reason given) and howToApply (when this kicks in). Example: "Always run pnpm typecheck before marking a task done."
- userPrefs: Facts about the user that shape collaboration — role, expertise level, communication style. Example: "Senior Go engineer, new to this repo's React frontend."
- decisions: Project-specific choices not obvious from code — architecture decisions, compliance constraints, deliberate trade-offs. Example: "Auth middleware rewrite is driven by legal requirements, not tech debt."
- reference: Pointers to external resources — issue trackers, dashboards, Slack channels, doc URLs. Example: "Pipeline bugs tracked in Linear project INGEST."

NAME: use a short, stable slug (e.g. "no-mocks-in-tests", "reply-in-chinese"). Saving with an existing name overwrites it.
BODY: the rule or fact itself, self-contained. A future session reads this without the current conversation.`

export const MemorySaveTool = Tool.define("memory_save", {
  description: DESCRIPTION,
  parameters: z.object({
    kind: z
      .enum(["feedback", "userPrefs", "decisions", "reference"])
      .describe(
        "Category of memory: feedback (rules/corrections), userPrefs (user identity/style), decisions (project choices), reference (where things live)",
      ),
    name: z
      .string()
      .min(1)
      .describe("Short stable slug, unique within the kind. Re-using a name overwrites the prior entry."),
    body: z
      .string()
      .min(1)
      .describe(
        "The rule, fact, or pointer itself. Self-contained — future sessions read this without current context.",
      ),
    why: z.string().optional().describe("The reason or incident behind this entry. Helps judge edge cases later."),
    howToApply: z.string().optional().describe("When or where this entry kicks in."),
    agents: z
      .array(z.string())
      .optional()
      .describe("Agent names that should see this entry. Omit to apply to all agents."),
    scope: z
      .enum(["project", "global"])
      .optional()
      .describe(
        'Where to store the entry. "project" (default) = this repo only. "global" = all projects (use for universal user preferences and feedback).',
      ),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "memorywrite",
      patterns: ["*"],
      always: ["*"],
      metadata: { kind: params.kind, name: params.name, scope: params.scope ?? "project" },
    })
    await recordEntry(Instance.directory, params.kind, {
      name: params.name,
      body: params.body,
      why: params.why,
      howToApply: params.howToApply,
      agents: params.agents,
      scope: params.scope,
    })
    const scopeLabel = params.scope === "global" ? "global" : "project"
    return {
      title: `Memory saved: ${params.name}`,
      output: `Saved ${params.kind} memory (${scopeLabel} scope): "${params.name}"`,
      metadata: {
        kind: params.kind,
        name: params.name,
        scope: scopeLabel,
        truncated: false,
      },
    }
  },
})
