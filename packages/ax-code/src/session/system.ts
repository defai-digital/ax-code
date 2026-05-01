import path from "path"
import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"

import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { getContext as getMemoryContext } from "../memory/injector"
import type { MessageV2 } from "./message-v2"
import { DecisionHints } from "./decision-hints"
import { EventQuery } from "@/replay/query"
import type { SessionID } from "./schema"
import { Log } from "@/util/log"

export namespace SystemPrompt {
  const log = Log.create({ service: "session.system-prompt" })

  export function provider(model: Provider.Model) {
    if (
      model.api.id.includes("gpt-4") ||
      model.api.id.includes("o1") ||
      model.api.id.includes("o3") ||
      model.api.id.includes("gpt")
    )
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
    return [PROMPT_DEFAULT]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    const autonomousWorkflow =
      process.env["AX_CODE_AUTONOMOUS"] === "true"
        ? [
            `<autonomous_workflow>`,
            `  Autonomous mode is enabled.`,
            `  Before implementation, create a concise PRD/ADR-style decision frame: problem, constraints, decision, tradeoffs, plan, and validation.`,
            `  For substantial multi-file, architectural, or product-visible changes, create or update a repo document when that matches the repository's documentation pattern.`,
            `  For trivial changes, keep the PRD/ADR frame lightweight in the plan instead of creating permanent docs.`,
            `  Prefer industry/common best practices and avoid over-engineering: choose the simplest change that solves the task, avoid new abstractions without 3+ concrete use cases, and verify before expanding scope.`,
            `  When autonomous mode makes choices for the user, record those choices in the final response.`,
            `  Before ending your turn, mark every todo as completed or cancelled — never leave todos in pending or in_progress state.`,
            `</autonomous_workflow>`,
          ]
        : []
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Workspace root folder: ${Instance.worktree}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<directories>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 50,
              })
            : ""
        }`,
        `</directories>`,
        ...autonomousWorkflow,
      ].join("\n"),
    ]
  }

  export function assuranceWorkflow(agent: Pick<Agent.Info, "permission">): string | undefined {
    if (!agent.permission) return undefined
    const reviewTools = ["register_finding", "verify_project", "review_complete"]
    const disabled = Permission.disabled(reviewTools, agent.permission)
    if (reviewTools.some((tool) => disabled.has(tool))) return undefined

    return [
      `<assurance_workflow>`,
      `  For explicit code review, QA, or audit tasks, prefer structured evidence over prose-only conclusions.`,
      `  Record actionable review findings with register_finding; do not duplicate those findings as separate prose blocks.`,
      `  Before approving or closing a review, run or cite verify_project with the relevant workflow and scope so the session has VerificationEnvelope evidence.`,
      `  Finish code reviews with review_complete, citing the relevant finding ids and verification envelope ids.`,
      `  Do not approve a review unless the selected verification set has at least one passed envelope and no failed, error, or timeout envelopes.`,
      `</assurance_workflow>`,
    ].join("\n")
  }

  /**
   * Project memory for the active agent.
   *
   * Reads `.ax-code/memory.json` and renders the entries that apply to this
   * agent (entries with no `agents` allow-list apply to all). Returns
   * `undefined` when no memory is cached or when nothing applies, so callers
   * can skip the section cleanly.
   */
  export async function memory(agent: Agent.Info, messages?: MessageV2.WithParts[]): Promise<string | undefined> {
    const paths = messages ? extractFilePaths(messages) : undefined
    const ctx = await getMemoryContext(Instance.directory, { agent: agent.name, paths })
    return ctx ? ctx : undefined
  }

  export async function decisionHints(input: {
    messages?: MessageV2.WithParts[]
    sessionID?: SessionID
  }): Promise<string | undefined> {
    const sessionID = input.sessionID ?? inferSessionID(input.messages)
    if (sessionID) {
      try {
        const replay = DecisionHints.analyzeEvents(EventQuery.recentBySession(sessionID))
        if (replay.actionCount > 0) return DecisionHints.render(replay.hints)
      } catch (error) {
        log.warn("decision hint replay load failed", { sessionID, error })
      }
    }
    return DecisionHints.render(DecisionHints.fromMessages(input.messages))
  }

  export async function skills(agent: Agent.Info, messages?: MessageV2.WithParts[]) {
    if (Permission.disabled(["skill"], agent.permission).has("skill")) return

    const list = await Skill.available(agent)

    let recommended: Set<string> | undefined
    if (messages) {
      const filePaths = extractFilePaths(messages)
      const matched = Skill.matchByPaths(list, filePaths)
      if (matched.length > 0) recommended = new Set(matched.map((s) => s.name))
    }

    return [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      ...(recommended?.size
        ? ["Some skills below match files in the current conversation and are recommended for loading."]
        : []),
      // the agents seem to ingest the information about skills a bit better if we present a more verbose
      // version of them here and a less verbose version in tool description, rather than vice versa.
      Skill.fmt(list, { verbose: true, recommended }),
    ].join("\n")
  }

  export const FILE_TOOLS = new Set(["read", "edit", "write", "multiedit"])

  /** True if any message contains a file-tool call (read/edit/write/multiedit). */
  export function hasFileToolCall(messages: MessageV2.WithParts[]): boolean {
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === "tool" && FILE_TOOLS.has(part.tool)) return true
      }
    }
    return false
  }

  export function inferSessionID(messages?: MessageV2.WithParts[]): SessionID | undefined {
    for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
      const sessionID = messages?.[i]?.info.sessionID
      if (sessionID) return sessionID
    }
    return undefined
  }

  export function extractFilePaths(messages: MessageV2.WithParts[]): string[] {
    const worktree = Instance.worktree
    const result = new Set<string>()
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (!FILE_TOOLS.has(part.tool)) continue
        const input = part.state.input
        if (typeof input?.file_path === "string") result.add(path.relative(worktree, input.file_path))
        if (typeof input?.filePath === "string") result.add(path.relative(worktree, input.filePath))
        if (Array.isArray(input?.edits)) {
          for (const edit of input.edits) {
            if (typeof edit?.filePath === "string") result.add(path.relative(worktree, edit.filePath))
            if (typeof edit?.file_path === "string") result.add(path.relative(worktree, edit.file_path))
          }
        }
      }
    }
    return Array.from(result)
  }
}
