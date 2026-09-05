import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { BashOutputTool } from "./bash_output"
import { BashInputTool } from "./bash_input"
import { KillShellTool } from "./kill_shell"
import { MonitorTool } from "./monitor"
import { NotebookEditTool } from "./notebook_edit"
import { ImageGenTool } from "./image_gen"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ListTool } from "./ls"
import { BatchTool } from "./batch"
import { ContextStatusTool } from "./context_status"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TaskParallelTool } from "./task_parallel"
import { WaitForTool } from "./waitfor"
import { ListBackgroundTasksTool } from "./list_background_tasks"
import { MessageBackgroundTaskTool } from "./message_background_task"
import { CouncilTool } from "./council"
import { ArenaTool } from "./arena"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@ax-code/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { toErrorMessage } from "@/util/error-message"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { CodeIntelligenceTool } from "./code-intelligence"
import { SymbolNoteTool } from "./symbol_note"
import { DebugAnalyzeTool } from "./debug_analyze"
import { RefactorPlanTool } from "./refactor_plan"
import { DedupScanTool } from "./dedup_scan"
import { ImpactAnalyzeTool } from "./impact_analyze"
import { HardcodeScanTool } from "./hardcode_scan"
import { RefactorApplyTool } from "./refactor_apply"
import { RaceScanTool } from "./race_scan"
import { LifecycleScanTool } from "./lifecycle_scan"
import { SecurityScanTool } from "./security_scan"
import { Truncate } from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { RegisterFindingTool } from "./register_finding"
import { VerifyProjectTool } from "./verify_project"
import { ReviewCompleteTool } from "./review_complete"
import { OpsPlanTool } from "./ops_plan"
import { OpsDiffTool } from "./ops_diff"
import { OpsApproveTool } from "./ops_approve"
import { OpsApplyTool } from "./ops_apply"
import { OpsVerifyTool } from "./ops_verify"
import { OpsJournalTool } from "./ops_journal"
import { MemorySaveTool } from "./memory"
import { GetGoalTool, CreateGoalTool, UpdateGoalTool } from "./goal"
import { SubmitGoalPlanTool } from "./submit_goal_plan"
import {
  ScheduleTaskTool,
  ListScheduledTasksTool,
  ManageScheduledTaskTool,
  RunScheduledTaskTool,
  ListScheduledTaskRunsTool,
} from "./schedule"
import { BrowserOpenTool } from "./browser/open"
import { BrowserSnapshotTool } from "./browser/snapshot"
import { BrowserActionTool } from "./browser/action"
import { BrowserCaptureTool } from "./browser/capture"
import { BrowserConsoleTool } from "./browser/console"
import { BrowserNetworkTool } from "./browser/network"
import { BrowserEvaluateTool } from "./browser/evaluate"
import { ComputerSnapshotTool } from "./computer/computer_snapshot"
import { ComputerActionTool } from "./computer/computer_action"
import { ComputerWatchTool } from "./computer/computer_watch"
import { ComputerPlanTool } from "./computer/computer_plan"
import { VisualCritiqueTool } from "./visual/critique"
import { VisualCompareTool } from "./visual/compare"
import { VisualSnapshotTool } from "./visual/snapshot"
import { DebugOpenCaseTool } from "./debug_open_case"
import { DebugCaptureEvidenceTool } from "./debug_capture_evidence"
import { DebugPlanInstrumentationTool } from "./debug_plan_instrumentation"
import { DebugProposeHypothesisTool } from "./debug_propose_hypothesis"
import { DebugApplyVerificationTool } from "./debug_apply_verification"
import { DebugRepairFromEnvelopeTool } from "./debug_repair_from_envelope"
import { Glob } from "../util/glob"
import { pathToFileURL } from "url"
import { createHash } from "node:crypto"
import { Instance } from "@/project/instance"
import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"
import AX_ENGINE_BASH_DESCRIPTION from "./bash-ax-engine.txt"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })
  const DEBUG_ENGINE_TOOLS = [
    DebugAnalyzeTool,
    RefactorPlanTool,
    DedupScanTool,
    ImpactAnalyzeTool,
    HardcodeScanTool,
    RefactorApplyTool,
    RaceScanTool,
    LifecycleScanTool,
    SecurityScanTool,
  ]

  export function debugEngineToolCount(): number {
    return DEBUG_ENGINE_TOOLS.length
  }

  type InitializedTool = Awaited<ReturnType<Tool.Info["init"]>> & { id: string }

  type RegistryState = {
    custom: Tool.Info[]
    registrations: Map<string, Array<{ token: symbol; tool: Tool.Info }>>
    cache?: { key: string; result: InitializedTool[] }
    pending?: { key: string; promise: Promise<InitializedTool[]> }
    generation: number
  }

  const state = Instance.state(async (): Promise<RegistryState> => {
    const ctx = Instance.current
    const custom: Tool.Info[] = []

    function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
      return {
        id,
        init: async (initCtx) => ({
          parameters: z.object(def.args),
          description: def.description,
          execute: async (args, toolCtx) => {
            const pluginCtx = {
              ...toolCtx,
              directory: ctx.directory,
              worktree: ctx.worktree,
            } as unknown as PluginToolContext
            const result = await def.execute(args as any, pluginCtx)
            const out = await Truncate.output(result, {}, initCtx?.agent)
            return {
              title: "",
              output: out.truncated ? out.content : result,
              metadata: {
                truncated: out.truncated,
                outputPath: out.truncated ? out.outputPath : undefined,
                fullOutputPath: out.truncated ? out.fullOutputPath : undefined,
                originalSize: out.truncated ? out.originalSize : undefined,
                truncatedTo: out.truncated ? out.truncatedTo : undefined,
                contentHint: out.truncated ? out.contentHint : undefined,
              },
            }
          },
        }),
      }
    }

    const matches = await Config.directories().then((dirs) =>
      dirs.flatMap((dir) =>
        Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: false }),
      ),
    )
    if (matches.length) await Config.waitForDependencies()
    for (const match of matches) {
      const namespace = path.basename(match, path.extname(match))
      try {
        const mod = await import(process.platform === "win32" ? match : pathToFileURL(match).href)
        for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
          custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
        }
      } catch (err) {
        log.warn("failed to load tool, registering as unavailable", { match, err })
        const errMsg = toErrorMessage(err)
        custom.push(
          fromPlugin(namespace, {
            description: `Tool ${namespace} failed to load: ${errMsg}`,
            args: {},
            execute: async () => {
              throw new Error(`Tool ${namespace} is unavailable: ${errMsg}`)
            },
          }),
        )
      }
    }

    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom, registrations: new Map(), generation: 0 }
  })

  type ToolConfig = Awaited<ReturnType<typeof Config.get>>

  function cacheKey(input: {
    model: { providerID: ProviderID; modelID: ModelID }
    agent?: Agent.Info
    cfg: ToolConfig
  }) {
    // Tool initializers receive the full agent and may depend on permissions,
    // options, or other fields. Keying only by agent name reused stale Skill,
    // Task, truncation, and custom-tool definitions after same-named agent
    // policy changes. Keep the whole initializer input in a JSON tuple, which
    // also avoids delimiter collisions between arbitrary string fields.
    return createHash("sha256")
      .update(
        JSON.stringify([
          input.agent ?? null,
          input.model.providerID,
          input.model.modelID,
          Flag.AX_CODE_CLIENT,
          Flag.AX_CODE_ENABLE_QUESTION_TOOL,
          Flag.AX_CODE_ENABLE_EXA,
          Flag.AX_CODE_EXPERIMENTAL_LSP_TOOL,
          Flag.AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE,
          Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
          Flag.AX_CODE_EXPERIMENTAL_PLAN_MODE,
          Flag.AX_CODE_EXPERIMENTAL_BROWSER_AGENT,
          input.cfg.provider?.[AX_ENGINE_PROVIDER_ID]?.options?.toolProfile ?? "core",
          // computer tools are config-gated; a config change must not reuse a
          // cached definition list from before the change
          input.cfg.computer ?? null,
          // Include the whole map so future experimental tool flags cannot silently
          // reuse an entry produced before a config change.
          input.cfg.experimental ?? {},
        ]),
      )
      .digest("base64url")
  }

  async function all(custom: Tool.Info[], cfg?: ToolConfig, providerID?: ProviderID): Promise<Tool.Info[]> {
    cfg ??= await Config.get()
    const question = Flag.AX_CODE_CLIENT === "cli" || Flag.AX_CODE_ENABLE_QUESTION_TOOL
    const axEngineToolProfile = cfg.provider?.[AX_ENGINE_PROVIDER_ID]?.options?.toolProfile ?? "core"
    if (providerID === AX_ENGINE_PROVIDER_ID && axEngineToolProfile !== "full") {
      // Local coding models have materially smaller context budgets than the
      // hosted models the full registry was designed for. Keep the first-turn
      // schema focused on tools needed to inspect, edit, and verify code. The
      // full profile remains an explicit escape hatch for large-context custom
      // AX Engine deployments.
      return [
        InvalidTool,
        ...(question ? [QuestionTool] : []),
        BashTool,
        BashOutputTool,
        BashInputTool,
        KillShellTool,
        ListTool,
        ReadTool,
        GlobTool,
        GrepTool,
        EditTool,
        WriteTool,
        SkillTool,
        SubmitGoalPlanTool,
      ]
    }
    // Keep local ax-engine tool schemas focused; debug-engine tools are large,
    // experimental, and unnecessary for the normal local-model path.
    const debugEngineEnabled = Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE && providerID !== AX_ENGINE_PROVIDER_ID

    return [
      InvalidTool,
      ...(question ? [QuestionTool] : []),
      BashTool,
      BashOutputTool,
      BashInputTool,
      KillShellTool,
      MonitorTool,
      ListTool,
      ReadTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      NotebookEditTool,
      TaskTool,
      TaskParallelTool,
      WaitForTool,
      ListBackgroundTasksTool,
      MessageBackgroundTaskTool,
      CouncilTool,
      ArenaTool,
      WebFetchTool,
      TodoWriteTool,
      WebSearchTool,
      CodeSearchTool,
      ImageGenTool,
      SkillTool,
      MemorySaveTool,
      GetGoalTool,
      CreateGoalTool,
      UpdateGoalTool,
      SubmitGoalPlanTool,
      ScheduleTaskTool,
      ListScheduledTasksTool,
      ManageScheduledTaskTool,
      RunScheduledTaskTool,
      ListScheduledTaskRunsTool,
      ApplyPatchTool,
      RegisterFindingTool,
      VerifyProjectTool,
      ReviewCompleteTool,
      OpsPlanTool,
      OpsDiffTool,
      OpsApproveTool,
      OpsApplyTool,
      OpsVerifyTool,
      OpsJournalTool,
      DebugOpenCaseTool,
      DebugCaptureEvidenceTool,
      DebugPlanInstrumentationTool,
      DebugProposeHypothesisTool,
      DebugApplyVerificationTool,
      DebugRepairFromEnvelopeTool,
      ...(Flag.AX_CODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(Flag.AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE ? [CodeIntelligenceTool, SymbolNoteTool] : []),
      ...(debugEngineEnabled ? [...DEBUG_ENGINE_TOOLS] : []),
      ...(cfg.experimental?.batch_tool === true ? [BatchTool] : []),
      ...(cfg.experimental?.context_tools === true ? [ContextStatusTool] : []),
      // computer-use tools require an explicit backend configuration
      ...(cfg.computer?.provider
        ? [ComputerSnapshotTool, ComputerActionTool, ComputerWatchTool, ComputerPlanTool]
        : []),
      ...(Flag.AX_CODE_EXPERIMENTAL_PLAN_MODE && Flag.AX_CODE_CLIENT === "cli" ? [PlanExitTool] : []),
      ...(Flag.AX_CODE_EXPERIMENTAL_BROWSER_AGENT
        ? [
            BrowserOpenTool,
            BrowserSnapshotTool,
            BrowserActionTool,
            BrowserCaptureTool,
            BrowserConsoleTool,
            BrowserNetworkTool,
            BrowserEvaluateTool,
            VisualCritiqueTool,
            VisualCompareTool,
            VisualSnapshotTool,
          ]
        : []),
      ...custom,
    ]
  }

  function invalidate(current: RegistryState) {
    current.cache = undefined
    current.pending = undefined
    current.generation++
  }

  function activeRegistrations(current: RegistryState): Map<string, Tool.Info> {
    const active = new Map<string, Tool.Info>()
    for (const [id, layers] of current.registrations) {
      const latest = layers.at(-1)
      if (latest) active.set(id, latest.tool)
    }
    return active
  }

  async function allForState(current: RegistryState, cfg?: ToolConfig, providerID?: ProviderID): Promise<Tool.Info[]> {
    const base = await all(current.custom, cfg, providerID)
    const active = activeRegistrations(current)
    if (active.size === 0) return base
    return [...base.filter((tool) => !active.has(tool.id)), ...active.values()]
  }

  export async function register(tool: Tool.Info): Promise<() => void> {
    const current = await state()
    const token = Symbol(tool.id)
    const layers = current.registrations.get(tool.id) ?? []
    layers.push({ token, tool })
    current.registrations.set(tool.id, layers)
    invalidate(current)

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const existing = current.registrations.get(tool.id)
      if (!existing) return
      const index = existing.findIndex((layer) => layer.token === token)
      if (index === -1) return
      existing.splice(index, 1)
      if (existing.length === 0) current.registrations.delete(tool.id)
      invalidate(current)
    }
  }

  export async function ids(): Promise<string[]> {
    const current = await state()
    const tools = await allForState(current)
    return tools.map((t) => t.id)
  }

  export async function tools(
    model: {
      providerID: ProviderID
      modelID: ModelID
    },
    agent?: Agent.Info,
  ): Promise<InitializedTool[]> {
    const current = await state()
    const cfg = await Config.get()
    const key = cacheKey({ model, agent, cfg })
    if (current.cache?.key === key) return current.cache.result
    if (current.pending?.key === key) return current.pending.promise

    const generation = current.generation
    const promise = (async () => {
      const allTools = await allForState(current, cfg, model.providerID)
      // Per-tool try/catch so one broken tool (most commonly a
      // flaky MCP server whose `init()` rejects during tool
      // registration) doesn't reject Promise.all and leave the
      // agent with zero usable tools — including the built-in
      // read/write/bash/edit that have no dependency on the
      // failing tool. Failed tools are logged and filtered out;
      // the remaining tools register normally.
      const raw = await Promise.all(
        allTools
          .filter((tool) => {
            // Enable websearch/codesearch for zen users OR via enable flag
            if (tool.id === "codesearch" || tool.id === "websearch") {
              return model.providerID === ProviderID.axCode || Flag.AX_CODE_ENABLE_EXA
            }

            // use apply tool in same format as codex
            const usePatch =
              model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
            if (tool.id === "apply_patch") return usePatch
            if (tool.id === "edit" || tool.id === "write") return !usePatch

            return true
          })
          .map(async (tool) => {
            try {
              using _ = log.time(tool.id)
              const next = await tool.init({ agent, model })
              const description =
                model.providerID === AX_ENGINE_PROVIDER_ID && tool.id === "bash"
                  ? AX_ENGINE_BASH_DESCRIPTION.replaceAll("${directory}", Instance.directory)
                      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
                      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES))
                  : next.description
              const output = {
                description,
                parameters: next.parameters,
              }
              await Plugin.trigger("tool.definition", { toolID: tool.id }, output)
              return {
                id: tool.id,
                ...next,
                description: output.description,
                parameters: output.parameters,
              }
            } catch (err) {
              log.error("tool init failed, skipping", { id: tool.id, err })
              return undefined
            }
          }),
      )
      const result = raw.filter((tool): tool is InitializedTool => tool !== undefined)
      if (current.generation === generation) current.cache = { key, result }
      return result
    })()
    const inFlight = { key, promise }
    current.pending = inFlight
    try {
      return await inFlight.promise
    } finally {
      if (current.pending === inFlight) current.pending = undefined
    }
  }
}
