import { createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { replyError } from "@tui/util/error-message"
import {
  WEBMCP_ALLOWLIST_ARM_MS,
  WEBMCP_ALLOWLIST_FOOTER_HINT,
  WEBMCP_ALLOWLIST_PLACEHOLDER,
  webMcpAllowlistActionKey,
  webMcpAllowlistDialogOptions,
  type WebMcpAllowlistAction,
} from "./webmcp-allowlist-dialog-model"

/**
 * Project-scoped WebMCP allowlist for one bridge (ADR-175, ADR-178). Saved
 * rows revoke on a second activation: the first click or Enter arms the row
 * and its description says so; another activation within the arm window
 * revokes, while moving to another row, typing, or the window expiring
 * disarms it. The search box doubles as the add box: a typed https origin
 * (or http loopback) offers one grant row per origin capability that is not
 * saved yet, and page listing is offered until it is saved. The picker's own
 * fuzzy filter is off so the add rows survive the query. Escape first clears
 * a query, then closes; the dialog host also closes on a click outside the
 * panel. Long lists scroll inside the picker with its scrollbar.
 */
export function DialogWebMcpAllowlist(props: { server: string }) {
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()
  const [busy, setBusy] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [armed, setArmed] = createSignal<string | undefined>()
  let armTimer: ReturnType<typeof setTimeout> | undefined
  function disarm() {
    if (armTimer !== undefined) clearTimeout(armTimer)
    armTimer = undefined
    setArmed(undefined)
  }
  function arm(key: string) {
    disarm()
    setArmed(key)
    armTimer = setTimeout(disarm, WEBMCP_ALLOWLIST_ARM_MS)
  }
  onCleanup(disarm)
  // Origins are long: the wide frame keeps the title and the confirmation
  // description on one row instead of clipping the hint.
  onMount(() => dialog.setSize("large"))

  const [records, { refetch }] = createResource(async () => {
    const result = await sdk.client.mcp.webMcpApprovals({ name: props.server })
    if (result.error) throw replyError(result.error, "Could not load WebMCP approvals")
    return result.data ?? []
  })
  const options = createMemo(() =>
    webMcpAllowlistDialogOptions({
      records: records.error ? undefined : records(),
      query: query(),
      loading: records.loading,
      failed: !!records.error,
      armed: armed(),
    }),
  )

  async function run(action: () => Promise<{ error?: unknown }>, failure: string, success: string) {
    if (busy()) return
    setBusy(true)
    try {
      const result = await action()
      if (result.error) throw replyError(result.error, failure)
      await refetch()
      toast.show({ message: success, variant: "success" })
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : failure, variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogSelect<WebMcpAllowlistAction>
      title={`Manage WebMCP allowlist — ${props.server}`}
      placeholder={WEBMCP_ALLOWLIST_PLACEHOLDER}
      hint={WEBMCP_ALLOWLIST_FOOTER_HINT}
      skipFilter
      options={options()}
      onFilter={(value) => {
        disarm()
        setQuery(value)
      }}
      onMove={(option) => {
        // Hovering or arrowing to a different row withdraws the pending
        // confirmation, so the second activation always targets the row
        // the user armed.
        const current = armed()
        if (current !== undefined && webMcpAllowlistActionKey(option.value) !== current) disarm()
      }}
      onSelect={async (option) => {
        const action = option.value
        if (action.kind === "retry") {
          void refetch()
          return
        }
        if (action.kind === "none") return
        if (action.kind === "grant") {
          disarm()
          await run(
            () => sdk.client.mcp.grantWebMcpApproval({ name: props.server, scope: action.scope }),
            "Could not save WebMCP approval",
            "WebMCP approval saved",
          )
          return
        }
        const key = webMcpAllowlistActionKey(action)
        if (key === undefined) return
        if (armed() !== key) {
          arm(key)
          return
        }
        disarm()
        await run(
          () =>
            sdk.client.mcp.revokeWebMcpApproval({
              name: props.server,
              ...(action.kind === "clear" ? {} : { id: action.id }),
            }),
          "Could not revoke WebMCP approval",
          "WebMCP approval revoked",
        )
      }}
    />
  )
}

/**
 * Entry point for the footer link and the `/webmcp-allowlist` command: one
 * configured bridge opens its allowlist directly, several offer a bridge
 * picker first.
 */
export function DialogWebMcpAllowlistEntry(props: { servers: string[] }) {
  const dialog = useDialog()
  const servers = props.servers
  const only = servers.length === 1 ? servers[0] : undefined
  if (only !== undefined) return <DialogWebMcpAllowlist server={only} />
  return (
    <DialogSelect<string>
      title="Manage WebMCP allowlist"
      options={
        servers.length === 0
          ? [{ title: "No WebMCP bridge is configured", value: "", disabled: true }]
          : servers.map((name) => ({ title: name, value: name, description: "select to open" }))
      }
      onSelect={(option) => {
        if (!option.value) return
        dialog.replace(() => <DialogWebMcpAllowlist server={option.value} />)
      }}
    />
  )
}
