import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { Agent } from "@/agent/agent"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      const tier = Agent.resolveTier(item)
      return {
        value: item.name,
        title: local.agent.icon(item.name) + " " + (item.displayName ?? item.name),
        description: item.description,
        category: tier === "core" ? "" : "Specialist",
      }
    }),
  )

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      options={options()}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
