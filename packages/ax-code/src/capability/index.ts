import path from "path"
import z from "zod"
import { Agent } from "../agent/agent"
import { Command } from "../command"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { InstructionPrompt } from "../session/instruction"
import { Skill } from "../skill"
import { Filesystem } from "../util/filesystem"
import { WorkflowTemplate } from "../workflow/template"

export namespace Capability {
  export const Warning = z.object({
    code: z.string(),
    message: z.string(),
    severity: z.enum(["info", "warn", "error"]),
  })
  export type Warning = z.infer<typeof Warning>

  export const Info = z.object({
    kind: z.enum(["instruction", "command", "skill", "agent", "workflow"]),
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

  export async function list(input: { filePaths?: string[] } = {}): Promise<Info[]> {
    const [instructions, commands, skills, agents, workflows, config] = await Promise.all([
      instructionEntries(),
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
      ...instructions,
      ...commands.map(fromCommand),
      ...skills.map((skill) => fromSkill(skill, input.filePaths ?? [])),
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
        argumentHint: command.argumentHint,
        requiresArguments: command.requiresArguments,
        workflow: command.workflow,
        requiresWorkflowRuntime: command.workflow !== undefined,
        allowShell: command.allowShell,
        mcpPrompt: command.mcpPrompt,
        permissionImpact: command.workflow
          ? "workflow"
          : command.source === "mcp"
            ? "mcp_prompt_permission"
            : command.agent
              ? "agent_permissions"
              : "default_agent_permissions",
      }),
    }
  }

  function fromSkill(skill: Skill.Info, filePaths: string[]): Info {
    const recommended = Skill.matchByPaths([skill], filePaths).length > 0
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
        recommended,
        permissionImpact: skill.allowedTools?.length ? "declares_allowed_tools" : "instructions_only",
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
        permissionImpact: permissionImpact(agent.permission),
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
        requiresWorkflowRuntime: true,
        permissionImpact: template.spec.permissions,
      }),
    }
  }

  async function instructionEntries(): Promise<Info[]> {
    const paths = Array.from(await InstructionPrompt.systemPaths()).sort((a, b) => a.localeCompare(b))
    return Promise.all(
      paths.map(async (file) => ({
        kind: "instruction" as const,
        name: instructionName(file),
        description: "Always-on instruction context loaded for this project.",
        source: "instruction",
        sourceTool: "ax-code",
        scope: Filesystem.contains(Instance.worktree, file) ? "project" : "config",
        location: file,
        metadata: compactMetadata({
          permissionImpact: "instructions_only",
          recommended: true,
        }),
      })),
    )
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

  function permissionImpact(ruleset: Agent.Info["permission"]) {
    const counts: Record<"allow" | "ask" | "deny", number> = { allow: 0, ask: 0, deny: 0 }
    for (const rule of ruleset) counts[rule.action]++
    return counts
  }

  function instructionName(file: string) {
    const relative = path.relative(Instance.worktree, file)
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) return relative
    return path.basename(file)
  }
}
