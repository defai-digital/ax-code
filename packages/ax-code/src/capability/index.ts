import z from "zod"
import { Agent } from "../agent/agent"
import { Command } from "../command"
import { Config } from "../config/config"
import { Skill } from "../skill"
import { WorkflowTemplate } from "../workflow/template"

export namespace Capability {
  export const Warning = z.object({
    code: z.string(),
    message: z.string(),
    severity: z.enum(["info", "warn", "error"]),
  })
  export type Warning = z.infer<typeof Warning>

  export const Info = z.object({
    kind: z.enum(["command", "skill", "agent", "workflow"]),
    name: z.string(),
    description: z.string().optional(),
    source: z.string().optional(),
    sourceTool: z.string().optional(),
    scope: z.string().optional(),
    location: z.string().optional(),
    warnings: z.array(Warning).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  export type Info = z.infer<typeof Info>

  export async function list(): Promise<Info[]> {
    const [commands, skills, agents, workflows, config] = await Promise.all([
      Command.list(),
      Skill.all(),
      Agent.list(),
      WorkflowTemplate.list(),
      Config.get(),
    ])
    const deprecatedToolsAgents = new Set(
      Object.entries(config.agent ?? {})
        .filter(([, agent]) => agent.tools)
        .map(([name]) => name),
    )

    const entries = [
      ...commands.map(fromCommand),
      ...skills.map(fromSkill),
      ...agents.map((agent) => fromAgent(agent, deprecatedToolsAgents.has(agent.name))),
      ...workflows.map(fromWorkflow),
    ]

    addCommandSkillDuplicateWarnings(entries, commands)

    return entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
  }

  function fromCommand(command: Command.Info): Info {
    return {
      kind: "command",
      name: command.name,
      description: command.description,
      source: command.source,
      sourceTool: command.sourceTool,
      scope: command.scope,
      location: command.location,
      warnings: command.warnings,
      metadata: compactMetadata({
        agent: command.agent,
        model: command.model,
        subtask: command.subtask,
        hints: command.hints,
        workflow: command.workflow,
        allowShell: command.allowShell,
        mcpPrompt: command.mcpPrompt,
      }),
    }
  }

  function fromSkill(skill: Skill.Info): Info {
    return {
      kind: "skill",
      name: skill.name,
      description: skill.description,
      source: skill.builtin ? "builtin" : "skill",
      sourceTool: skill.sourceTool ?? (skill.builtin ? "builtin" : undefined),
      scope: skill.scope ?? (skill.builtin ? "builtin" : undefined),
      location: skill.location,
      warnings: skill.standardIssues?.map((issue) => ({
        code: "skill_standard_issue",
        message: issue,
        severity: "warn" as const,
      })),
      metadata: compactMetadata({
        paths: skill.paths,
        license: skill.license,
        compatibility: skill.compatibility,
        allowedTools: skill.allowedTools,
        argumentHint: skill.argumentHint,
        builtin: skill.builtin,
      }),
    }
  }

  function fromAgent(agent: Agent.Info, deprecatedTools: boolean): Info {
    return {
      kind: "agent",
      name: agent.name,
      description: agent.description,
      source: agent.native ? "builtin" : "config",
      sourceTool: agent.native ? "builtin" : "ax-code",
      scope: agent.native ? "builtin" : "config",
      warnings: deprecatedTools
        ? [
            {
              code: "deprecated_agent_tools",
              message: "Agent config uses deprecated tools; use permission instead.",
              severity: "warn",
            },
          ]
        : undefined,
      metadata: compactMetadata({
        mode: agent.mode,
        tier: Agent.resolveTier(agent),
        displayName: agent.displayName,
        hidden: agent.hidden,
        model: agent.model,
        steps: agent.steps,
      }),
    }
  }

  function fromWorkflow(template: WorkflowTemplate.Info): Info {
    return {
      kind: "workflow",
      name: template.id,
      description: template.description,
      source: template.source,
      sourceTool: "ax-code",
      scope: template.source,
      location: template.path,
      metadata: compactMetadata({
        displayName: template.name,
        trust: template.trust,
        tags: template.tags,
        revision: template.revision,
        specHash: template.specHash,
      }),
    }
  }

  function compactMetadata(input: Record<string, unknown>): Record<string, unknown> | undefined {
    const result = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
    return Object.keys(result).length ? result : undefined
  }

  function addCommandSkillDuplicateWarnings(entries: Info[], commands: Command.Info[]) {
    const realCommandNames = new Set(
      commands.filter((command) => command.source !== "skill").map((command) => command.name),
    )
    if (realCommandNames.size === 0) return

    for (const entry of entries) {
      if (entry.kind !== "skill") continue
      if (!realCommandNames.has(entry.name)) continue
      entry.warnings = [
        ...(entry.warnings ?? []),
        {
          code: "duplicate_command_skill_name",
          message: `A command named "${entry.name}" also exists.`,
          severity: "warn",
        },
      ]
    }
  }
}
