import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
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
import { MemorySaveTool } from "./memory"
import { GetGoalTool, CreateGoalTool, UpdateGoalTool } from "./goal"
import { DebugOpenCaseTool } from "./debug_open_case"
import { DebugCaptureEvidenceTool } from "./debug_capture_evidence"
import { DebugPlanInstrumentationTool } from "./debug_plan_instrumentation"
import { DebugProposeHypothesisTool } from "./debug_propose_hypothesis"
import { DebugApplyVerificationTool } from "./debug_apply_verification"
import { DebugRepairFromEnvelopeTool } from "./debug_repair_from_envelope"
import { Glob } from "../util/glob"
import { pathToFileURL } from "url"
import { Instance } from "@/project/instance"

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

  type State = {
    custom: Tool.Info[]
  }

  type InitializedTool = Awaited<ReturnType<Tool.Info["init"]>> & { id: string }

  const state = Instance.state(async () => {
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

    return { custom }
  })

  type ToolConfig = Awaited<ReturnType<typeof Config.get>>

  function cacheKey(input: {
    model: { providerID: ProviderID; modelID: ModelID }
    agent?: Agent.Info
    cfg: ToolConfig
  }) {
    // Hash the whole `experimental` map rather than pinning specific
    // flags. The previous hand-rolled list missed any new experimental
    // tool flag added to `all()` and silently served stale cache
    // entries when the flag flipped at runtime. Including
    // `JSON.stringify(experimental)` makes the key self-maintaining.
    const experimental = JSON.stringify(input.cfg.experimental ?? {})
    return [
      input.agent?.name ?? "",
      input.model.providerID,
      input.model.modelID,
      Flag.AX_CODE_CLIENT,
      Flag.AX_CODE_ENABLE_QUESTION_TOOL,
      Flag.AX_CODE_ENABLE_EXA,
      Flag.AX_CODE_EXPERIMENTAL_LSP_TOOL,
      Flag.AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE,
      Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      Flag.AX_CODE_EXPERIMENTAL_PLAN_MODE,
      experimental,
    ].join(":")
  }

  async function all(custom: Tool.Info[], cfg?: ToolConfig): Promise<Tool.Info[]> {
    cfg ??= await Config.get()
    const question = Flag.AX_CODE_CLIENT === "cli" || Flag.AX_CODE_ENABLE_QUESTION_TOOL

    return [
      InvalidTool,
      ...(question ? [QuestionTool] : []),
      BashTool,
      ReadTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      TaskTool,
      WebFetchTool,
      TodoWriteTool,
      WebSearchTool,
      CodeSearchTool,
      SkillTool,
      MemorySaveTool,
      GetGoalTool,
      CreateGoalTool,
      UpdateGoalTool,
      ApplyPatchTool,
      RegisterFindingTool,
      VerifyProjectTool,
      ReviewCompleteTool,
      DebugOpenCaseTool,
      DebugCaptureEvidenceTool,
      DebugPlanInstrumentationTool,
      DebugProposeHypothesisTool,
      DebugApplyVerificationTool,
      DebugRepairFromEnvelopeTool,
      ...(Flag.AX_CODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(Flag.AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE ? [CodeIntelligenceTool] : []),
      ...(Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE ? [...DEBUG_ENGINE_TOOLS] : []),
      ...(cfg.experimental?.batch_tool === true ? [BatchTool] : []),
      ...(Flag.AX_CODE_EXPERIMENTAL_PLAN_MODE && Flag.AX_CODE_CLIENT === "cli" ? [PlanExitTool] : []),
      ...custom,
    ]
  }

  let toolCache: { key: string; result: InitializedTool[] } | undefined

  export async function register(tool: Tool.Info): Promise<void> {
    const current = await state()
    const idx = current.custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      current.custom.splice(idx, 1, tool)
      toolCache = undefined
      return
    }
    current.custom.push(tool)
    toolCache = undefined
  }

  export async function ids(): Promise<string[]> {
    const current = await state()
    const tools = await all(current.custom)
    return tools.map((t) => t.id)
  }

  export async function tools(
    model: {
      providerID: ProviderID
      modelID: ModelID
    },
    agent?: Agent.Info,
  ): Promise<InitializedTool[]> {
    const cfg = await Config.get()
    const key = cacheKey({ model, agent, cfg })
    if (toolCache?.key === key) return toolCache.result

    const current = await state()
    const allTools = await all(current.custom, cfg)
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
            const next = await tool.init({ agent })
            const output = {
              description: next.description,
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
    const result = raw.filter((t): t is InitializedTool => t !== undefined)
    toolCache = { key, result }
    return result
  }
}
