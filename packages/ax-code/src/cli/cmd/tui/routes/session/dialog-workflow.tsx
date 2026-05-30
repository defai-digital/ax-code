import { createMemo, createResource, createSignal, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog, type DialogContext } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { useSDK } from "@tui/context/sdk"
import { createAbortableResourceFetcher } from "../../util/abortable-resource"
import {
  workflowArtifactDetailItems,
  workflowArtifactIDFromDetailValue,
  workflowDashboardItems,
  workflowRunControlItems,
  workflowRunDetailItems,
  workflowTemplateSaveItems,
  type WorkflowTemplateSaveScope,
  type WorkflowRunArtifact,
  type WorkflowRunControlAction,
  type WorkflowDashboardRun,
  type WorkflowRunDetail,
} from "./workflow-dashboard"

export function DialogWorkflow() {
  const dialog = useDialog()
  const toast = useToast()
  const sdk = useSDK()
  const [refreshTick, setRefreshTick] = createSignal(0)

  onMount(() => {
    dialog.setSize("large")
  })

  const [runs] = createResource(
    refreshTick,
    createAbortableResourceFetcher<number, WorkflowDashboardRun[]>(async (_tick, signal, info) => {
      try {
        const result = await sdk.client.workflowRun.dashboard({ limit: 30 }, { signal })
        if (result.error) {
          toast.show({ message: workflowErrorMessage(result.error, "Failed to load workflow runs"), variant: "error" })
          return info.value ?? []
        }
        return result.data ?? []
      } catch (error) {
        toast.show({
          message: error instanceof Error ? error.message : "Failed to load workflow runs",
          variant: "error",
        })
        return info.value ?? []
      }
    }),
  )

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const result: DialogSelectOption<string>[] = [
      {
        title: runs.loading ? "Refreshing workflow runs" : "Refresh workflow runs",
        value: "workflow.refresh",
        description: "Reload recent project workflow runs from the server.",
        category: "Actions",
        disabled: runs.loading,
        onSelect: () => {
          setRefreshTick((tick) => tick + 1)
        },
      },
    ]

    const items = workflowDashboardItems(runs() ?? [])
    return [
      ...result,
      ...items.map((item) => ({
        ...item,
        onSelect: item.disabled
          ? undefined
          : (ctx: DialogContext) => {
              ctx.replace(() => <DialogWorkflowDetail runID={item.value} />)
            },
      })),
    ]
  })

  return <DialogSelect title="Workflow Runs" options={options()} skipFilter={false} />
}

function DialogWorkflowDetail(props: { runID: string }) {
  const dialog = useDialog()
  const toast = useToast()
  const sdk = useSDK()
  const [refreshTick, setRefreshTick] = createSignal(0)

  onMount(() => {
    dialog.setSize("large")
  })

  const [detail] = createResource(
    refreshTick,
    createAbortableResourceFetcher<number, WorkflowRunDetail | undefined>(async (_tick, signal, info) => {
      try {
        const result = await sdk.client.workflowRun.get({ runID: props.runID }, { signal })
        if (result.error) {
          toast.show({ message: workflowErrorMessage(result.error, "Failed to load workflow run"), variant: "error" })
          return info.value
        }
        return result.data
      } catch (error) {
        toast.show({
          message: error instanceof Error ? error.message : "Failed to load workflow run",
          variant: "error",
        })
        return info.value
      }
    }),
  )

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const current = detail()
    const actions: DialogSelectOption<string>[] = [
      {
        title: "Back to workflow runs",
        value: "workflow.detail.back",
        description: "Return to the project workflow run list.",
        category: "Actions",
        onSelect: (ctx) => {
          ctx.replace(() => <DialogWorkflow />)
        },
      },
      {
        title: detail.loading ? "Refreshing workflow run" : "Refresh workflow run",
        value: "workflow.detail.refresh",
        description: "Reload this workflow run detail from the server.",
        category: "Actions",
        disabled: detail.loading,
        onSelect: () => {
          setRefreshTick((tick) => tick + 1)
        },
      },
    ]

    if (!current) {
      return [
        ...actions,
        {
          title: "Workflow run unavailable",
          value: "workflow.detail.empty",
          description: "The run detail could not be loaded yet.",
          category: "Overview",
          disabled: true,
        },
      ]
    }

    const controls = workflowRunControlItems(current).map((item) => ({
      ...item,
      onSelect: () => {
        void executeWorkflowRunControl(item.action)
      },
    }))
    const templateActions = workflowTemplateSaveItems(current).map((item) => ({
      ...item,
      onSelect: () => {
        void executeWorkflowTemplateSave(item.scope)
      },
    }))

    return [
      ...actions,
      ...controls,
      ...templateActions,
      ...workflowRunDetailItems(current).map((item) => {
        const artifactID = workflowArtifactIDFromDetailValue(item.value)
        if (!artifactID) return item
        return {
          ...item,
          onSelect: (ctx: DialogContext) => {
            ctx.replace(() => <DialogWorkflowArtifact runID={props.runID} artifactID={artifactID} />)
          },
        }
      }),
    ]
  })

  async function executeWorkflowRunControl(action: WorkflowRunControlAction) {
    try {
      const result =
        action === "pause"
          ? await sdk.client.workflowRun.pause({ runID: props.runID })
          : action === "resume"
            ? await sdk.client.workflowRun.resume({ runID: props.runID })
            : action === "cancel"
              ? await sdk.client.workflowRun.cancel({ runID: props.runID })
              : await sdk.client.workflowRun.retry({ runID: props.runID })

      if (result.error) {
        toast.show({
          message: workflowErrorMessage(result.error, `Failed to ${action} workflow run`),
          variant: "error",
        })
        return
      }

      toast.show({ message: `Workflow run ${workflowControlPastTense(action)}`, variant: "success" })
      setRefreshTick((tick) => tick + 1)
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : `Failed to ${action} workflow run`,
        variant: "error",
      })
    }
  }

  async function executeWorkflowTemplateSave(scope: WorkflowTemplateSaveScope) {
    try {
      const result = await sdk.client.workflowRun.saveTemplate({ runID: props.runID, scope })
      if (result.error) {
        toast.show({
          message: workflowErrorMessage(result.error, `Failed to save ${scope} workflow template`),
          variant: "error",
        })
        return
      }

      toast.show({
        message: `Saved ${scope} workflow template candidate${result.data?.id ? ` ${result.data.id}` : ""}`,
        variant: "success",
      })
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : `Failed to save ${scope} workflow template`,
        variant: "error",
      })
    }
  }

  return <DialogSelect title="Workflow Run Detail" options={options()} skipFilter={false} />
}

function DialogWorkflowArtifact(props: { runID: string; artifactID: string }) {
  const dialog = useDialog()
  const toast = useToast()
  const sdk = useSDK()
  const [refreshTick, setRefreshTick] = createSignal(0)

  onMount(() => {
    dialog.setSize("large")
  })

  const [artifacts] = createResource(
    refreshTick,
    createAbortableResourceFetcher<number, WorkflowRunArtifact[]>(async (_tick, signal, info) => {
      try {
        const result = await sdk.client.workflowRun.artifacts(
          { runID: props.runID, includePayload: "true" },
          { signal },
        )
        if (result.error) {
          toast.show({
            message: workflowErrorMessage(result.error, "Failed to load workflow artifact"),
            variant: "error",
          })
          return info.value ?? []
        }
        return result.data ?? []
      } catch (error) {
        toast.show({
          message: error instanceof Error ? error.message : "Failed to load workflow artifact",
          variant: "error",
        })
        return info.value ?? []
      }
    }),
  )

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const artifact = artifacts()?.find((item) => item.id === props.artifactID)
    const actions: DialogSelectOption<string>[] = [
      {
        title: "Back to workflow run",
        value: "workflow.artifact.back",
        description: "Return to the workflow run detail.",
        category: "Actions",
        onSelect: (ctx) => {
          ctx.replace(() => <DialogWorkflowDetail runID={props.runID} />)
        },
      },
      {
        title: artifacts.loading ? "Refreshing workflow artifact" : "Refresh workflow artifact",
        value: "workflow.artifact.refresh",
        description: "Reload this workflow artifact with its detailed payload.",
        category: "Actions",
        disabled: artifacts.loading,
        onSelect: () => {
          setRefreshTick((tick) => tick + 1)
        },
      },
    ]

    if (!artifact) {
      return [
        ...actions,
        {
          title: "Workflow artifact unavailable",
          value: "workflow.artifact.empty",
          description: "The artifact payload could not be loaded yet.",
          category: "Overview",
          disabled: true,
        },
      ]
    }

    return [...actions, ...workflowArtifactDetailItems(artifact)]
  })

  return <DialogSelect title="Workflow Artifact" options={options()} skipFilter={false} />
}

function workflowControlPastTense(action: WorkflowRunControlAction) {
  switch (action) {
    case "pause":
      return "paused"
    case "resume":
      return "resumed"
    case "cancel":
      return "cancelled"
    case "retry":
      return "retried"
  }
}

function workflowErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error) {
    const candidate = error as { data?: { message?: string }; message?: string }
    return candidate.data?.message ?? candidate.message ?? fallback
  }
  return fallback
}
