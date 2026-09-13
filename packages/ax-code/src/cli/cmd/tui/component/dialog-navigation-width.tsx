import { onMount } from "solid-js"
import { useKV } from "@tui/context/kv"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { NAVIGATION_WIDTHS, navigationWidth } from "../navigation/navigation-layout"

export function DialogNavigationWidth() {
  const kv = useKV()
  const dialog = useDialog()
  onMount(() => dialog.setSize("medium"))
  return (
    <DialogSelect
      title="Navigation width"
      placeholder="Width shrinks automatically to preserve the main content"
      current={navigationWidth(kv.get("navigation_width"))}
      options={NAVIGATION_WIDTHS.map((value) => ({ title: `${value} columns`, value }))}
      onSelect={(option) => {
        kv.set("navigation_width", navigationWidth(option.value))
        dialog.clear()
      }}
    />
  )
}
