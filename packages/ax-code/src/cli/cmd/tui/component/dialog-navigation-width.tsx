import { onMount } from "solid-js"
import { useKV } from "@tui/context/kv"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import {
  CHROME_WIDTHS,
  NAVIGATION_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_DEFAULT,
  chromeWidth,
  type ChromeWidth,
} from "../chrome-width"

function DialogChromeWidth(props: { title: string; kvKey: string; fallback: ChromeWidth }) {
  const kv = useKV()
  const dialog = useDialog()
  onMount(() => dialog.setSize("medium"))
  return (
    <DialogSelect
      title={props.title}
      placeholder="Width shrinks automatically to preserve the main content"
      current={chromeWidth(kv.get(props.kvKey), props.fallback)}
      options={CHROME_WIDTHS.map((value) => ({ title: `${value} columns`, value }))}
      onSelect={(option) => {
        kv.set(props.kvKey, chromeWidth(option.value, props.fallback))
        dialog.clear()
      }}
    />
  )
}

export function DialogNavigationWidth() {
  return DialogChromeWidth({
    title: "Navigation width",
    kvKey: "navigation_width",
    fallback: NAVIGATION_WIDTH_DEFAULT,
  })
}

export function DialogSidebarWidth() {
  return DialogChromeWidth({
    title: "Sidebar width",
    kvKey: "sidebar_width",
    fallback: SIDEBAR_WIDTH_DEFAULT,
  })
}
