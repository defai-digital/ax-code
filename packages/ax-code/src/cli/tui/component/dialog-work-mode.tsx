import { useLanguage } from "@tui/context/language"
import { createMemo, onMount } from "solid-js"
import { useKV } from "@tui/context/kv"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { WorkMode } from "@/mode/work-mode"
import { workModeAvailability, workModeCycleToast, workModePickerOptions } from "./work-mode-availability"

export function DialogWorkMode() {
  const uiText = useLanguage().t

  const kv = useKV()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  onMount(() => dialog.setSize("medium"))
  const current = WorkMode.parse(kv.get("work_mode", WorkMode.DEFAULT))
  const options = createMemo(() =>
    workModePickerOptions({
      t: uiText,
      providers: sync.data.provider,
      providerLoaded: sync.data.provider_loaded,
      config: sync.data.config?.modes,
    }),
  )
  return (
    <DialogSelect
      title={uiText("ui.workMode")}
      placeholder={uiText("ui.councilAndArenaStayOffTheFooterUntilYouPickThemHere")}
      current={current}
      options={options().map((option) => ({
        title: option.title,
        value: option.value,
        description: option.description,
        disabled: option.disabled,
      }))}
      onSelect={(option) => {
        if (option.disabled) return
        const mode = WorkMode.parse(option.value)
        kv.set("work_mode", mode)
        toast.show({
          message: workModeCycleToast(
            mode,
            workModeAvailability({
              t: uiText,
              mode,
              providers: sync.data.provider,
              providerLoaded: sync.data.provider_loaded,
              config: sync.data.config?.modes,
            }),
            [],
            uiText,
          ),
          variant: "info",
          duration: 3500,
        })
        dialog.clear()
      }}
    />
  )
}
