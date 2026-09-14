import { useTheme } from "../context/theme"
import { useLanguage } from "../context/language"
import { LANGUAGE_LABELS, LOCALES, type ConversationLanguage } from "../i18n"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"

export function DialogLanguage(props: { onDone?: () => void } = {}) {
  const language = useLanguage()
  const { theme } = useTheme()
  const dialog = useDialog()
  const back = () => dialog.replace(() => <DialogLanguage {...props} />)
  return (
    <box flexDirection="column">
      <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <text fg={theme.textMuted} wrapMode="word">
          {language.t("language.interface")}: {LANGUAGE_LABELS[language.locale()]}
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          {language.t("language.conversation")}:{" "}
          {language.conversation() === "auto"
            ? language.t("language.auto")
            : LANGUAGE_LABELS[language.conversation() as keyof typeof LANGUAGE_LABELS]}
        </text>
      </box>
      <DialogSelect
        title={language.t("language.title")}
        options={[
          {
            title: language.t("language.interface"),
            value: "interface",
            description: LANGUAGE_LABELS[language.locale()],
          },
          {
            title: language.t("language.conversation"),
            value: "conversation",
            description:
              language.conversation() === "auto"
                ? language.t("language.auto")
                : LANGUAGE_LABELS[language.conversation() as keyof typeof LANGUAGE_LABELS],
          },
          { title: language.t("common.confirm"), value: "done" },
        ]}
        onSelect={(option) => {
          if (option.value === "done") {
            if (props.onDone) props.onDone()
            else dialog.clear()
            return
          }
          const conversation = option.value === "conversation"
          dialog.replace(() => (
            <DialogSelect<ConversationLanguage>
              title={language.t(conversation ? "language.conversation" : "language.interface")}
              current={conversation ? language.conversation() : language.locale()}
              options={[
                ...(conversation ? [{ title: language.t("language.auto"), value: "auto" as const }] : []),
                ...LOCALES.map((value) => ({ title: LANGUAGE_LABELS[value], value })),
              ]}
              onSelect={({ value }) => {
                if (conversation) language.setConversation(value)
                else if (value !== "auto") language.setLocale(value)
                back()
              }}
            />
          ))
        }}
      />
    </box>
  )
}
