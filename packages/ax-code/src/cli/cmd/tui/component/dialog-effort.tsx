import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { effortChangeMessage, effortOptions } from "@/provider/effort-label"

export function DialogEffort() {
  const local = useLocal()
  const dialog = useDialog()
  const toast = useToast()

  const options = createMemo(() => {
    const keys = local.model.variant.list()
    return effortOptions(keys).map((option) => ({
      value: option.value ?? "",
      title: option.label,
      description: option.detail ? `${option.description} · ${option.detail}` : option.description,
      onSelect() {
        const next = option.value
        local.model.variant.set(next)
        dialog.clear()
        toast.show({
          message: effortChangeMessage(next),
          variant: "info",
          duration: 1500,
        })
      },
    }))
  })

  const current = createMemo(() => local.model.variant.current() ?? "")

  const title = createMemo(() => {
    const model = local.model.parsed().model
    return model ? `Effort · ${model}` : "Effort"
  })

  return (
    <DialogSelect
      title={title()}
      options={options()}
      current={current()}
      flat={true}
    />
  )
}
