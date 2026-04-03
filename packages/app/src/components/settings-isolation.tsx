import { Component, createMemo, Show } from "solid-js"
import { Select } from "@ax-code/ui/select"
import { Switch } from "@ax-code/ui/switch"
import { showToast } from "@ax-code/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { SettingsList } from "./settings-list"
import type { IsolationMode, IsolationConfig } from "@ax-code/sdk/v2/client"

interface SettingsRowProps {
  title: string
  description: string
  children: any
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}

export const SettingsIsolation: Component = () => {
  const language = useLanguage()
  const sync = useGlobalSync()

  const isolation = createMemo((): IsolationConfig => sync.data.config.isolation ?? {})
  const mode = createMemo((): IsolationMode => isolation().mode ?? "workspace-write")
  const network = createMemo((): boolean => mode() === "full-access" ? true : (isolation().network ?? false))

  const modeOptions = createMemo(() => [
    {
      value: "read-only" as IsolationMode,
      label: language.t("settings.isolation.row.mode.readonly"),
      description: language.t("settings.isolation.row.mode.readonly.description"),
    },
    {
      value: "workspace-write" as IsolationMode,
      label: language.t("settings.isolation.row.mode.workspace"),
      description: language.t("settings.isolation.row.mode.workspace.description"),
    },
    {
      value: "full-access" as IsolationMode,
      label: language.t("settings.isolation.row.mode.fullaccess"),
      description: language.t("settings.isolation.row.mode.fullaccess.description"),
    },
  ])

  const updateIsolation = async (patch: Partial<IsolationConfig>) => {
    const current = isolation()
    await sync.updateConfig({ isolation: { ...current, ...patch } })
  }

  const setMode = async (value: IsolationMode) => {
    await updateIsolation({ mode: value })
    const descriptions: Record<IsolationMode, string> = {
      "read-only": language.t("toast.isolation.mode.readonly"),
      "workspace-write": language.t("toast.isolation.mode.workspace"),
      "full-access": language.t("toast.isolation.mode.fullaccess"),
    }
    showToast({
      title: language.t("toast.isolation.mode.title", { mode: value }),
      description: descriptions[value],
    })
  }

  const toggleNetwork = async () => {
    const next = !network()
    await updateIsolation({ network: next })
    showToast({
      title: next
        ? language.t("toast.isolation.network.on.title")
        : language.t("toast.isolation.network.off.title"),
      description: next
        ? language.t("toast.isolation.network.on.description")
        : language.t("toast.isolation.network.off.description"),
    })
  }

  return (
    <div class="flex flex-col gap-6 p-6">
      <div class="flex flex-col gap-1">
        <h3 class="text-14-medium text-text-strong pb-2">
          {language.t("settings.isolation.section.sandbox")}
        </h3>
        <SettingsList>
          <SettingsRow
            title={language.t("settings.isolation.row.mode.title")}
            description={language.t("settings.isolation.row.mode.description")}
          >
            <Select
              options={modeOptions()}
              current={modeOptions().find((o) => o.value === mode())}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(option) => option && setMode(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
              triggerStyle={{ "min-width": "180px" }}
            />
          </SettingsRow>

          <Show when={mode() === "full-access"}>
            <div class="px-3 py-2 text-12-regular text-text-warning bg-surface-warning/10 rounded">
              {language.t("settings.isolation.row.mode.fullaccess.warning")}
            </div>
          </Show>

          <SettingsRow
            title={language.t("settings.isolation.row.network.title")}
            description={language.t("settings.isolation.row.network.description")}
          >
            <Switch
              checked={network()}
              onChange={toggleNetwork}
              disabled={mode() === "full-access"}
            />
          </SettingsRow>
        </SettingsList>
      </div>

      <Show when={mode() !== "full-access"}>
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">
            {language.t("settings.isolation.section.protected")}
          </h3>
          <p class="text-12-regular text-text-weak pb-2">
            {language.t("settings.isolation.row.protected.description")}
          </p>
          <SettingsList>
            <div class="flex flex-col gap-1 py-2">
              <span class="text-12-mono text-text-weak">.git</span>
              <span class="text-12-mono text-text-weak">.ax-code</span>
              {(isolation().protected ?? []).map((p) => (
                <span class="text-12-mono text-text-weak">{p}</span>
              ))}
            </div>
          </SettingsList>
        </div>
      </Show>
    </div>
  )
}
