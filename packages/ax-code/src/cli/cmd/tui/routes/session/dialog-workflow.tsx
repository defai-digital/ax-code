import { createMemo, createResource, createSignal, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog, type DialogContext } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { useSDK } from "@tui/context/sdk"
import { createAbortableResourceFetcher } from "../../util/abortable-resource"
import {
  workflowDashboardItems,
  workflowRunDetailItems,
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

    return [...actions, ...workflowRunDetailItems(current)]
  })

  return <DialogSelect title="Workflow Run Detail" options={options()} skipFilter={false} />
}

function workflowErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error) {
    const candidate = error as { data?: { message?: string }; message?: string }
    return candidate.data?.message ?? candidate.message ?? fallback
  }
  return fallback
}
