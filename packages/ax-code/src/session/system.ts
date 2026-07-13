import path from "path"
import { existsSync } from "fs"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_AX_ENGINE from "./prompt/ax-engine.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"

import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { supportsLiveSearch } from "@/provider/xai/server-tools"
import { Skill } from "@/skill"
import { getContext as getMemoryContext } from "../memory/injector"
import type { MessageV2 } from "./message-v2"
import { DecisionHints } from "./decision-hints"
import { EventQuery } from "@/replay/query"
import { Recorder } from "../replay/recorder"
import type { SessionID } from "./schema"
import { Log } from "@/util/log"
import { Flag } from "../flag/flag"
import { ScopedFlag } from "../flag/scoped"
import { VerificationPolicy } from "./verification-policy"
import { ModeProtocol } from "../mode/protocol"
import { Config } from "../config/config"
import type { ModePolicy } from "../mode/policy"
import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"

export namespace SystemPrompt {
  const log = Log.create({ service: "session.system-prompt" })

  export function provider(model: Provider.Model) {
    if (model.providerID === "ax-engine") return [PROMPT_AX_ENGINE]
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

  export function request(input: {
    agent: Pick<Agent.Info, "prompt">
    model: Provider.Model
    system: string[]
    userSystem?: string
  }) {
    return [
      ...(input.agent.prompt ? [input.agent.prompt] : provider(input.model)),
      ...input.system,
      ...(input.userSystem ? [input.userSystem] : []),
    ].filter((item) => item.length > 0)
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    // Web search hint per provider. ax-code's default system prompt frames
    // the assistant as a software-engineering tool, which leads some models
    // (notably grok-4.3) to refuse real-world current-state questions
    // outright. Tell the model what search mechanism is wired so it stops
    // declining "I cannot check the weather" when the capability is right
    // there. Three cases:
    //   - xAI Live Search (server-side, no tool call): grok-4+ except multi-agent.
    //   - Alibaba DashScope internet search (server-side, no tool call):
    //     Qwen on alibaba-coding-plan / alibaba-token-plan.
    //   - Other providers fall through to ax-code's `websearch` tool — no
    //     extra hint needed (tool descriptions cover it).
    const apiId = model.api.id.toLowerCase()
    const providerID = model.providerID
    // Mirror the transform-side gate: only emit the hint when the request
    // pipeline will actually attach searchParameters. supportsLiveSearch
    // excludes multi-agent variants and non-grok-4 xAI ids, so
    // custom aliases pointing at e.g. grok-3 don't get a false "search is on"
    // claim from the system prompt.
    const isXaiSearch = model.api.npm === "@ai-sdk/xai" && supportsLiveSearch(model.api.id)
    const isAlibabaQwenSearch =
      model.api.npm === "@ai-sdk/openai-compatible" &&
      (providerID.startsWith("alibaba-coding-plan") || providerID.startsWith("alibaba-token-plan")) &&
      apiId.startsWith("qwen")
    const searchHint = isXaiSearch
      ? ["xAI Live Search is enabled — it runs server-side on this turn", "Citations are returned automatically"]
      : isAlibabaQwenSearch
        ? [
            "Alibaba DashScope internet search is enabled — it runs server-side on this turn",
            "Sources and citations are returned automatically",
          ]
        : undefined
    const liveSearchBlock = searchHint
      ? [
          `<live_search>`,
          `  ${searchHint[0]}.`,
          `  For real-world current state (weather, news, dates, recent events, public-figure activity), let the server-side search handle the lookup — you do not need a separate tool, and you should not decline or tell the user to check elsewhere.`,
          `  ${searchHint[1]}; cite them when summarizing search-derived facts.`,
          `</live_search>`,
        ]
      : []
    const autonomousWorkflow = ScopedFlag.autonomous()
      ? [
          `<autonomous_workflow>`,
          `  Autonomous mode is enabled.`,
          `  Before implementation, create a concise PRD/ADR-style decision frame: problem, constraints, decision, tradeoffs, plan, and validation.`,
          `  For substantial multi-file, architectural, or product-visible changes, create or update a repo document when that matches the repository's documentation pattern.`,
          `  For trivial changes, keep the PRD/ADR frame lightweight in the plan instead of creating permanent docs.`,
          `  Prefer industry/common best practices and avoid over-engineering: choose the simplest change that solves the task, avoid new abstractions without 3+ concrete use cases, and verify before expanding scope.`,
          `  Sandwich non-trivial work: plan → implement → verify (tests/build/verify_project) before claiming done.`,
          `  For independent research digs (not multi-provider ensemble), prefer task_parallel with explore agents; do not run concurrent writers.`,
          `  If the user asks for council or arena multi-provider review, call council/arena within 1–2 tool rounds — do not start with task_parallel monorepo digs.`,
          `  When autonomous mode makes choices for the user, record those choices in the final response.`,
          `  Before ending your turn, mark every todo as completed or cancelled — never leave todos in pending or in_progress state.`,
          `</autonomous_workflow>`,
        ]
      : []

    let verificationProtocol: string[] = []
    try {
      const preferred = await VerificationPolicy.resolvePreferredCommands(Instance.directory)
      verificationProtocol = [VerificationPolicy.renderVerificationProtocol(preferred)]
    } catch (error) {
      log.warn("verification protocol resolve failed", { error })
      verificationProtocol = [
        VerificationPolicy.renderVerificationProtocol({
          ecosystem: "unknown",
          typecheck: null,
          lint: null,
          test: null,
          preferred: [],
        }),
      ]
    }
    const isHtmlProject = (() => {
      try {
        const dir = Instance.directory
        return existsSync(path.join(dir, "index.html")) || existsSync(path.join(dir, "index.htm"))
      } catch {
        return false
      }
    })()
    const htmlDevWorkflow = isHtmlProject
      ? [
          `<html_dev_workflow>`,
          `  You are working in an HTML development project (index.html detected).`,
          `  IMPORTANT: Do NOT run \`open\`, \`xdg-open\`, \`start\`, or \`sensible-browser\` commands to verify your output.`,
          `  After applying changes, report: "Changes applied — refresh your browser to see the update."`,
          `  Avoid double-quoted CSS values such as url("data:image/...") inside double-quoted style attributes; verify rendered DOM when visual output matters.`,
          `  If the playwright MCP server is connected, use browser_screenshot to verify rendering without opening a new window.`,
          `  Only open the browser when the user explicitly asks you to.`,
          `</html_dev_workflow>`,
        ]
      : []

    const debugEngineWorkflow = Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE
      ? [
          `<debug_engine_workflow>`,
          `  Debugging & Refactoring Engine tools are enabled in this session.`,
          `  Prefer debug_analyze, impact_analyze, verify_project, and debug_apply_verification when they match the task and are available in the tool list.`,
          `</debug_engine_workflow>`,
        ]
      : [
          `<debug_engine_workflow>`,
          `  Debugging & Refactoring Engine tools are not enabled in this session.`,
          `  Do not call DRE-only tools unless they are present in the active tool list; use read, grep, bash, edit/write/apply_patch, and verify_project instead.`,
          `</debug_engine_workflow>`,
        ]

    let executionModesProtocol: string[] = []
    try {
      const cfg = await Config.get()
      const modes = (cfg as { modes?: ModePolicy.ModesConfig }).modes
      const localProvider = modes?.hybrid?.localProviderID ?? AX_ENGINE_PROVIDER_ID
      executionModesProtocol = [
        ModeProtocol.renderExecutionModes({
          defaultMode: modes?.default,
          councilEnabled: modes?.council?.enabled !== false,
          arenaEnabled: modes?.arena?.enabled === true,
          localAvailable: model.providerID === localProvider,
        }),
      ]
    } catch (error) {
      log.warn("execution modes protocol resolve failed", { error })
      executionModesProtocol = [ModeProtocol.renderExecutionModes()]
    }

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
        ...liveSearchBlock,
        ...autonomousWorkflow,
        ...verificationProtocol,
        ...executionModesProtocol,
        ...htmlDevWorkflow,
        ...debugEngineWorkflow,
      ].join("\n"),
    ]
  }

  export function assuranceWorkflow(
    agent: Pick<Agent.Info, "permission">,
    model?: Pick<Provider.Model, "providerID">,
  ): string | undefined {
    if (model?.providerID === "ax-engine") return undefined
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
      if (matched.length > 0) {
        recommended = new Set(matched.map((s) => s.name))
        recordSkillRecommendations({ agent, available: list, matched, filePaths, messages })
      }
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

  const FILE_TOOLS = new Set(["read", "edit", "write", "multiedit"])

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

  function recordSkillRecommendations(input: {
    agent: Agent.Info
    available: Skill.Info[]
    matched: Skill.Info[]
    filePaths: string[]
    messages: MessageV2.WithParts[]
  }) {
    const sessionID = inferSessionID(input.messages)
    if (!sessionID) return
    Recorder.emit({
      type: "skill.recommended",
      sessionID,
      messageID: input.messages.at(-1)?.info.id,
      agent: input.agent.name,
      source: "path_match",
      availableSkillCount: input.available.length,
      filePaths: input.filePaths,
      skills: input.matched.map((skill) => ({
        name: skill.name,
        sourceTool: skill.sourceTool,
        scope: skill.scope,
        paths: skill.paths,
      })),
    })
  }

  export function extractFilePaths(messages: MessageV2.WithParts[]): string[] {
    const worktree = Instance.worktree
    const result = new Set<string>()
    const addRelativePath = (filePath: string) => result.add(path.relative(worktree, filePath))

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (!FILE_TOOLS.has(part.tool)) continue
        const input = part.state.input
        if (typeof input?.file_path === "string") addRelativePath(input.file_path)
        if (typeof input?.filePath === "string") addRelativePath(input.filePath)
        if (Array.isArray(input?.edits)) {
          for (const edit of input.edits) {
            if (typeof edit?.filePath === "string") addRelativePath(edit.filePath)
            if (typeof edit?.file_path === "string") addRelativePath(edit.file_path)
          }
        }
      }
    }
    return Array.from(result)
  }
}
