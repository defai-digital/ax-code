import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { SessionID, MessageID } from "@/session/schema"
import z from "zod"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { Truncate } from "../tool/truncate"
import { Policy } from "../quality/policy"
import { uniqueStrings } from "../util/string-list"
import { FileCommand } from "./file-command"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_ADR from "./template/adr.txt"
import PROMPT_IMPACT from "./template/impact.txt"
import PROMPT_PRD from "./template/prd.txt"
import PROMPT_COUNCIL from "./template/council.txt"
import PROMPT_ARENA from "./template/arena.txt"
import PROMPT_MODE from "./template/mode.txt"

export namespace Command {
  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: SessionID.zod,
        arguments: z.string(),
        messageID: MessageID.zod,
        source: z.enum(["command", "file", "mcp", "skill"]).optional(),
        sourceTool: z.string().optional(),
        workflow: z.string().optional(),
        workflowRunID: z.string().optional(),
        warnings: z.array(FileCommand.Warning).optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      source: z.enum(["command", "file", "mcp", "skill"]).optional(),
      sourceTool: z.enum(["ax-code", "agents", "opencode", "claude", "builtin", "config"]).optional(),
      scope: z.enum(["builtin", "project", "user", "config", "compat", "mcp"]).optional(),
      location: z.string().optional(),
      warnings: z.array(FileCommand.Warning).optional(),
      workflow: z.string().optional(),
      allowShell: z.boolean().optional(),
      argumentHint: z.string().optional(),
      requiresArguments: z.boolean().optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
      mcpPrompt: z
        .object({
          client: z.string(),
          name: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string) {
    const result: string[] = []
    const numbered = template.match(/\$\d+(?![A-Za-z0-9_])/g)
    if (numbered) {
      for (const match of uniqueStrings(numbered).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
        result.push(match)
      }
    }
    if (/\$ARGUMENTS(?![A-Za-z0-9_])/.test(template)) result.push("$ARGUMENTS")
    return result
  }

  function skillRequiresArguments(skill: Skill.Info) {
    if (!skill.argumentHint) return false
    return !skill.argumentHint.trim().startsWith("[")
  }

  export async function mcpPromptTemplateText(input: {
    client: string
    name: string
    messages: Array<{ content?: { type?: string; text?: string } }>
  }) {
    const text = input.messages
      .map((message) => (message.content?.type === "text" ? (message.content.text ?? "") : ""))
      .join("\n")
    return (await Truncate.output(`[Untrusted MCP prompt content from ${input.client}/${input.name}]\n\n${text}`))
      .content
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
    ADR: "adr",
    IMPACT: "impact",
    PRD: "prd",
    GOAL: "goal",
    COUNCIL: "council",
    ARENA: "arena",
    MODE: "mode",
  } as const

  const state = Instance.state(async () => {
    const ctx = Instance.current
    const cfg = await Config.get()
    const commands: Record<string, Info> = {}

    commands[Default.INIT] = {
      name: Default.INIT,
      description: "create/update AGENTS.md",
      source: "command",
      sourceTool: "builtin",
      scope: "builtin",
      get template() {
        return PROMPT_INITIALIZE.replace("${path}", () => ctx.worktree)
      },
      hints: hints(PROMPT_INITIALIZE),
    }
    commands[Default.REVIEW] = {
      name: Default.REVIEW,
      description: "review changes [commit|branch|pr], defaults to uncommitted",
      source: "command",
      sourceTool: "builtin",
      scope: "builtin",
      get template() {
        return (async () => {
          const policy = await Policy.loadReviewPolicy({ worktree: ctx.worktree })
          const policyText = policy ? policy.trim() : "(no project-specific review policy configured)"
          // Use replacement functions so user-provided content (worktree
          // path, policy file body) is inserted verbatim. String.replace
          // with a string replacement interprets $1, $&, $$, etc. as
          // special patterns, which would mangle a worktree path that
          // contains literal $ characters or any policy content with the
          // same.
          return PROMPT_REVIEW.replace("${path}", () => ctx.worktree).replace("${review_policy}", () => policyText)
        })()
      },
      subtask: true,
      hints: hints(PROMPT_REVIEW),
    }
    commands[Default.ADR] = {
      name: Default.ADR,
      description: "generate an Architecture Decision Record",
      source: "command",
      sourceTool: "builtin",
      scope: "builtin",
      get template() {
        return PROMPT_ADR.replace("${path}", () => ctx.worktree)
      },
      hints: hints(PROMPT_ADR),
    }
    commands[Default.IMPACT] = {
      name: Default.IMPACT,
      description: "generate an Impact Assessment for a proposed change",
      source: "command",
      sourceTool: "builtin",
      scope: "builtin",
      get template() {
        return PROMPT_IMPACT.replace("${path}", () => ctx.worktree)
      },
      hints: hints(PROMPT_IMPACT),
    }
    commands[Default.PRD] = {
      name: Default.PRD,
      description: "generate a Product Requirements Document for a feature",
      source: "command",
      sourceTool: "builtin",
      scope: "builtin",
      get template() {
        return PROMPT_PRD.replace("${path}", () => ctx.worktree)
      },
      hints: hints(PROMPT_PRD),
    }
    commands[Default.GOAL] = {
      name: Default.GOAL,
      description: "set, view, pause, resume, or clear a durable session goal",
      source: "command",
      sourceTool: "builtin",
      scope: "builtin",
      template: "",
      hints: ["$ARGUMENTS"],
    }
    commands[Default.COUNCIL] = {
      name: Default.COUNCIL,
      description: "multi-provider council review (consensus / majority / singleton)",
      source: "command",
      sourceTool: "builtin",
      scope: "builtin",
      get template() {
        return PROMPT_COUNCIL
      },
      hints: hints(PROMPT_COUNCIL),
    }
    commands[Default.ARENA] = {
      name: Default.ARENA,
      description: "multi-provider arena best-of-N plan comparison",
      source: "command",
      sourceTool: "builtin",
      scope: "builtin",
      get template() {
        return PROMPT_ARENA
      },
      hints: hints(PROMPT_ARENA),
    }
    commands[Default.MODE] = {
      name: Default.MODE,
      description: "explain or configure local / cloud / hybrid / council / arena modes",
      source: "command",
      sourceTool: "builtin",
      scope: "builtin",
      get template() {
        return PROMPT_MODE
      },
      hints: hints(PROMPT_MODE),
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      commands[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        source: command.location ? "file" : "command",
        sourceTool: command.sourceTool ?? "config",
        scope: command.scope ?? "config",
        location: command.location,
        warnings: command.warnings,
        workflow: command.workflow,
        allowShell: command.allowShell,
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }

    for (const command of await FileCommand.discover({ directory: ctx.directory, worktree: ctx.worktree })) {
      if (commands[command.name]) continue
      commands[command.name] = {
        name: command.name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        source: "file",
        sourceTool: command.sourceTool,
        scope: command.scope,
        location: command.location,
        warnings: command.warnings,
        workflow: command.workflow,
        allowShell: command.allowShell,
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }

    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      commands[name] = {
        name,
        source: "mcp",
        description: prompt.description,
        mcpPrompt: {
          client: prompt.client,
          name: prompt.name,
        },
        get template() {
          return (async () => {
            const template = await MCP.getPrompt(
              prompt.client,
              prompt.name,
              prompt.arguments
                ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                : {},
            )
            return mcpPromptTemplateText({
              client: prompt.client,
              name: prompt.name,
              messages: template?.messages ?? [],
            })
          })()
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    for (const skill of await Skill.all()) {
      if (commands[skill.name]) continue
      commands[skill.name] = {
        name: skill.name,
        agent: skill.agent,
        description: skill.description,
        source: "skill",
        sourceTool: skill.sourceTool,
        scope: skill.scope,
        location: skill.location,
        argumentHint: skill.argumentHint,
        requiresArguments: skillRequiresArguments(skill),
        get template() {
          return skill.content
        },
        hints: hints(skill.content),
      }
    }

    return {
      commands,
    }
  })

  export async function get(name: string) {
    const current = await state()
    return current.commands[name]
  }

  export async function list() {
    const current = await state()
    return Object.values(current.commands)
  }
}
