import { createMemo, createResource, createSignal } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { replyError } from "@tui/util/error-message"

export function DialogWebMcpAllowlist(props: { server: string }) {
  const sdk = useSDK()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  const [records, { refetch }] = createResource(async () => {
    const result = await sdk.client.mcp.webMcpApprovals({ name: props.server })
    if (result.error) throw replyError(result.error, "Could not load WebMCP approvals")
    return result.data ?? []
  })
  const options = createMemo(() => {
    if (records.error) return [{ value: "retry", title: "Could not load approvals — select to retry" }]
    const rows = (records() ?? []).map((record) => ({
      value: record.id,
      title:
        record.scope.capability === "list_pages"
          ? "List all browser pages"
          : `${record.scope.capability}: ${record.scope.origin}`,
      description: "This project • select to revoke",
    }))
    return rows.length > 0
      ? [
          ...rows,
          { value: "clear", title: "Revoke all saved approvals for this bridge", description: "This project only" },
        ]
      : [{ value: "empty", title: records.loading ? "Loading approvals..." : "No saved approvals", disabled: true }]
  })
  return (
    <DialogSelect
      title={`Manage WebMCP allowlist — ${props.server}`}
      options={options()}
      onSelect={async (option) => {
        if (option.value === "retry") {
          void refetch()
          return
        }
        if (busy() || option.value === "empty") return
        setBusy(true)
        try {
          const result = await sdk.client.mcp.revokeWebMcpApproval({
            name: props.server,
            ...(option.value === "clear" ? {} : { id: option.value }),
          })
          if (result.error) throw replyError(result.error, "Could not revoke WebMCP approval")
          await refetch()
          toast.show({ message: "WebMCP approval revoked", variant: "success" })
        } catch (error) {
          toast.show({
            message: error instanceof Error ? error.message : "Could not revoke WebMCP approval",
            variant: "error",
          })
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}
