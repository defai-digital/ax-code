import { onMount } from "solid-js"
import { useKV } from "@tui/context/kv"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { CHROME_WIDTHS, chromeWidth } from "../chrome-width"

function DialogChromeWidth(props: { title: string; kvKey: string }) {
  const kv = useKV()
  const dialog = useDialog()
  onMount(() => dialog.setSize("medium"))
  return (
    <DialogSelect
      title={props.title}
      placeholder="Width shrinks automatically to preserve the main content"
      current={chromeWidth(kv.get(props.kvKey))}
      options={CHROME_WIDTHS.map((value) => ({ title: `${value} columns`, value }))}
      onSelect={(option) => {
        kv.set(props.kvKey, chromeWidth(option.value))
        dialog.clear()
      }}
    />
  )
}

export function DialogNavigationWidth() {
  return DialogChromeWidth({ title: "Navigation width", kvKey: "navigation_width" })
}

export function DialogSidebarWidth() {
  return DialogChromeWidth({ title: "Sidebar width", kvKey: "sidebar_width" })
}
