import type { Config } from "@/config/config"
import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"

export namespace ToolProfile {
  export function resolve(config: Config.Info, providerID?: string) {
    return (
      (providerID ? config.provider?.[providerID]?.options?.toolProfile : undefined) ??
      (providerID === AX_ENGINE_PROVIDER_ID ? "core" : "full")
    )
  }

  // Filter built-ins only. Custom/registered tools still use their existing
  // trust, permission and lifecycle rules. New built-ins require an explicit
  // profile decision instead of silently expanding this request budget.
  const coding = new Set([
    "invalid",
    "question",
    "bash",
    "bash_output",
    "bash_input",
    "kill_shell",
    "monitor",
    "list",
    "read",
    "glob",
    "grep",
    "edit",
    "write",
    "apply_patch",
    "notebook_edit",
    "task",
    "task_parallel",
    "waitfor",
    "list_background_tasks",
    "message_background_task",
    "webfetch",
    "websearch",
    "codesearch",
    "todowrite",
    "skill",
    "memory_save",
    "get_goal",
    "create_goal",
    "update_goal",
    "submit_goal_plan",
    "register_finding",
    "verify_project",
    "review_complete",
    "lsp",
    "batch",
    "context_status",
    "plan_exit",
  ])

  export function includesCodingTool(id: string) {
    return coding.has(id)
  }
}
