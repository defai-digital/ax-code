import { Component, Show, createMemo } from "solid-js"
import { useDialog } from "@ax-code/ui/context/dialog"
import { isOfflineProvider, useProviders } from "@/hooks/use-providers"
import { Dialog } from "@ax-code/ui/dialog"
import { List } from "@ax-code/ui/list"
import { Tag } from "@ax-code/ui/tag"
import { ProviderIcon } from "@ax-code/ui/provider-icon"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { useLanguage } from "@/context/language"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { useGlobalSync } from "@/context/global-sync"

const CUSTOM_ID = "_custom"

export const DialogSelectProvider: Component = () => {
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()
  const sync = useGlobalSync()
  const connectedSet = createMemo(() => new Set(sync.data.provider.connected))

  const onlineGroup = () => language.t("dialog.provider.group.popular")
  const offlineGroup = () => language.t("dialog.provider.group.other")
  const customLabel = () => language.t("settings.providers.tag.custom")
  const note = (id: string) => {
    if (id === "anthropic") return language.t("dialog.provider.anthropic.note")
    if (id.startsWith("github-copilot")) return language.t("dialog.provider.copilot.note")
  }

  return (
    <Dialog title={language.t("command.provider.connect")} transition>
      <List
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="plus-small"
        key={(x) => x?.id}
        items={() => {
          language.locale()
          return [{ id: CUSTOM_ID, name: customLabel() }, ...providers.all()]
        }}
        filterKeys={["id", "name"]}
        groupBy={(x) => (isOfflineProvider(x.id) ? offlineGroup() : onlineGroup())}
        sortBy={(a, b) => {
          if (a.id === CUSTOM_ID) return -1
          if (b.id === CUSTOM_ID) return 1
          return a.name.localeCompare(b.name)
        }}
        sortGroupsBy={(a, b) => {
          const offline = offlineGroup()
          if (a.category === offline && b.category !== offline) return -1
          if (b.category === offline && a.category !== offline) return 1
          return 0
        }}
        onSelect={(x) => {
          if (!x) return
          if (x.id === CUSTOM_ID) {
            dialog.show(() => <DialogCustomProvider back="providers" />)
            return
          }
          dialog.show(() => <DialogConnectProvider provider={x.id} />)
        }}
      >
        {(i) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
            <span>{i.name}</span>
            <Show when={i.id === CUSTOM_ID}>
              <Tag>{language.t("settings.providers.tag.custom")}</Tag>
            </Show>
            <Show when={connectedSet().has(i.id)}>
              <Tag variant="success">Connected</Tag>
            </Show>
            <Show when={note(i.id)}>{(value) => <div class="text-14-regular text-text-weak">{value()}</div>}</Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
