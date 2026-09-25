import { useTerminalDimensions } from "ax-tui/solid"
import { onMount, Show } from "solid-js"
import { useLanguage } from "../context/language"
import { useKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { LANGUAGE_LABELS, LOCALES } from "../i18n"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import type { SetupGuidance } from "./setup-guidance"

export function SetupWizard(props: { guidance: SetupGuidance; onLanguages: () => void; onConnect: () => void }) {
  const dimensions = useTerminalDimensions()
  const language = useLanguage()
  const { t } = language
  const kv = useKV()
  const dialog = useDialog()
  const { theme } = useTheme()
  onMount(() => kv.set("setup_seen_v1", true))
  const ready = () => props.guidance.state === "selected"
  return (
    <>
      <Show when={!kv.get("setup_language_done_v1", false)}>
        {(_ready) => (
          <DialogSelect
            title={t("setup.languages")}
            options={[
              ...LOCALES.map((value) => ({ title: LANGUAGE_LABELS[value], value })),
              { title: t("setup.skip"), value: "skip" },
            ]}
            onSelect={({ value }) => {
              if (value === "skip") {
                dialog.clear()
                return
              }
              language.setLocale(value as (typeof LOCALES)[number])
              kv.set("setup_language_done_v1", true)
            }}
          />
        )}
      </Show>
      <Show when={kv.get("setup_language_done_v1", false)}>
        {(_ready) => (
          <box flexDirection="column">
            <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
              <text fg={theme.textMuted} wrapMode="word" flexShrink={0}>
                {ready() ? t("setup.readyHint") : props.guidance.message}
              </text>
              <text fg={theme.textMuted} wrapMode="word" flexShrink={0}>
                {t("setup.resume")}
              </text>
              <Show when={ready() && dimensions().height >= 24}>
                <text fg={theme.text} wrapMode="word">
                  {t("setup.firstTask")}
                </text>
              </Show>
            </box>
            <DialogSelect
              title={t("setup.title")}
              options={[
                {
                  title: t("setup.changeLanguage"),
                  value: "language",
                  description: LANGUAGE_LABELS[language.locale()],
                },
                ...(ready()
                  ? [{ title: t("setup.ready"), value: "done" }]
                  : [
                      {
                        title: t(
                          props.guidance.state === "connect"
                            ? "setup.provider"
                            : props.guidance.state === "model"
                              ? "setup.chooseModel"
                              : "setup.status",
                        ),
                        value: "connect",
                        disabled: props.guidance.state === "loading",
                      },
                    ]),
                { title: t("setup.skip"), value: "skip" },
              ]}
              onSelect={({ value }) => {
                if (value === "language") {
                  props.onLanguages()
                  return
                }
                if (value === "connect") {
                  kv.set("setup_resume_v1", true)
                  props.onConnect()
                  return
                }
                kv.set("setup_resume_v1", false)
                dialog.clear()
              }}
            />
          </box>
        )}
      </Show>
    </>
  )
}
