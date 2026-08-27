import React from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n"
import type { CustomApiProviderInput, CustomApiProviderView } from "@/lib/ax-code/providerApi"
import {
  buildCustomApiProviderSubmission,
  createCustomApiProviderDraft,
  customApiProviderNeedsInsecureHttp,
  findCustomApiProviderByBaseURL,
  identityFromCustomApiBaseURL,
  newCustomApiProviderModelDraft,
  refreshCustomApiProviderInput,
  type CustomApiProviderDraft,
  type CustomApiProviderModelDraft,
} from "./customApiProviderFormModel"

type CustomApiProviderFormProps = {
  existing?: CustomApiProviderView
  /** Managed providers already registered; a matching endpoint is updated instead of duplicated. */
  providers?: readonly CustomApiProviderView[]
  busy?: boolean
  onSave: (providerID: string, input: CustomApiProviderInput) => Promise<void>
}

function needsInsecureConfirmation(value: string) {
  try {
    return customApiProviderNeedsInsecureHttp(value)
  } catch {
    return false
  }
}

export const CustomApiProviderForm: React.FC<CustomApiProviderFormProps> = ({
  existing,
  providers = [],
  busy = false,
  onSave,
}) => {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState<CustomApiProviderDraft>(() => createCustomApiProviderDraft(existing))
  const [providerIDTouched, setProviderIDTouched] = React.useState(Boolean(existing))
  const [nameTouched, setNameTouched] = React.useState(Boolean(existing))
  const [error, setError] = React.useState<string | null>(null)
  // In add mode, an endpoint that is already registered is updated in place.
  const registered = existing ? undefined : findCustomApiProviderByBaseURL(providers, draft.baseURL)

  const updateDraft = <K extends keyof CustomApiProviderDraft>(key: K, value: CustomApiProviderDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const updateModel = <K extends keyof CustomApiProviderModelDraft>(
    rowID: string,
    key: K,
    value: CustomApiProviderModelDraft[K],
  ) =>
    setDraft((current) => ({
      ...current,
      models: current.models.map((model) => (model.rowID === rowID ? { ...model, [key]: value } : model)),
    }))
  const removeModel = (rowID: string) =>
    setDraft((current) => ({ ...current, models: current.models.filter((model) => model.rowID !== rowID) }))
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      if (!existing && !registered?.hasApiKey && !draft.apiToken.trim()) {
        throw new Error("API token is required")
      }
      const submission = buildCustomApiProviderSubmission(draft)
      if (registered) {
        await onSave(registered.providerID, {
          ...submission.input,
          name: registered.name,
          protocol: registered.protocol,
        })
        return
      }
      await onSave(submission.providerID, submission.input)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.providers.custom.error.saveFailed"))
    }
  }

  const refreshModels = async () => {
    if (!existing) return
    setError(null)
    try {
      await onSave(existing.providerID, refreshCustomApiProviderInput(existing))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.providers.custom.error.saveFailed"))
    }
  }

  const applyBaseURL = (baseURL: string) => {
    const identity = identityFromCustomApiBaseURL(baseURL)
    setDraft((current) => ({
      ...current,
      baseURL,
      name: !existing && !nameTouched ? identity.name : current.name,
      providerID: !existing && !providerIDTouched ? identity.providerID : current.providerID,
    }))
  }

  return (
    <form className="space-y-5 py-1.5" onSubmit={submit}>
      <label className="space-y-1.5">
        <span className="typography-ui-label text-foreground">{t("settings.providers.custom.field.url")}</span>
        <Input
          value={draft.baseURL}
          onChange={(event) => applyBaseURL(event.target.value)}
          placeholder="https://api.example.com/v1"
          className="font-mono typography-micro"
          disabled={busy}
        />
        {registered && (
          <p className="typography-meta text-muted-foreground">
            {t("settings.providers.custom.hint.existingEndpoint", { name: registered.name })}
          </p>
        )}
      </label>

      <label className="space-y-1.5">
        <span className="typography-ui-label text-foreground">{t("settings.providers.custom.field.token")}</span>
        <Input
          type="password"
          value={draft.apiToken}
          onChange={(event) => updateDraft("apiToken", event.target.value)}
          placeholder={
            existing?.hasApiKey
              ? t("settings.providers.custom.field.tokenKeepPlaceholder")
              : t("settings.providers.custom.field.tokenPlaceholder")
          }
          autoComplete="off"
          className="font-mono typography-micro"
          disabled={busy}
        />
        <span className="block typography-micro text-muted-foreground">
          {t("settings.providers.custom.field.tokenHint")}
        </span>
      </label>

      {needsInsecureConfirmation(draft.baseURL) && (
        <label className="flex items-start gap-2 rounded-lg border border-[var(--status-warning)]/40 p-3">
          <Checkbox
            checked={draft.allowInsecureHttp}
            onChange={(checked) => updateDraft("allowInsecureHttp", checked)}
            disabled={busy}
            ariaLabel={t("settings.providers.custom.field.insecureAria")}
          />
          <span className="typography-meta text-muted-foreground">
            {t("settings.providers.custom.field.insecureWarning")}
          </span>
        </label>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="typography-ui-label text-foreground">{t("settings.providers.custom.field.name")}</span>
          <Input
            value={draft.name}
            onChange={(event) => {
              setNameTouched(true)
              updateDraft("name", event.target.value)
            }}
            placeholder={t("settings.providers.custom.field.namePlaceholder")}
            disabled={busy}
          />
        </label>
        <label className="space-y-1.5">
          <span className="typography-ui-label text-foreground">{t("settings.providers.custom.field.id")}</span>
          <Input
            value={draft.providerID}
            onChange={(event) => {
              setProviderIDTouched(true)
              updateDraft("providerID", event.target.value)
            }}
            placeholder={t("settings.providers.custom.field.idPlaceholder")}
            className="font-mono typography-micro"
            disabled={busy || Boolean(existing)}
          />
        </label>
      </div>

      <label className="space-y-1.5">
        <span className="typography-ui-label text-foreground">{t("settings.providers.custom.field.protocol")}</span>
        <select
          value={draft.protocol}
          onChange={(event) => updateDraft("protocol", event.target.value as CustomApiProviderDraft["protocol"])}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 typography-meta text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
          disabled={busy}
        >
          <option value="openai-compatible">{t("settings.providers.custom.protocol.openai")}</option>
          <option value="anthropic-compatible">{t("settings.providers.custom.protocol.anthropic")}</option>
        </select>
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="typography-ui-label text-foreground">{t("settings.providers.custom.models.title")}</h4>
            <p className="typography-micro text-muted-foreground">
              {t("settings.providers.custom.models.description")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="!font-normal"
            onClick={() => updateDraft("models", [...draft.models, newCustomApiProviderModelDraft()])}
            disabled={busy || draft.models.length >= 128}
          >
            {t("settings.providers.custom.models.add")}
          </Button>
        </div>

        <div className="space-y-3">
          {draft.models.map((model, index) => (
            <div key={model.rowID} className="space-y-3 rounded-lg border border-[var(--surface-subtle)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="typography-ui-label text-foreground">
                  {t("settings.providers.custom.models.item", { index: String(index + 1) })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)]"
                  onClick={() => removeModel(model.rowID)}
                  disabled={busy}
                >
                  {t("settings.providers.custom.models.remove")}
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="typography-micro text-muted-foreground">
                    {t("settings.providers.custom.models.id")}
                  </span>
                  <Input
                    value={model.id}
                    onChange={(event) => updateModel(model.rowID, "id", event.target.value)}
                    placeholder="model-id"
                    className="font-mono typography-micro"
                    disabled={busy}
                  />
                </label>
                <label className="space-y-1">
                  <span className="typography-micro text-muted-foreground">
                    {t("settings.providers.custom.models.name")}
                  </span>
                  <Input
                    value={model.name}
                    onChange={(event) => updateModel(model.rowID, "name", event.target.value)}
                    placeholder={t("settings.providers.custom.models.namePlaceholder")}
                    disabled={busy}
                  />
                </label>
                <label className="space-y-1">
                  <span className="typography-micro text-muted-foreground">
                    {t("settings.providers.custom.models.context")}
                  </span>
                  <Input
                    inputMode="numeric"
                    value={model.contextWindow}
                    onChange={(event) => updateModel(model.rowID, "contextWindow", event.target.value)}
                    className="font-mono typography-micro"
                    disabled={busy}
                  />
                </label>
                <label className="space-y-1">
                  <span className="typography-micro text-muted-foreground">
                    {t("settings.providers.custom.models.output")}
                  </span>
                  <Input
                    inputMode="numeric"
                    value={model.outputLimit}
                    onChange={(event) => updateModel(model.rowID, "outputLimit", event.target.value)}
                    className="font-mono typography-micro"
                    disabled={busy}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {(
                  [
                    ["toolCall", "settings.providers.custom.models.capability.tools"],
                    ["reasoning", "settings.providers.custom.models.capability.reasoning"],
                    ["attachment", "settings.providers.custom.models.capability.attachments"],
                    ["temperature", "settings.providers.custom.models.capability.temperature"],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="flex items-center gap-2 typography-meta text-muted-foreground">
                    <Checkbox
                      checked={model[field]}
                      onChange={(checked) => updateModel(model.rowID, field, checked)}
                      disabled={busy}
                      ariaLabel={t(label)}
                    />
                    {t(label)}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="typography-meta text-[var(--status-error)]">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {existing?.hasApiKey && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="!font-normal"
            onClick={() => void refreshModels()}
            disabled={busy}
          >
            {t("settings.providers.custom.actions.refresh")}
          </Button>
        )}
        <Button type="submit" size="xs" className="!font-normal" disabled={busy}>
          {busy
            ? t("settings.providers.page.actions.saving")
            : existing
              ? t("settings.providers.custom.actions.update")
              : t("settings.providers.custom.actions.create")}
        </Button>
      </div>
    </form>
  )
}
