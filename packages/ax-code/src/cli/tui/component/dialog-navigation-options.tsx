import { onMount } from "solid-js"
import { useLanguage } from "@tui/context/language"
import { useKV } from "@tui/context/kv"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"

/** Rare navigation actions stay available without occupying the session list. */
export function DialogNavigationOptions(props: { onCommand: (value: string) => void }) {
  const { t } = useLanguage()
  const kv = useKV()
  const dialog = useDialog()
  onMount(() => dialog.setSize("medium"))
  return (
    <DialogSelect
      title={t("navigation.options")}
      options={[
        { title: t("command.details"), value: "session.navigation.info" },
        { title: t("command.navigationWidth"), value: "session.navigation.width" },
        { title: t("command.clearNavigation"), value: "session.navigation.clear" },
        ...(kv.get("navigation_cleared_at", 0) ? [{ title: t("navigation.showHidden"), value: "restore" }] : []),
        {
          title: kv.get("navigation_visible", true) ? t("command.hideNavigation") : t("command.showNavigation"),
          value: "session.navigation",
        },
      ]}
      onSelect={(option) => {
        dialog.clear()
        if (option.value === "restore") kv.set("navigation_cleared_at", 0)
        else props.onCommand(option.value)
      }}
    />
  )
}
