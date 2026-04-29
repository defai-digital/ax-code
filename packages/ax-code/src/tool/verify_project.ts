import path from "path"
import z from "zod"
import { Instance } from "../project/instance"
import {
  resolveCommands,
  runCheck,
  runTests,
  type TimedCheckResult,
  type TimedTestResult,
} from "../planner/verification/runner"
import { WorkflowEnum } from "../quality/finding"
import { computeEnvelopeId, type VerificationEnvelope } from "../quality/verification-envelope"
import { fromVerificationCommandResult } from "../quality/verification-envelope-builder"
import { Tool } from "./tool"
import DESCRIPTION from "./verify_project.txt"

const CommandOverrides = z
  .object({
    typecheck: z.string().min(1).nullable().optional(),
    lint: z.string().min(1).nullable().optional(),
    test: z.string().min(1).nullable().optional(),
  })
  .strict()

type Timed<T> = T & { duration: number }

function normalizePaths(paths: readonly string[] | undefined): string[] {
  return (paths ?? []).map((file) => {
    if (!path.isAbsolute(file)) return file.replaceAll("\\", "/")
    return path.relative(Instance.worktree, file).replaceAll("\\", "/")
  })
}

function scope(paths: readonly string[], description?: string): VerificationEnvelope["scope"] {
  if (description) {
    return {
      kind: "custom",
      description,
      ...(paths.length > 0 ? { paths: [...paths] } : {}),
    }
  }
  if (paths.length > 0) return { kind: "file", paths: [...paths] }
  return { kind: "workspace" }
}

async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const start = Date.now()
  const result = await fn()
  return { ...result, duration: Date.now() - start }
}

function runnableCommands(commands: { typecheck: string | null; lint: string | null; test: string | null }): string[] {
  return [commands.typecheck, commands.lint, commands.test].filter((cmd): cmd is string => Boolean(cmd))
}

function statusLine(label: string, envelope: VerificationEnvelope, id: string): string {
  const commandText = envelope.command.argv.length > 0 ? ` (${envelope.command.argv.slice(2).join(" ")})` : ""
  const issueText =
    envelope.structuredFailures.length > 0 ? `, ${envelope.structuredFailures.length} parsed failure(s)` : ""
  return `${label}: ${envelope.result.status}${issueText}, envelope=${id}${commandText}`
}

function passed(envelopes: VerificationEnvelope[]): boolean {
  return envelopes.every((envelope) => envelope.result.status === "passed" || envelope.result.status === "skipped")
}

export const VerifyProjectTool = Tool.define("verify_project", {
  description: DESCRIPTION,
  parameters: z.object({
    workflow: WorkflowEnum.optional().describe('Assurance lane: "review", "debug", or "qa". Defaults to "qa".'),
    paths: z.array(z.string().min(1)).max(200).optional().describe("Repo-relative files that define the scope."),
    scopeDescription: z.string().min(1).max(500).optional().describe("Human-readable scope when paths are not enough."),
    commands: CommandOverrides.optional().describe(
      "Optional command overrides. Omit a field to infer from package.json, set it to null to skip, or set it to a command string to run exactly that command.",
    ),
  }),
  execute: async (args, ctx) => {
    const workflow = args.workflow ?? "qa"
    const cwd = Instance.worktree
    const paths = normalizePaths(args.paths)
    const commands = await resolveCommands(cwd, args.commands)
    const commandPatterns = runnableCommands(commands)

    if (commandPatterns.length > 0) {
      await ctx.ask({
        permission: "bash",
        patterns: commandPatterns,
        always: commandPatterns,
        metadata: {
          tool: "verify_project",
          workflow,
          scope: scope(paths, args.scopeDescription),
        },
      })
    }

    if (ctx.abort.aborted) throw new DOMException("verify_project aborted", "AbortError")

    const typecheck: Timed<TimedCheckResult> = await timed(() => runCheck("typecheck", commands.typecheck, cwd))
    if (ctx.abort.aborted) throw new DOMException("verify_project aborted", "AbortError")

    const lint: Timed<TimedCheckResult> = await timed(() => runCheck("lint", commands.lint, cwd))
    if (ctx.abort.aborted) throw new DOMException("verify_project aborted", "AbortError")

    const tests: Timed<TimedTestResult> = await timed(() =>
      runTests(commands.test, cwd, paths, Instance.project.id, "worktree"),
    )

    const verificationEnvelopes = fromVerificationCommandResult({
      workflow,
      sessionID: ctx.sessionID,
      cwd,
      sourceTool: "verify_project",
      scope: scope(paths, args.scopeDescription),
      commands,
      checks: {
        typecheck,
        lint,
        tests,
      },
    })
    const envelopeIds = verificationEnvelopes.map((envelope) => ({
      envelopeId: computeEnvelopeId(envelope),
      name: envelope.result.name,
      status: envelope.result.status,
    }))

    const lines = [
      `Workflow: ${workflow}`,
      `Scope: ${args.scopeDescription ?? (paths.length > 0 ? paths.join(", ") : "workspace")}`,
      `Passed: ${passed(verificationEnvelopes)}`,
      "",
      ...verificationEnvelopes.map((envelope, index) =>
        statusLine(envelope.result.name, envelope, envelopeIds[index].envelopeId),
      ),
    ]

    return {
      title: passed(verificationEnvelopes) ? "verify_project passed" : "verify_project failed",
      output: lines.join("\n"),
      metadata: {
        passed: passed(verificationEnvelopes),
        envelopeIds,
        commands,
        verificationEnvelopes,
      },
    }
  },
})
