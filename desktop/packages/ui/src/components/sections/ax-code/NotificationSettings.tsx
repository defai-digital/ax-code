import React from "react"
import { useUIStore } from "@/stores/useUIStore"
import { isDesktopShell } from "@/lib/desktop"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "@/components/ui"
import { getRegisteredRuntimeAPIs } from "@/contexts/runtimeAPIRegistry"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"

const DEFAULT_NOTIFICATION_TEMPLATES = {
  completion: {
    titleKey: "settings.notifications.page.template.defaults.completion.title",
    messageKey: "settings.notifications.page.template.defaults.completion.message",
  },
  error: {
    titleKey: "settings.notifications.page.template.defaults.error.title",
    messageKey: "settings.notifications.page.template.defaults.error.message",
  },
  question: {
    titleKey: "settings.notifications.page.template.defaults.question.title",
    messageKey: "settings.notifications.page.template.defaults.question.message",
  },
  subtask: {
    titleKey: "settings.notifications.page.template.defaults.subtask.title",
    messageKey: "settings.notifications.page.template.defaults.subtask.message",
  },
} as const
type NotificationTemplateEvent = keyof typeof DEFAULT_NOTIFICATION_TEMPLATES
const TEMPLATE_EVENT_LABEL_KEYS = {
  completion: "settings.notifications.page.template.event.completion",
  subtask: "settings.notifications.page.template.event.subtask",
  error: "settings.notifications.page.template.event.error",
  question: "settings.notifications.page.template.event.question",
} as const satisfies Record<NotificationTemplateEvent, string>

export const NotificationSettings: React.FC = () => {
  const { t } = useI18n()
  const isDesktop = React.useMemo(() => isDesktopShell(), [])
  const isBrowser = !isDesktop
  const nativeNotificationsEnabled = useUIStore((state) => state.nativeNotificationsEnabled)
  const setNativeNotificationsEnabled = useUIStore((state) => state.setNativeNotificationsEnabled)
  const notificationMode = useUIStore((state) => state.notificationMode)
  const setNotificationMode = useUIStore((state) => state.setNotificationMode)
  const notifyOnSubtasks = useUIStore((state) => state.notifyOnSubtasks)
  const setNotifyOnSubtasks = useUIStore((state) => state.setNotifyOnSubtasks)
  const notifyOnCompletion = useUIStore((state) => state.notifyOnCompletion)
  const setNotifyOnCompletion = useUIStore((state) => state.setNotifyOnCompletion)
  const notifyOnError = useUIStore((state) => state.notifyOnError)
  const setNotifyOnError = useUIStore((state) => state.setNotifyOnError)
  const notifyOnQuestion = useUIStore((state) => state.notifyOnQuestion)
  const setNotifyOnQuestion = useUIStore((state) => state.setNotifyOnQuestion)
  const notifyOnPermission = useUIStore((state) => state.notifyOnPermission)
  const setNotifyOnPermission = useUIStore((state) => state.setNotifyOnPermission)
  const notificationTemplates = useUIStore((state) => state.notificationTemplates)
  const setNotificationTemplates = useUIStore((state) => state.setNotificationTemplates)

  const [notificationPermission, setNotificationPermission] = React.useState<NotificationPermission>("default")

  React.useEffect(() => {
    if (!isBrowser) {
      return
    }

    if (typeof Notification !== "undefined") {
      setNotificationPermission(Notification.permission)
    }
  }, [isBrowser])

  const handleToggleChange = async (checked: boolean) => {
    if (isDesktop) {
      setNativeNotificationsEnabled(checked)
      return
    }

    if (!isBrowser) {
      setNativeNotificationsEnabled(checked)
      return
    }
    if (checked && typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        const permission = await Notification.requestPermission()
        setNotificationPermission(permission)
        if (permission === "granted") {
          setNativeNotificationsEnabled(true)
        } else {
          toast.error(t("settings.notifications.page.toast.permissionDenied.title"), {
            description: t("settings.notifications.page.toast.permissionDenied.description"),
          })
        }
      } catch (error) {
        console.error("Failed to request notification permission:", error)
        toast.error(t("settings.notifications.page.toast.requestPermissionFailed"))
      }
    } else if (checked && notificationPermission === "granted") {
      setNativeNotificationsEnabled(true)
    } else {
      setNativeNotificationsEnabled(false)
    }
  }

  const canShowNotifications =
    isDesktop || (isBrowser && typeof Notification !== "undefined" && Notification.permission === "granted")

  const updateTemplate = (
    event: "completion" | "error" | "question" | "subtask",
    field: "title" | "message",
    value: string,
  ) => {
    setNotificationTemplates({
      ...notificationTemplates,
      [event]: {
        ...notificationTemplates[event],
        [field]: value,
      },
    })
  }

  const handleTestNotification = async () => {
    const apis = getRegisteredRuntimeAPIs()
    if (!apis?.notifications) {
      toast.error(t("settings.notifications.page.toast.notificationsApiUnavailable"))
      return
    }

    try {
      const success = await apis.notifications.notifyAgentCompletion({
        title: t("settings.notifications.page.testNotification.title"),
        body: t("settings.notifications.page.testNotification.body"),
        tag: "openchamber-test",
      })

      if (success) {
        toast.success(t("settings.notifications.page.toast.testNotificationSent"))
      } else {
        toast.error(t("settings.notifications.page.toast.testNotificationFailed"))
      }
    } catch (error) {
      console.error("Test notification failed:", error)
      toast.error(t("settings.notifications.page.toast.testNotificationFailed"))
    }
  }

  return (
    <div className="space-y-8">
      {/* --- Global Delivery Settings --- */}
      <div className="mb-8">
        <div className="mb-1 px-1">
          <h3 className="typography-ui-header font-medium text-foreground">
            {t("settings.notifications.page.delivery.title")}
          </h3>
        </div>

        <section className="px-2 pb-2 pt-0 space-y-0.5">
          <div
            className="group flex cursor-pointer items-center gap-2 py-1.5"
            role="button"
            tabIndex={0}
            aria-pressed={nativeNotificationsEnabled && canShowNotifications}
            onClick={() => {
              void handleToggleChange(!(nativeNotificationsEnabled && canShowNotifications))
            }}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault()
                void handleToggleChange(!(nativeNotificationsEnabled && canShowNotifications))
              }
            }}
          >
            <Checkbox
              checked={nativeNotificationsEnabled && canShowNotifications}
              onChange={(checked) => {
                void handleToggleChange(checked)
              }}
              ariaLabel={t("settings.notifications.page.delivery.enableAria")}
            />
            <span className="typography-ui-label text-foreground">
              {t("settings.notifications.page.delivery.enableLabel")}
            </span>
          </div>

          {nativeNotificationsEnabled && canShowNotifications && (
            <>
              <div
                className="group flex cursor-pointer items-center gap-2 py-1.5"
                role="button"
                tabIndex={0}
                aria-pressed={notificationMode === "always"}
                onClick={() => setNotificationMode(notificationMode === "always" ? "hidden-only" : "always")}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault()
                    setNotificationMode(notificationMode === "always" ? "hidden-only" : "always")
                  }
                }}
              >
                <Checkbox
                  checked={notificationMode === "always"}
                  onChange={(checked) => setNotificationMode(checked ? "always" : "hidden-only")}
                  ariaLabel={t("settings.notifications.page.delivery.focusedAria")}
                />
                <span className="typography-ui-label text-foreground">
                  {t("settings.notifications.page.delivery.focusedLabel")}
                </span>
              </div>

              <div className="py-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void handleTestNotification()}>
                  {t("settings.notifications.page.delivery.testAction")}
                </Button>
              </div>
            </>
          )}
        </section>

        {isBrowser && (
          <div className="mt-1 px-2">
            <p className="typography-meta text-muted-foreground/70">
              {t("settings.notifications.page.delivery.browserPermissionHint")}
            </p>
            {notificationPermission === "denied" && (
              <p className="typography-meta text-[var(--status-error)] mt-1">
                {t("settings.notifications.page.delivery.permissionDenied")}
              </p>
            )}
            {notificationPermission === "granted" && !nativeNotificationsEnabled && (
              <p className="typography-meta text-muted-foreground/70 mt-1">
                {t("settings.notifications.page.delivery.permissionGrantedButDisabled")}
              </p>
            )}
          </div>
        )}
      </div>

      {nativeNotificationsEnabled && canShowNotifications && (
        <>
          {/* --- Events --- */}
          <div className="mb-8">
            <div className="mb-1 px-1">
              <h3 className="typography-ui-header font-medium text-foreground">
                {t("settings.notifications.page.events.title")}
              </h3>
            </div>

            <section className="px-2 pb-2 pt-0 space-y-0.5">
              <div
                className="group flex cursor-pointer items-center gap-2 py-1.5"
                role="button"
                tabIndex={0}
                aria-pressed={notifyOnCompletion}
                onClick={() => setNotifyOnCompletion(!notifyOnCompletion)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault()
                    setNotifyOnCompletion(!notifyOnCompletion)
                  }
                }}
              >
                <Checkbox
                  checked={notifyOnCompletion}
                  onChange={setNotifyOnCompletion}
                  ariaLabel={t("settings.notifications.page.events.completionAria")}
                />
                <span className="typography-ui-label text-foreground">
                  {t("settings.notifications.page.events.completionLabel")}
                </span>
              </div>

              <div
                className="group flex cursor-pointer items-center gap-2 py-1.5"
                role="button"
                tabIndex={0}
                aria-pressed={notifyOnSubtasks}
                onClick={() => setNotifyOnSubtasks(!notifyOnSubtasks)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault()
                    setNotifyOnSubtasks(!notifyOnSubtasks)
                  }
                }}
              >
                <Checkbox
                  checked={notifyOnSubtasks}
                  onChange={setNotifyOnSubtasks}
                  ariaLabel={t("settings.notifications.page.events.subtaskAria")}
                />
                <span className="typography-ui-label text-foreground">
                  {t("settings.notifications.page.events.subtaskLabel")}
                </span>
              </div>

              <div
                className="group flex cursor-pointer items-center gap-2 py-1.5"
                role="button"
                tabIndex={0}
                aria-pressed={notifyOnError}
                onClick={() => setNotifyOnError(!notifyOnError)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault()
                    setNotifyOnError(!notifyOnError)
                  }
                }}
              >
                <Checkbox
                  checked={notifyOnError}
                  onChange={setNotifyOnError}
                  ariaLabel={t("settings.notifications.page.events.errorAria")}
                />
                <span className="typography-ui-label text-foreground">
                  {t("settings.notifications.page.events.errorLabel")}
                </span>
              </div>

              <div
                className="group flex cursor-pointer items-center gap-2 py-1.5"
                role="button"
                tabIndex={0}
                aria-pressed={notifyOnQuestion}
                onClick={() => setNotifyOnQuestion(!notifyOnQuestion)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault()
                    setNotifyOnQuestion(!notifyOnQuestion)
                  }
                }}
              >
                <Checkbox
                  checked={notifyOnQuestion}
                  onChange={setNotifyOnQuestion}
                  ariaLabel={t("settings.notifications.page.events.questionAria")}
                />
                <span className="typography-ui-label text-foreground">
                  {t("settings.notifications.page.events.questionLabel")}
                </span>
              </div>

              <div
                className="group flex cursor-pointer items-center gap-2 py-1.5"
                role="button"
                tabIndex={0}
                aria-pressed={notifyOnPermission}
                onClick={() => setNotifyOnPermission(!notifyOnPermission)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault()
                    setNotifyOnPermission(!notifyOnPermission)
                  }
                }}
              >
                <Checkbox
                  checked={notifyOnPermission}
                  onChange={setNotifyOnPermission}
                  ariaLabel={t("settings.notifications.page.events.permissionAria")}
                />
                <span className="typography-ui-label text-foreground">
                  {t("settings.notifications.page.events.permissionLabel")}
                </span>
              </div>
            </section>
          </div>

          {/* --- Template Customization --- */}
          <div className="mb-8">
            <div className="mb-1 px-1">
              <h3 className="typography-ui-header font-medium text-foreground">
                {t("settings.notifications.page.template.title")}
              </h3>
              <p className="typography-meta text-muted-foreground mt-0.5">
                {t("settings.notifications.page.template.variablesLabel")}{" "}
                <code className="text-[var(--primary-base)]">{"{project_name}"}</code>{" "}
                <code className="text-[var(--primary-base)]">{"{worktree}"}</code>{" "}
                <code className="text-[var(--primary-base)]">{"{branch}"}</code>{" "}
                <code className="text-[var(--primary-base)]">{"{session_name}"}</code>{" "}
                <code className="text-[var(--primary-base)]">{"{agent_name}"}</code>{" "}
                <code className="text-[var(--primary-base)]">{"{model_name}"}</code>{" "}
                <code className="text-[var(--primary-base)]">{"{last_message}"}</code>
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-3">
              {(["completion", "subtask", "error", "question"] as const).map((event: NotificationTemplateEvent) => (
                <section key={event} className="p-2">
                  <span className="typography-ui-label text-foreground font-normal capitalize block">
                    {t(TEMPLATE_EVENT_LABEL_KEYS[event])}
                  </span>
                  <div className="mt-1.5 space-y-2">
                    <div>
                      <label className="typography-micro text-muted-foreground block mb-1">
                        {t("settings.notifications.page.template.field.title")}
                      </label>
                      <Input
                        value={notificationTemplates[event].title}
                        onChange={(e) => updateTemplate(event, "title", e.target.value)}
                        className="h-7"
                        placeholder={t(DEFAULT_NOTIFICATION_TEMPLATES[event].titleKey)}
                      />
                    </div>
                    <div>
                      <label className="typography-micro text-muted-foreground block mb-1">
                        {t("settings.notifications.page.template.field.message")}
                      </label>
                      <Input
                        value={notificationTemplates[event].message}
                        onChange={(e) => updateTemplate(event, "message", e.target.value)}
                        className="h-7"
                        placeholder={t(DEFAULT_NOTIFICATION_TEMPLATES[event].messageKey)}
                      />
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
