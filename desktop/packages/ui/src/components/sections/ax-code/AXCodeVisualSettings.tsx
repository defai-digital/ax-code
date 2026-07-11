import React from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useThemeSystem } from "@/contexts/useThemeSystem"
import type { ThemeMode } from "@/types/theme"
import { useUIStore } from "@/stores/useUIStore"
import { useMessageQueueStore } from "@/stores/messageQueueStore"
import { cn, getModifierLabel } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { NumberInput } from "@/components/ui/number-input"
import { Radio } from "@/components/ui/radio"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Icon } from "@/components/icon/Icon"
import { useDeviceInfo } from "@/lib/device"
import { updateDesktopSettings } from "@/lib/persistence"
import {
  CODE_FONT_OPTIONS,
  DEFAULT_MONO_FONT,
  DEFAULT_UI_FONT,
  UI_FONT_OPTIONS,
  type MonoFontOption,
  type UiFontOption,
} from "@/lib/fontOptions"
import { useI18n } from "@/lib/i18n"
import { useConfigStore } from "@/stores/useConfigStore"
import { setDirectoryShowHidden, useDirectoryShowHidden } from "@/lib/directoryShowHidden"
import { toast } from "@/components/ui"

interface Option<T extends string> {
  id: T
  labelKey: string
  descriptionKey?: string
}

const THEME_MODE_OPTIONS: Array<{ value: ThemeMode; labelKey: string }> = [
  {
    value: "system",
    labelKey: "settings.openchamber.visual.option.themeMode.system",
  },
  {
    value: "light",
    labelKey: "settings.openchamber.visual.option.themeMode.light",
  },
  {
    value: "dark",
    labelKey: "settings.openchamber.visual.option.themeMode.dark",
  },
]

const DIFF_LAYOUT_OPTIONS: Option<"dynamic" | "inline" | "side-by-side">[] = [
  {
    id: "dynamic",
    labelKey: "settings.openchamber.visual.option.diffLayout.dynamic.label",
    descriptionKey: "settings.openchamber.visual.option.diffLayout.dynamic.description",
  },
  {
    id: "inline",
    labelKey: "settings.openchamber.visual.option.diffLayout.inline.label",
    descriptionKey: "settings.openchamber.visual.option.diffLayout.inline.description",
  },
  {
    id: "side-by-side",
    labelKey: "settings.openchamber.visual.option.diffLayout.sideBySide.label",
    descriptionKey: "settings.openchamber.visual.option.diffLayout.sideBySide.description",
  },
]

const DIFF_VIEW_MODE_OPTIONS: Option<"single" | "stacked">[] = [
  {
    id: "single",
    labelKey: "settings.openchamber.visual.option.diffViewMode.single.label",
    descriptionKey: "settings.openchamber.visual.option.diffViewMode.single.description",
  },
  {
    id: "stacked",
    labelKey: "settings.openchamber.visual.option.diffViewMode.stacked.label",
    descriptionKey: "settings.openchamber.visual.option.diffViewMode.stacked.description",
  },
]

const MERMAID_RENDERING_OPTIONS: Option<"svg" | "ascii">[] = [
  {
    id: "svg",
    labelKey: "settings.openchamber.visual.option.mermaidRendering.svg.label",
    descriptionKey: "settings.openchamber.visual.option.mermaidRendering.svg.description",
  },
  {
    id: "ascii",
    labelKey: "settings.openchamber.visual.option.mermaidRendering.ascii.label",
    descriptionKey: "settings.openchamber.visual.option.mermaidRendering.ascii.description",
  },
]

const USER_MESSAGE_RENDERING_OPTIONS: Option<"markdown" | "plain">[] = [
  {
    id: "markdown",
    labelKey: "settings.openchamber.visual.option.userMessageRendering.markdown.label",
    descriptionKey: "settings.openchamber.visual.option.userMessageRendering.markdown.description",
  },
  {
    id: "plain",
    labelKey: "settings.openchamber.visual.option.userMessageRendering.plain.label",
    descriptionKey: "settings.openchamber.visual.option.userMessageRendering.plain.description",
  },
]

const CHAT_RENDER_MODE_OPTIONS: Option<"sorted" | "live">[] = [
  {
    id: "sorted",
    labelKey: "settings.openchamber.visual.option.chatRenderMode.sorted.label",
    descriptionKey: "settings.openchamber.visual.option.chatRenderMode.sorted.description",
  },
  {
    id: "live",
    labelKey: "settings.openchamber.visual.option.chatRenderMode.live.label",
    descriptionKey: "settings.openchamber.visual.option.chatRenderMode.live.description",
  },
]

const MESSAGE_STREAM_TRANSPORT_OPTIONS: Option<"auto" | "ws" | "sse">[] = [
  {
    id: "auto",
    labelKey: "settings.openchamber.visual.option.messageTransport.auto.label",
    descriptionKey: "settings.openchamber.visual.option.messageTransport.auto.description",
  },
  {
    id: "ws",
    labelKey: "settings.openchamber.visual.option.messageTransport.ws.label",
    descriptionKey: "settings.openchamber.visual.option.messageTransport.ws.description",
  },
  {
    id: "sse",
    labelKey: "settings.openchamber.visual.option.messageTransport.sse.label",
    descriptionKey: "settings.openchamber.visual.option.messageTransport.sse.description",
  },
]

const ACTIVITY_RENDER_MODE_OPTIONS: Option<"collapsed" | "summary">[] = [
  {
    id: "collapsed",
    labelKey: "settings.openchamber.visual.option.activityRenderMode.collapsed.label",
    descriptionKey: "settings.openchamber.visual.option.activityRenderMode.collapsed.description",
  },
  {
    id: "summary",
    labelKey: "settings.openchamber.visual.option.activityRenderMode.summary.label",
    descriptionKey: "settings.openchamber.visual.option.activityRenderMode.summary.description",
  },
]

const TIME_FORMAT_OPTIONS: Option<"auto" | "12h" | "24h">[] = [
  {
    id: "auto",
    labelKey: "settings.openchamber.visual.option.timeFormat.auto.label",
    descriptionKey: "settings.openchamber.visual.option.timeFormat.auto.description",
  },
  {
    id: "24h",
    labelKey: "settings.openchamber.visual.option.timeFormat.24h.label",
    descriptionKey: "settings.openchamber.visual.option.timeFormat.24h.description",
  },
  {
    id: "12h",
    labelKey: "settings.openchamber.visual.option.timeFormat.12h.label",
    descriptionKey: "settings.openchamber.visual.option.timeFormat.12h.description",
  },
]

const WEEK_START_OPTIONS: Option<"auto" | "monday" | "sunday">[] = [
  {
    id: "auto",
    labelKey: "settings.openchamber.visual.option.weekStart.auto.label",
    descriptionKey: "settings.openchamber.visual.option.weekStart.auto.description",
  },
  {
    id: "monday",
    labelKey: "settings.openchamber.visual.option.weekStart.monday.label",
  },
  {
    id: "sunday",
    labelKey: "settings.openchamber.visual.option.weekStart.sunday.label",
  },
]

const normalizeUserMessageRenderingMode = (mode: unknown): "markdown" | "plain" => {
  return mode === "markdown" ? "markdown" : "plain"
}

export type VisibleSetting =
  | "theme"
  | "timeFormat"
  | "weekStart"
  | "fontSize"
  | "terminalFontSize"
  | "spacing"
  | "inputBarOffset"
  | "mermaidRendering"
  | "userMessageRendering"
  | "chatRenderMode"
  | "messageTransport"
  | "activityRenderMode"
  | "stickyUserHeader"
  | "wideChatLayout"
  | "splitAssistantMessageActions"
  | "diffLayout"
  | "dotfiles"
  | "reasoning"
  | "showToolFileIcons"
  | "expandedTools"
  | "showTurnChangedFiles"
  | "queueMode"
  | "terminalQuickKeys"
  | "persistDraft"
  | "inputSpellcheck"

interface AXCodeVisualSettingsProps {
  /** Which settings to show. If undefined, shows all. */
  visibleSettings?: VisibleSetting[]
}

export const AXCodeVisualSettings: React.FC<AXCodeVisualSettingsProps> = ({ visibleSettings }) => {
  const { t } = useI18n()
  const tUnsafe = React.useCallback((key: string) => t(key as Parameters<typeof t>[0]), [t])
  const { isMobile } = useDeviceInfo()
  const directoryShowHidden = useDirectoryShowHidden()
  const showReasoningTraces = useUIStore((state) => state.showReasoningTraces)
  const setShowReasoningTraces = useUIStore((state) => state.setShowReasoningTraces)
  const collapsibleThinkingBlocks = useUIStore((state) => state.collapsibleThinkingBlocks)
  const setCollapsibleThinkingBlocks = useUIStore((state) => state.setCollapsibleThinkingBlocks)

  const mermaidRenderingMode = useUIStore((state) => state.mermaidRenderingMode)
  const setMermaidRenderingMode = useUIStore((state) => state.setMermaidRenderingMode)
  const userMessageRenderingMode = useUIStore((state) => state.userMessageRenderingMode)
  const setUserMessageRenderingMode = useUIStore((state) => state.setUserMessageRenderingMode)
  const stickyUserHeader = useUIStore((state) => state.stickyUserHeader)
  const setStickyUserHeader = useUIStore((state) => state.setStickyUserHeader)
  const wideChatLayoutEnabled = useUIStore((state) => state.wideChatLayoutEnabled)
  const setWideChatLayoutEnabled = useUIStore((state) => state.setWideChatLayoutEnabled)
  const chatRenderMode = useUIStore((state) => state.chatRenderMode)
  const setChatRenderMode = useUIStore((state) => state.setChatRenderMode)
  const activityRenderMode = useUIStore((state) => state.activityRenderMode)
  const setActivityRenderMode = useUIStore((state) => state.setActivityRenderMode)
  const fontSize = useUIStore((state) => state.fontSize)
  const setFontSize = useUIStore((state) => state.setFontSize)
  const terminalFontSize = useUIStore((state) => state.terminalFontSize)
  const setTerminalFontSize = useUIStore((state) => state.setTerminalFontSize)
  const uiFont = useUIStore((state) => state.uiFont)
  const setUiFont = useUIStore((state) => state.setUiFont)
  const monoFont = useUIStore((state) => state.monoFont)
  const setMonoFont = useUIStore((state) => state.setMonoFont)
  const padding = useUIStore((state) => state.padding)
  const setPadding = useUIStore((state) => state.setPadding)
  const inputBarOffset = useUIStore((state) => state.inputBarOffset)
  const setInputBarOffset = useUIStore((state) => state.setInputBarOffset)
  const diffLayoutPreference = useUIStore((state) => state.diffLayoutPreference)
  const setDiffLayoutPreference = useUIStore((state) => state.setDiffLayoutPreference)
  const diffViewMode = useUIStore((state) => state.diffViewMode)
  const setDiffViewMode = useUIStore((state) => state.setDiffViewMode)
  const showTerminalQuickKeysOnDesktop = useUIStore((state) => state.showTerminalQuickKeysOnDesktop)
  const setShowTerminalQuickKeysOnDesktop = useUIStore((state) => state.setShowTerminalQuickKeysOnDesktop)
  const queueModeEnabled = useMessageQueueStore((state) => state.queueModeEnabled)
  const setQueueMode = useMessageQueueStore((state) => state.setQueueMode)
  const persistChatDraft = useUIStore((state) => state.persistChatDraft)
  const setPersistChatDraft = useUIStore((state) => state.setPersistChatDraft)
  const inputSpellcheckEnabled = useUIStore((state) => state.inputSpellcheckEnabled)
  const setInputSpellcheckEnabled = useUIStore((state) => state.setInputSpellcheckEnabled)
  const showToolFileIcons = useUIStore((state) => state.showToolFileIcons)
  const setShowToolFileIcons = useUIStore((state) => state.setShowToolFileIcons)
  const showExpandedBashTools = useUIStore((state) => state.showExpandedBashTools)
  const setShowExpandedBashTools = useUIStore((state) => state.setShowExpandedBashTools)
  const showExpandedEditTools = useUIStore((state) => state.showExpandedEditTools)
  const setShowExpandedEditTools = useUIStore((state) => state.setShowExpandedEditTools)
  const showTurnChangedFiles = useUIStore((state) => state.showTurnChangedFiles)
  const setShowTurnChangedFiles = useUIStore((state) => state.setShowTurnChangedFiles)
  const timeFormatPreference = useUIStore((state) => state.timeFormatPreference)
  const setTimeFormatPreference = useUIStore((state) => state.setTimeFormatPreference)
  const weekStartPreference = useUIStore((state) => state.weekStartPreference)
  const setWeekStartPreference = useUIStore((state) => state.setWeekStartPreference)
  const showSplitAssistantMessageActions = useUIStore((state) => state.showSplitAssistantMessageActions)
  const setShowSplitAssistantMessageActions = useUIStore((state) => state.setShowSplitAssistantMessageActions)
  const messageStreamTransport = useConfigStore((state) => state.settingsMessageStreamTransport)
  const setMessageStreamTransport = useConfigStore((state) => state.setSettingsMessageStreamTransport)
  const isSettingsDialogOpen = useUIStore((state) => state.isSettingsDialogOpen)
  const {
    themeMode,
    setThemeMode,
    availableThemes,
    customThemesLoading,
    reloadCustomThemes,
    lightThemeId,
    darkThemeId,
    setLightThemePreference,
    setDarkThemePreference,
  } = useThemeSystem()

  const [themesReloading, setThemesReloading] = React.useState(false)
  const [chatRenderPreviewTick, setChatRenderPreviewTick] = React.useState(0)
  const shouldAnimateChatPreview =
    isSettingsDialogOpen && (visibleSettings ? visibleSettings.includes("chatRenderMode") : true)

  React.useEffect(() => {
    if (!shouldAnimateChatPreview) {
      return
    }

    // Use requestAnimationFrame for smoother animation without setInterval overhead
    let rafId: number | null = null
    let lastTime = Date.now()

    const tick = () => {
      const now = Date.now()
      // Update every ~420ms
      if (now - lastTime >= 420) {
        setChatRenderPreviewTick((prev) => (prev + 1) % 24)
        lastTime = now
      }
      rafId = requestAnimationFrame(tick)
    }

    // Only run when visible
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      rafId = requestAnimationFrame(tick)
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible" && rafId === null) {
        rafId = requestAnimationFrame(tick)
      } else if (document.visibilityState !== "visible" && rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [shouldAnimateChatPreview])

  const handleUserMessageRenderingModeChange = React.useCallback(
    (mode: "markdown" | "plain") => {
      setUserMessageRenderingMode(mode)
      void updateDesktopSettings({ userMessageRenderingMode: mode })
    },
    [setUserMessageRenderingMode],
  )

  const handleStickyUserHeaderChange = React.useCallback(
    (enabled: boolean) => {
      setStickyUserHeader(enabled)
      void updateDesktopSettings({ stickyUserHeader: enabled })
    },
    [setStickyUserHeader],
  )

  const handleWideChatLayoutChange = React.useCallback(
    (enabled: boolean) => {
      const previous = wideChatLayoutEnabled
      setWideChatLayoutEnabled(enabled)
      void updateDesktopSettings({ wideChatLayoutEnabled: enabled }).catch((error) => {
        console.warn("Failed to save wide chat layout setting:", error)
        if (useUIStore.getState().wideChatLayoutEnabled === enabled) {
          setWideChatLayoutEnabled(previous)
        }
        toast.error("Failed to save settings", { id: "settings-save-failed" })
      })
    },
    [setWideChatLayoutEnabled, wideChatLayoutEnabled],
  )

  const handleShowSplitAssistantMessageActionsChange = React.useCallback(
    (enabled: boolean) => {
      setShowSplitAssistantMessageActions(enabled)
      void updateDesktopSettings({ showSplitAssistantMessageActions: enabled })
    },
    [setShowSplitAssistantMessageActions],
  )

  const handleInputSpellcheckChange = React.useCallback(
    (enabled: boolean) => {
      setInputSpellcheckEnabled(enabled)
      void updateDesktopSettings({ inputSpellcheckEnabled: enabled })
    },
    [setInputSpellcheckEnabled],
  )

  const handleChatRenderModeChange = React.useCallback(
    (mode: "sorted" | "live") => {
      setChatRenderMode(mode)
      void updateDesktopSettings({ chatRenderMode: mode })
    },
    [setChatRenderMode],
  )

  const handleMessageStreamTransportChange = React.useCallback(
    (mode: "auto" | "ws" | "sse") => {
      setMessageStreamTransport(mode)
      void updateDesktopSettings({ messageStreamTransport: mode })
    },
    [setMessageStreamTransport],
  )

  const handleActivityRenderModeChange = React.useCallback(
    (mode: "collapsed" | "summary") => {
      setActivityRenderMode(mode)
      void updateDesktopSettings({ activityRenderMode: mode })
    },
    [setActivityRenderMode],
  )

  const handleMermaidRenderingModeChange = React.useCallback(
    (mode: "svg" | "ascii") => {
      setMermaidRenderingMode(mode)
      void updateDesktopSettings({ mermaidRenderingMode: mode })
    },
    [setMermaidRenderingMode],
  )

  const handleShowToolFileIconsChange = React.useCallback(
    (enabled: boolean) => {
      setShowToolFileIcons(enabled)
      void updateDesktopSettings({ showToolFileIcons: enabled })
    },
    [setShowToolFileIcons],
  )

  const handleShowExpandedBashToolsChange = React.useCallback(
    (enabled: boolean) => {
      setShowExpandedBashTools(enabled)
      void updateDesktopSettings({ showExpandedBashTools: enabled })
    },
    [setShowExpandedBashTools],
  )

  const handleShowExpandedEditToolsChange = React.useCallback(
    (enabled: boolean) => {
      setShowExpandedEditTools(enabled)
      void updateDesktopSettings({ showExpandedEditTools: enabled })
    },
    [setShowExpandedEditTools],
  )

  const handleShowTurnChangedFilesChange = React.useCallback(
    (enabled: boolean) => {
      const previous = showTurnChangedFiles
      setShowTurnChangedFiles(enabled)
      void updateDesktopSettings({ showTurnChangedFiles: enabled }).catch((error) => {
        console.warn("Failed to save changed-files setting:", error)
        if (useUIStore.getState().showTurnChangedFiles === enabled) {
          setShowTurnChangedFiles(previous)
        }
        toast.error("Failed to save settings", { id: "settings-save-failed" })
      })
    },
    [setShowTurnChangedFiles, showTurnChangedFiles],
  )

  const handleTimeFormatPreferenceChange = React.useCallback(
    (value: "auto" | "12h" | "24h") => {
      setTimeFormatPreference(value)
      void updateDesktopSettings({ timeFormatPreference: value })
    },
    [setTimeFormatPreference],
  )

  const handleWeekStartPreferenceChange = React.useCallback(
    (value: "auto" | "monday" | "sunday") => {
      setWeekStartPreference(value)
      void updateDesktopSettings({ weekStartPreference: value })
    },
    [setWeekStartPreference],
  )

  const lightThemes = React.useMemo(
    () =>
      availableThemes
        .filter((theme) => theme.metadata.variant === "light")
        .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)),
    [availableThemes],
  )

  const darkThemes = React.useMemo(
    () =>
      availableThemes
        .filter((theme) => theme.metadata.variant === "dark")
        .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)),
    [availableThemes],
  )

  const selectedLightTheme = React.useMemo(
    () => lightThemes.find((theme) => theme.metadata.id === lightThemeId) ?? lightThemes[0],
    [lightThemes, lightThemeId],
  )

  const selectedDarkTheme = React.useMemo(
    () => darkThemes.find((theme) => theme.metadata.id === darkThemeId) ?? darkThemes[0],
    [darkThemes, darkThemeId],
  )

  const formatThemeLabel = React.useCallback((themeName: string, variant: "light" | "dark") => {
    const suffix = variant === "dark" ? " Dark" : " Light"
    return themeName.endsWith(suffix) ? themeName.slice(0, -suffix.length) : themeName
  }, [])

  const shouldShow = (setting: VisibleSetting): boolean => {
    if (!visibleSettings) return true
    return visibleSettings.includes(setting)
  }

  const hasThemeSettings = shouldShow("theme")
  const hasLocalizationSettings = shouldShow("timeFormat") || shouldShow("weekStart")
  const hasAppearanceSettings = hasThemeSettings || hasLocalizationSettings
  const hasLayoutSettings =
    shouldShow("fontSize") || shouldShow("terminalFontSize") || shouldShow("spacing") || shouldShow("inputBarOffset")
  const hasNavigationSettings = shouldShow("terminalQuickKeys") && !isMobile
  const hasBehaviorSettings =
    shouldShow("mermaidRendering") ||
    shouldShow("userMessageRendering") ||
    shouldShow("chatRenderMode") ||
    shouldShow("messageTransport") ||
    (shouldShow("activityRenderMode") && chatRenderMode === "sorted") ||
    shouldShow("stickyUserHeader") ||
    shouldShow("wideChatLayout") ||
    shouldShow("splitAssistantMessageActions") ||
    shouldShow("diffLayout") ||
    shouldShow("dotfiles") ||
    shouldShow("reasoning") ||
    shouldShow("queueMode") ||
    shouldShow("persistDraft") ||
    shouldShow("showToolFileIcons") ||
    shouldShow("expandedTools") ||
    (!isMobile && shouldShow("inputSpellcheck"))

  const selectedTimeFormatLabel = React.useMemo(() => {
    const option = TIME_FORMAT_OPTIONS.find((item) => item.id === timeFormatPreference)
    return tUnsafe(option?.labelKey ?? "settings.openchamber.visual.option.timeFormat.auto.label")
  }, [timeFormatPreference, tUnsafe])
  const selectedWeekStartLabel = React.useMemo(() => {
    const option = WEEK_START_OPTIONS.find((item) => item.id === weekStartPreference)
    return tUnsafe(option?.labelKey ?? "settings.openchamber.visual.option.weekStart.auto.label")
  }, [weekStartPreference, tUnsafe])
  return (
    <div className="space-y-8">
      {/* --- Appearance & Themes --- */}
      {hasAppearanceSettings && (
        <div className="mb-8 space-y-6">
          {hasThemeSettings && (
            <section className="px-2 pb-2 pt-0 space-y-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="typography-ui-header font-medium text-foreground">
                  {t("settings.openchamber.visual.section.colorMode")}
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {THEME_MODE_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      variant="chip"
                      size="xs"
                      aria-pressed={themeMode === option.value}
                      className="!font-normal"
                      onClick={() => setThemeMode(option.value)}
                    >
                      {tUnsafe(option.labelKey)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 py-1.5 md:grid-cols-[14rem_auto] md:gap-x-8 md:gap-y-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="typography-ui-label text-foreground shrink-0">
                    {t("settings.openchamber.visual.field.lightTheme")}
                  </span>
                  <Select value={selectedLightTheme?.metadata.id ?? ""} onValueChange={setLightThemePreference}>
                    <SelectTrigger
                      aria-label={t("settings.openchamber.visual.field.selectLightThemeAria")}
                      className="w-fit"
                    >
                      <SelectValue placeholder={t("settings.openchamber.visual.field.selectThemePlaceholder")}>
                        {selectedLightTheme ? formatThemeLabel(selectedLightTheme.metadata.name, "light") : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {lightThemes.map((theme) => (
                        <SelectItem key={theme.metadata.id} value={theme.metadata.id}>
                          {formatThemeLabel(theme.metadata.name, "light")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="typography-ui-label text-foreground shrink-0">
                    {t("settings.openchamber.visual.field.darkTheme")}
                  </span>
                  <Select value={selectedDarkTheme?.metadata.id ?? ""} onValueChange={setDarkThemePreference}>
                    <SelectTrigger
                      aria-label={t("settings.openchamber.visual.field.selectDarkThemeAria")}
                      className="w-fit"
                    >
                      <SelectValue placeholder={t("settings.openchamber.visual.field.selectThemePlaceholder")}>
                        {selectedDarkTheme ? formatThemeLabel(selectedDarkTheme.metadata.name, "dark") : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {darkThemes.map((theme) => (
                        <SelectItem key={theme.metadata.id} value={theme.metadata.id}>
                          {formatThemeLabel(theme.metadata.name, "dark")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2 py-1.5">
                <button
                  type="button"
                  disabled={customThemesLoading || themesReloading}
                  onClick={() => {
                    const startedAt = Date.now()
                    setThemesReloading(true)
                    void reloadCustomThemes().finally(() => {
                      const elapsed = Date.now() - startedAt
                      if (elapsed < 500) {
                        window.setTimeout(() => {
                          setThemesReloading(false)
                        }, 500 - elapsed)
                        return
                      }
                      setThemesReloading(false)
                    })
                  }}
                  className="inline-flex items-center typography-ui-label font-normal text-foreground underline decoration-[1px] underline-offset-2 hover:text-foreground/80 disabled:cursor-not-allowed disabled:text-muted-foreground/60"
                >
                  {themesReloading
                    ? t("settings.openchamber.visual.actions.reloadingThemes")
                    : t("settings.openchamber.visual.actions.reloadThemes")}
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center justify-center rounded-md p-1 text-muted-foreground/70 hover:text-foreground"
                      aria-label={t("settings.openchamber.visual.field.themeImportInfoAria")}
                    >
                      <Icon name="information" className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8}>
                    {t("settings.openchamber.visual.field.themeImportInfoTooltip")}
                  </TooltipContent>
                </Tooltip>
              </div>
            </section>
          )}

          {hasLocalizationSettings && (
            <section className="px-2 pb-2 pt-0 space-y-2">
              <h4 className="typography-ui-header font-medium text-foreground">
                {t("settings.openchamber.visual.section.localization")}
              </h4>

              {(shouldShow("timeFormat") || shouldShow("weekStart")) && (
                <div className="grid grid-cols-1 gap-2 py-1.5 md:grid-cols-[14rem_auto] md:gap-x-8 md:gap-y-2">
                  {shouldShow("timeFormat") && (
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="typography-ui-label text-foreground shrink-0">
                        {t("settings.openchamber.visual.field.timeFormat")}
                      </span>
                      <Select
                        value={timeFormatPreference}
                        onValueChange={(value: "auto" | "12h" | "24h") => handleTimeFormatPreferenceChange(value)}
                      >
                        <SelectTrigger
                          aria-label={t("settings.openchamber.visual.field.selectTimeFormatAria")}
                          className="w-fit"
                        >
                          <SelectValue>{selectedTimeFormatLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {TIME_FORMAT_OPTIONS.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {tUnsafe(option.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {shouldShow("weekStart") && (
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="typography-ui-label text-foreground shrink-0">
                        {t("settings.openchamber.visual.field.weekStartsOn")}
                      </span>
                      <Select
                        value={weekStartPreference}
                        onValueChange={(value: "auto" | "monday" | "sunday") => handleWeekStartPreferenceChange(value)}
                      >
                        <SelectTrigger
                          aria-label={t("settings.openchamber.visual.field.selectWeekStartAria")}
                          className="w-fit"
                        >
                          <SelectValue>{selectedWeekStartLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {WEEK_START_OPTIONS.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {tUnsafe(option.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* --- UI Scaling & Layout --- */}
      {hasLayoutSettings && (
        <div className="mb-8 space-y-3">
          <section className="p-2 space-y-0.5">
            <h4 className="typography-ui-header font-medium text-foreground">
              {t("settings.openchamber.visual.section.spacingAndLayout")}
            </h4>
            <div className="pl-2">
              {shouldShow("fontSize") && !isMobile && (
                <div className="flex items-center gap-8 py-1">
                  <div className="flex min-w-0 flex-col w-56 shrink-0">
                    <span className="typography-ui-label text-foreground">
                      {t("settings.openchamber.visual.field.interfaceFont")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 w-fit">
                    <Select value={uiFont} onValueChange={(value) => setUiFont(value as UiFontOption)}>
                      <SelectTrigger
                        aria-label={t("settings.openchamber.visual.field.selectInterfaceFontAria")}
                        className="w-[13rem]"
                      >
                        <SelectValue>{UI_FONT_OPTIONS.find((option) => option.id === uiFont)?.label}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {UI_FONT_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            <span style={{ fontFamily: option.stack }}>{option.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => setUiFont(DEFAULT_UI_FONT)}
                      disabled={uiFont === DEFAULT_UI_FONT}
                      className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
                      aria-label={t("settings.openchamber.visual.actions.resetInterfaceFontAria")}
                      title={t("settings.common.actions.reset")}
                    >
                      <Icon name="restart" className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {shouldShow("terminalFontSize") && (
                <div className={cn("py-1", isMobile ? "flex flex-col gap-3" : "flex items-center gap-8")}>
                  <div className={cn("flex min-w-0 flex-col", isMobile ? "w-full" : "w-56 shrink-0")}>
                    <span className="typography-ui-label text-foreground">
                      {t("settings.openchamber.visual.field.codeFont")}
                    </span>
                  </div>
                  <div className={cn("flex items-center gap-2", isMobile ? "w-full" : "w-fit")}>
                    <Select value={monoFont} onValueChange={(value) => setMonoFont(value as MonoFontOption)}>
                      <SelectTrigger
                        aria-label={t("settings.openchamber.visual.field.selectCodeFontAria")}
                        className="w-[13rem]"
                      >
                        <SelectValue>{CODE_FONT_OPTIONS.find((option) => option.id === monoFont)?.label}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {CODE_FONT_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            <span style={{ fontFamily: option.stack }}>{option.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => setMonoFont(DEFAULT_MONO_FONT)}
                      disabled={monoFont === DEFAULT_MONO_FONT}
                      className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
                      aria-label={t("settings.openchamber.visual.actions.resetCodeFontAria")}
                      title={t("settings.common.actions.reset")}
                    >
                      <Icon name="restart" className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {shouldShow("fontSize") && !isMobile && (
                <div className="flex items-center gap-8 py-1">
                  <div className="flex min-w-0 flex-col w-56 shrink-0">
                    <span className="typography-ui-label text-foreground">
                      {t("settings.openchamber.visual.field.interfaceFontSize")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 w-fit">
                    <NumberInput
                      value={fontSize}
                      onValueChange={setFontSize}
                      min={50}
                      max={200}
                      step={5}
                      aria-label={t("settings.openchamber.visual.field.fontSizePercentageAria")}
                      className="w-16"
                    />
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => setFontSize(100)}
                      disabled={fontSize === 100}
                      className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
                      aria-label={t("settings.openchamber.visual.actions.resetFontSizeAria")}
                      title={t("settings.common.actions.reset")}
                    >
                      <Icon name="restart" className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {shouldShow("terminalFontSize") && (
                <div className={cn("py-1", isMobile ? "flex flex-col gap-3" : "flex items-center gap-8")}>
                  <div className={cn("flex min-w-0 flex-col", isMobile ? "w-full" : "w-56 shrink-0")}>
                    <span className="typography-ui-label text-foreground">
                      {t("settings.openchamber.visual.field.terminalFontSize")}
                    </span>
                  </div>
                  <div className={cn("flex items-center gap-2", isMobile ? "w-full" : "w-fit")}>
                    <NumberInput
                      value={terminalFontSize}
                      onValueChange={setTerminalFontSize}
                      min={9}
                      max={52}
                      step={1}
                      className="w-16"
                    />
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => setTerminalFontSize(13)}
                      disabled={terminalFontSize === 13}
                      className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
                      aria-label={t("settings.openchamber.visual.actions.resetTerminalFontSizeAria")}
                      title={t("settings.common.actions.reset")}
                    >
                      <Icon name="restart" className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {shouldShow("spacing") && (
                <div className={cn("py-1", isMobile ? "flex flex-col gap-3" : "flex items-center gap-8")}>
                  <div className={cn("flex min-w-0 flex-col", isMobile ? "w-full" : "w-56 shrink-0")}>
                    <span className="typography-ui-label text-foreground">
                      {t("settings.openchamber.visual.field.spacingDensity")}
                    </span>
                  </div>
                  <div className={cn("flex items-center gap-2", isMobile ? "w-full" : "w-fit")}>
                    <NumberInput
                      value={padding}
                      onValueChange={setPadding}
                      min={50}
                      max={200}
                      step={5}
                      className="w-16"
                    />
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => setPadding(100)}
                      disabled={padding === 100}
                      className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
                      aria-label={t("settings.openchamber.visual.actions.resetSpacingAria")}
                      title={t("settings.common.actions.reset")}
                    >
                      <Icon name="restart" className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {shouldShow("inputBarOffset") && (
                <div className={cn("py-1", isMobile ? "flex flex-col gap-3" : "flex items-center gap-8")}>
                  <div className={cn("flex min-w-0 flex-col", isMobile ? "w-full" : "w-56 shrink-0")}>
                    <div className="flex items-center gap-1.5">
                      <span className="typography-ui-label text-foreground">
                        {t("settings.openchamber.visual.field.inputBarOffset")}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Icon name="information" className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent sideOffset={8} className="max-w-xs">
                          {t("settings.openchamber.visual.field.inputBarOffsetTooltip")}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div className={cn("flex items-center gap-2", isMobile ? "w-full" : "w-fit")}>
                    <NumberInput
                      value={inputBarOffset}
                      onValueChange={setInputBarOffset}
                      min={0}
                      max={100}
                      step={5}
                      className="w-16"
                    />
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => setInputBarOffset(0)}
                      disabled={inputBarOffset === 0}
                      className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
                      aria-label={t("settings.openchamber.visual.actions.resetInputBarOffsetAria")}
                      title={t("settings.common.actions.reset")}
                    >
                      <Icon name="restart" className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* --- Navigation --- */}
      {hasNavigationSettings && (
        <div className="space-y-3">
          <section className="px-2 pb-2 pt-0">
            <h4 className="typography-ui-header font-medium text-foreground">
              {t("settings.openchamber.visual.section.navigation")}
            </h4>
            {shouldShow("terminalQuickKeys") && !isMobile && (
              <div
                className="group flex cursor-pointer items-center gap-2 py-1.5"
                role="button"
                tabIndex={0}
                aria-pressed={showTerminalQuickKeysOnDesktop}
                onClick={() => setShowTerminalQuickKeysOnDesktop(!showTerminalQuickKeysOnDesktop)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault()
                    setShowTerminalQuickKeysOnDesktop(!showTerminalQuickKeysOnDesktop)
                  }
                }}
              >
                <Checkbox
                  checked={showTerminalQuickKeysOnDesktop}
                  onChange={setShowTerminalQuickKeysOnDesktop}
                  ariaLabel={t("settings.openchamber.visual.field.terminalQuickKeysAria")}
                />
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="typography-ui-label text-foreground">
                    {t("settings.openchamber.visual.field.terminalQuickKeys")}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Icon name="information" className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent sideOffset={8} className="max-w-xs">
                      {t("settings.openchamber.visual.field.terminalQuickKeysTooltip")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {hasBehaviorSettings && (
        <div className="space-y-3">
          {(shouldShow("userMessageRendering") ||
            shouldShow("mermaidRendering") ||
            shouldShow("chatRenderMode") ||
            shouldShow("messageTransport") ||
            (shouldShow("activityRenderMode") && chatRenderMode === "sorted") ||
            shouldShow("diffLayout")) && (
            <div className="grid grid-cols-1 gap-y-2 md:grid-cols-[minmax(0,16rem)_minmax(0,16rem)] md:justify-start md:gap-x-2">
              {shouldShow("chatRenderMode") && (
                <section className="p-2 md:col-span-2">
                  <h4 className="typography-ui-header font-medium text-foreground">
                    {t("settings.openchamber.visual.section.chatRenderMode")}
                  </h4>
                  <div
                    role="radiogroup"
                    aria-label={t("settings.openchamber.visual.section.chatRenderModeAria")}
                    className="mt-1 grid w-full max-w-[26rem] grid-cols-1 gap-3 sm:grid-cols-2"
                  >
                    {CHAT_RENDER_MODE_OPTIONS.map((option) => {
                      const selected = chatRenderMode === option.id
                      const previewPhase = chatRenderPreviewTick % 12
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleChatRenderModeChange(option.id)}
                          aria-pressed={selected}
                          className={cn(
                            "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                            selected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-border/80 hover:bg-muted/50",
                          )}
                        >
                          <span
                            className={cn(
                              "typography-ui-label",
                              selected ? "text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {tUnsafe(option.labelKey)}
                          </span>
                          <div className="mt-2 w-full rounded-md border border-border/60 bg-muted/30 p-2">
                            {option.id === "live" ? (
                              <div className="space-y-1.5">
                                {[0, 1, 2].map((index) => {
                                  const rowStart = index * 3 + 1
                                  const rowProgressPhase = previewPhase - rowStart + 1
                                  const rowProgress =
                                    rowProgressPhase <= 0
                                      ? 0
                                      : rowProgressPhase === 1
                                        ? 42
                                        : rowProgressPhase === 2
                                          ? 68
                                          : 92
                                  const visible = rowProgress > 0
                                  return (
                                    <div
                                      key={index}
                                      className={cn(
                                        "flex items-center gap-1.5 transition-all duration-300 motion-reduce:transition-none",
                                        visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                                      )}
                                    >
                                      <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/55" />
                                      <span
                                        className="h-1.5 rounded bg-muted-foreground/30 transition-all duration-300 motion-reduce:transition-none"
                                        style={{ width: `${rowProgress}%` }}
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                {[0, 1, 2].map((index) => {
                                  const visible = previewPhase >= (index + 1) * 3
                                  return (
                                    <div
                                      key={index}
                                      className={cn(
                                        "flex items-center gap-1.5 transition-all duration-300 motion-reduce:transition-none",
                                        visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                                      )}
                                    >
                                      <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/55" />
                                      <span className="h-1.5 rounded bg-muted-foreground/30" style={{ width: "92%" }} />
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}

              {shouldShow("messageTransport") && (
                <section className="p-2 md:col-span-2">
                  <h4 className="typography-ui-header font-medium text-foreground">
                    {t("settings.openchamber.visual.section.messageStreamTransport")}
                  </h4>
                  <div className="mt-1 flex max-w-[24rem] flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {MESSAGE_STREAM_TRANSPORT_OPTIONS.map((option) => (
                        <Button
                          key={option.id}
                          variant="chip"
                          size="xs"
                          aria-pressed={messageStreamTransport === option.id}
                          className="!font-normal"
                          onClick={() => handleMessageStreamTransportChange(option.id)}
                        >
                          {tUnsafe(option.labelKey)}
                        </Button>
                      ))}
                    </div>
                    <span className="typography-meta text-muted-foreground">
                      {(() => {
                        const option = MESSAGE_STREAM_TRANSPORT_OPTIONS.find(
                          (item) => item.id === messageStreamTransport,
                        )
                        return option?.descriptionKey ? tUnsafe(option.descriptionKey) : ""
                      })()}
                    </span>
                  </div>
                </section>
              )}

              {shouldShow("activityRenderMode") && chatRenderMode === "sorted" && (
                <section className="p-2 md:col-span-2">
                  <h4 className="typography-ui-header font-medium text-foreground">
                    {t("settings.openchamber.visual.section.activityDefault")}
                  </h4>
                  <div
                    role="radiogroup"
                    aria-label={t("settings.openchamber.visual.section.activityDefaultAria")}
                    className="mt-0.5 space-y-0"
                  >
                    {ACTIVITY_RENDER_MODE_OPTIONS.map((option) => {
                      const selected = activityRenderMode === option.id
                      return (
                        <div
                          key={option.id}
                          role="button"
                          tabIndex={0}
                          aria-pressed={selected}
                          onClick={() => handleActivityRenderModeChange(option.id)}
                          onKeyDown={(event) => {
                            if (event.key === " " || event.key === "Enter") {
                              event.preventDefault()
                              handleActivityRenderModeChange(option.id)
                            }
                          }}
                          className="flex w-full items-center gap-2 py-0 text-left"
                        >
                          <Radio
                            checked={selected}
                            onChange={() => handleActivityRenderModeChange(option.id)}
                            ariaLabel={t("settings.openchamber.visual.field.activityDefaultModeAria", {
                              option: tUnsafe(option.labelKey),
                            })}
                          />
                          <span
                            className={cn(
                              "typography-ui-label font-normal",
                              selected ? "text-foreground" : "text-foreground/50",
                            )}
                          >
                            {tUnsafe(option.labelKey)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {shouldShow("expandedTools") && (
                <section className="p-2 md:col-span-2 space-y-0.5">
                  <div className="typography-ui-header font-medium text-foreground py-1.5">
                    {t("settings.openchamber.visual.section.showToolsOpenedByDefault")}
                  </div>

                  <div
                    className="group flex cursor-pointer items-center gap-2 py-0.5"
                    role="button"
                    tabIndex={0}
                    aria-pressed={showExpandedBashTools}
                    onClick={() => handleShowExpandedBashToolsChange(!showExpandedBashTools)}
                    onKeyDown={(event) => {
                      if (event.key === " " || event.key === "Enter") {
                        event.preventDefault()
                        handleShowExpandedBashToolsChange(!showExpandedBashTools)
                      }
                    }}
                  >
                    <Checkbox
                      checked={showExpandedBashTools}
                      onChange={handleShowExpandedBashToolsChange}
                      ariaLabel={t("settings.openchamber.visual.field.showExpandedBashToolsAria")}
                    />
                    <span className="typography-ui-label text-foreground">
                      {t("settings.openchamber.visual.field.bash")}
                    </span>
                  </div>

                  <div
                    className="group flex cursor-pointer items-center gap-2 py-0.5"
                    role="button"
                    tabIndex={0}
                    aria-pressed={showExpandedEditTools}
                    onClick={() => handleShowExpandedEditToolsChange(!showExpandedEditTools)}
                    onKeyDown={(event) => {
                      if (event.key === " " || event.key === "Enter") {
                        event.preventDefault()
                        handleShowExpandedEditToolsChange(!showExpandedEditTools)
                      }
                    }}
                  >
                    <Checkbox
                      checked={showExpandedEditTools}
                      onChange={handleShowExpandedEditToolsChange}
                      ariaLabel={t("settings.openchamber.visual.field.showExpandedEditToolsAria")}
                    />
                    <span className="typography-ui-label text-foreground">
                      {t("settings.openchamber.visual.field.editTools")}
                    </span>
                  </div>
                </section>
              )}

              {shouldShow("userMessageRendering") && (
                <section className="p-2">
                  <h4 className="typography-ui-header font-medium text-foreground">
                    {t("settings.openchamber.visual.section.userMessageRendering")}
                  </h4>
                  <div
                    role="radiogroup"
                    aria-label={t("settings.openchamber.visual.section.userMessageRenderingAria")}
                    className="mt-0.5 space-y-0"
                  >
                    {USER_MESSAGE_RENDERING_OPTIONS.map((option) => {
                      const selected = normalizeUserMessageRenderingMode(userMessageRenderingMode) === option.id
                      return (
                        <div
                          key={option.id}
                          role="button"
                          tabIndex={0}
                          aria-pressed={selected}
                          onClick={() => handleUserMessageRenderingModeChange(option.id)}
                          onKeyDown={(event) => {
                            if (event.key === " " || event.key === "Enter") {
                              event.preventDefault()
                              handleUserMessageRenderingModeChange(option.id)
                            }
                          }}
                          className="flex w-full items-center gap-2 py-0 text-left"
                        >
                          <Radio
                            checked={selected}
                            onChange={() => handleUserMessageRenderingModeChange(option.id)}
                            ariaLabel={t("settings.openchamber.visual.field.userMessageRenderingAria", {
                              option: tUnsafe(option.labelKey),
                            })}
                          />
                          <span
                            className={cn(
                              "typography-ui-label font-normal",
                              selected ? "text-foreground" : "text-foreground/50",
                            )}
                          >
                            {tUnsafe(option.labelKey)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {shouldShow("mermaidRendering") && (
                <section className="p-2">
                  <h4 className="typography-ui-header font-medium text-foreground">
                    {t("settings.openchamber.visual.section.mermaidRendering")}
                  </h4>
                  <div
                    role="radiogroup"
                    aria-label={t("settings.openchamber.visual.section.mermaidRenderingAria")}
                    className="mt-0.5 space-y-0"
                  >
                    {MERMAID_RENDERING_OPTIONS.map((option) => {
                      const selected = mermaidRenderingMode === option.id
                      return (
                        <div
                          key={option.id}
                          role="button"
                          tabIndex={0}
                          aria-pressed={selected}
                          onClick={() => handleMermaidRenderingModeChange(option.id)}
                          onKeyDown={(event) => {
                            if (event.key === " " || event.key === "Enter") {
                              event.preventDefault()
                              handleMermaidRenderingModeChange(option.id)
                            }
                          }}
                          className="flex w-full items-center gap-2 py-0 text-left"
                        >
                          <Radio
                            checked={selected}
                            onChange={() => handleMermaidRenderingModeChange(option.id)}
                            ariaLabel={t("settings.openchamber.visual.field.mermaidRenderingAria", {
                              option: tUnsafe(option.labelKey),
                            })}
                          />
                          <span
                            className={cn(
                              "typography-ui-label font-normal",
                              selected ? "text-foreground" : "text-foreground/50",
                            )}
                          >
                            {tUnsafe(option.labelKey)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {shouldShow("diffLayout") && (
                <section className="p-2">
                  <h4 className="typography-ui-header font-medium text-foreground">
                    {t("settings.openchamber.visual.section.diffLayout")}
                  </h4>
                  <div
                    role="radiogroup"
                    aria-label={t("settings.openchamber.visual.section.diffLayoutAria")}
                    className="mt-0.5 space-y-0"
                  >
                    {DIFF_LAYOUT_OPTIONS.map((option) => {
                      const selected = diffLayoutPreference === option.id
                      return (
                        <div
                          key={option.id}
                          role="button"
                          tabIndex={0}
                          aria-pressed={selected}
                          onClick={() => setDiffLayoutPreference(option.id)}
                          onKeyDown={(event) => {
                            if (event.key === " " || event.key === "Enter") {
                              event.preventDefault()
                              setDiffLayoutPreference(option.id)
                            }
                          }}
                          className="flex w-full items-center gap-2 py-0 text-left"
                        >
                          <Radio
                            checked={selected}
                            onChange={() => setDiffLayoutPreference(option.id)}
                            ariaLabel={t("settings.openchamber.visual.field.diffLayoutAria", {
                              option: tUnsafe(option.labelKey),
                            })}
                          />
                          <span
                            className={cn(
                              "typography-ui-label font-normal",
                              selected ? "text-foreground" : "text-foreground/50",
                            )}
                          >
                            {tUnsafe(option.labelKey)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {shouldShow("diffLayout") && (
                <section className="p-2">
                  <h4 className="typography-ui-header font-medium text-foreground">
                    {t("settings.openchamber.visual.section.diffViewMode")}
                  </h4>
                  <div
                    role="radiogroup"
                    aria-label={t("settings.openchamber.visual.section.diffViewModeAria")}
                    className="mt-0.5 space-y-0"
                  >
                    {DIFF_VIEW_MODE_OPTIONS.map((option) => {
                      const selected = diffViewMode === option.id
                      return (
                        <div
                          key={option.id}
                          role="button"
                          tabIndex={0}
                          aria-pressed={selected}
                          onClick={() => setDiffViewMode(option.id)}
                          onKeyDown={(event) => {
                            if (event.key === " " || event.key === "Enter") {
                              event.preventDefault()
                              setDiffViewMode(option.id)
                            }
                          }}
                          className="flex w-full items-center gap-2 py-0 text-left"
                        >
                          <Radio
                            checked={selected}
                            onChange={() => setDiffViewMode(option.id)}
                            ariaLabel={t("settings.openchamber.visual.field.diffViewModeAria", {
                              option: tUnsafe(option.labelKey),
                            })}
                          />
                          <span
                            className={cn(
                              "typography-ui-label font-normal",
                              selected ? "text-foreground" : "text-foreground/50",
                            )}
                          >
                            {tUnsafe(option.labelKey)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
          )}

          {(shouldShow("stickyUserHeader") ||
            shouldShow("wideChatLayout") ||
            shouldShow("splitAssistantMessageActions") ||
            shouldShow("dotfiles") ||
            shouldShow("queueMode") ||
            shouldShow("persistDraft") ||
            shouldShow("showToolFileIcons") ||
            shouldShow("showTurnChangedFiles") ||
            (!isMobile && shouldShow("inputSpellcheck")) ||
            shouldShow("reasoning")) && (
            <section className="p-2 space-y-0.5">
              {shouldShow("reasoning") && (
                <div
                  className="group flex cursor-pointer items-center gap-2 py-0.5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={showReasoningTraces}
                  onClick={() => setShowReasoningTraces(!showReasoningTraces)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault()
                      setShowReasoningTraces(!showReasoningTraces)
                    }
                  }}
                >
                  <Checkbox
                    checked={showReasoningTraces}
                    onChange={setShowReasoningTraces}
                    ariaLabel={t("settings.openchamber.visual.field.showReasoningTracesAria")}
                  />
                  <span className="typography-ui-label text-foreground">
                    {t("settings.openchamber.visual.field.showReasoningTraces")}
                  </span>
                </div>
              )}

              {shouldShow("reasoning") && showReasoningTraces && (
                <div
                  className="group flex cursor-pointer items-center gap-2 py-0.5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={collapsibleThinkingBlocks}
                  onClick={() => setCollapsibleThinkingBlocks(!collapsibleThinkingBlocks)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault()
                      setCollapsibleThinkingBlocks(!collapsibleThinkingBlocks)
                    }
                  }}
                >
                  <Checkbox
                    checked={collapsibleThinkingBlocks}
                    onChange={setCollapsibleThinkingBlocks}
                    ariaLabel={t("settings.openchamber.visual.field.collapsibleThinkingBlocksAria")}
                  />
                  <span className="typography-ui-label text-foreground">
                    {t("settings.openchamber.visual.field.collapsibleThinkingBlocks")}
                  </span>
                </div>
              )}

              {shouldShow("stickyUserHeader") && (
                <div
                  className="group flex cursor-pointer items-center gap-2 py-0.5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={stickyUserHeader}
                  onClick={() => handleStickyUserHeaderChange(!stickyUserHeader)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault()
                      handleStickyUserHeaderChange(!stickyUserHeader)
                    }
                  }}
                >
                  <Checkbox
                    checked={stickyUserHeader}
                    onChange={handleStickyUserHeaderChange}
                    ariaLabel={t("settings.openchamber.visual.field.stickyUserHeaderAria")}
                  />
                  <span className="typography-ui-label text-foreground">
                    {t("settings.openchamber.visual.field.stickyUserHeader")}
                  </span>
                </div>
              )}

              {shouldShow("wideChatLayout") && (
                <div
                  className="group flex cursor-pointer items-center gap-2 py-0.5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={wideChatLayoutEnabled}
                  onClick={() => handleWideChatLayoutChange(!wideChatLayoutEnabled)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault()
                      handleWideChatLayoutChange(!wideChatLayoutEnabled)
                    }
                  }}
                >
                  <Checkbox
                    checked={wideChatLayoutEnabled}
                    onChange={handleWideChatLayoutChange}
                    ariaLabel={t("settings.openchamber.visual.field.wideChatLayoutAria")}
                  />
                  <span className="typography-ui-label text-foreground">
                    {t("settings.openchamber.visual.field.wideChatLayout")}
                  </span>
                </div>
              )}

              {shouldShow("showTurnChangedFiles") && (
                <div
                  className="group flex cursor-pointer items-center gap-2 py-0.5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={showTurnChangedFiles}
                  onClick={() => handleShowTurnChangedFilesChange(!showTurnChangedFiles)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault()
                      handleShowTurnChangedFilesChange(!showTurnChangedFiles)
                    }
                  }}
                >
                  <Checkbox
                    checked={showTurnChangedFiles}
                    onChange={handleShowTurnChangedFilesChange}
                    ariaLabel={t("settings.openchamber.visual.field.showTurnChangedFilesAria")}
                  />
                  <span className="typography-ui-label text-foreground">
                    {t("settings.openchamber.visual.field.showTurnChangedFiles")}
                  </span>
                </div>
              )}

              {shouldShow("splitAssistantMessageActions") && (
                <div
                  className="group flex cursor-pointer items-center gap-2 py-0.5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={showSplitAssistantMessageActions}
                  onClick={() => handleShowSplitAssistantMessageActionsChange(!showSplitAssistantMessageActions)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault()
                      handleShowSplitAssistantMessageActionsChange(!showSplitAssistantMessageActions)
                    }
                  }}
                >
                  <Checkbox
                    checked={showSplitAssistantMessageActions}
                    onChange={handleShowSplitAssistantMessageActionsChange}
                    ariaLabel={t("settings.openchamber.visual.field.showSplitAssistantMessageActionsAria")}
                  />
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="typography-ui-label text-foreground">
                      {t("settings.openchamber.visual.field.showSplitAssistantMessageActions")}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Icon name="information" className="h-3.5 w-3.5 cursor-help text-muted-foreground/60" />
                      </TooltipTrigger>
                      <TooltipContent sideOffset={8} className="max-w-xs">
                        {t("settings.openchamber.visual.field.showSplitAssistantMessageActionsTooltip")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              )}

              {shouldShow("showToolFileIcons") && (
                <div
                  className="group flex cursor-pointer items-center gap-2 py-0.5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={showToolFileIcons}
                  onClick={() => handleShowToolFileIconsChange(!showToolFileIcons)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault()
                      handleShowToolFileIconsChange(!showToolFileIcons)
                    }
                  }}
                >
                  <Checkbox
                    checked={showToolFileIcons}
                    onChange={handleShowToolFileIconsChange}
                    ariaLabel={t("settings.openchamber.visual.field.showToolFileIconsAria")}
                  />
                  <span className="typography-ui-label text-foreground">
                    {t("settings.openchamber.visual.field.showToolFileIcons")}
                  </span>
                </div>
              )}

              {shouldShow("dotfiles") && (
                <div
                  className="group flex cursor-pointer items-center gap-2 py-0.5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={directoryShowHidden}
                  onClick={() => setDirectoryShowHidden(!directoryShowHidden)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault()
                      setDirectoryShowHidden(!directoryShowHidden)
                    }
                  }}
                >
                  <Checkbox
                    checked={directoryShowHidden}
                    onChange={setDirectoryShowHidden}
                    ariaLabel={t("settings.openchamber.visual.field.showDotfilesAria")}
                  />
                  <span className="typography-ui-label text-foreground">
                    {t("settings.openchamber.visual.field.showDotfiles")}
                  </span>
                </div>
              )}

              {shouldShow("queueMode") && (
                <div
                  className="group flex cursor-pointer items-center gap-2 py-0.5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={queueModeEnabled}
                  onClick={() => setQueueMode(!queueModeEnabled)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault()
                      setQueueMode(!queueModeEnabled)
                    }
                  }}
                >
                  <Checkbox
                    checked={queueModeEnabled}
                    onChange={setQueueMode}
                    ariaLabel={t("settings.openchamber.visual.field.queueMessagesByDefaultAria")}
                  />
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="typography-ui-label text-foreground">
                      {t("settings.openchamber.visual.field.queueMessagesByDefault")}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Icon name="information" className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent sideOffset={8} className="max-w-xs">
                        {t("settings.openchamber.visual.field.queueMessagesByDefaultTooltip", {
                          modifier: getModifierLabel(),
                        })}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              )}

              {shouldShow("persistDraft") && (
                <div
                  className="group flex cursor-pointer items-center gap-2 py-0.5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={persistChatDraft}
                  onClick={() => setPersistChatDraft(!persistChatDraft)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault()
                      setPersistChatDraft(!persistChatDraft)
                    }
                  }}
                >
                  <Checkbox
                    checked={persistChatDraft}
                    onChange={setPersistChatDraft}
                    ariaLabel={t("settings.openchamber.visual.field.persistDraftMessagesAria")}
                  />
                  <span className="typography-ui-label text-foreground">
                    {t("settings.openchamber.visual.field.persistDraftMessages")}
                  </span>
                </div>
              )}

              {!isMobile && shouldShow("inputSpellcheck") && (
                <div
                  className="group flex cursor-pointer items-center gap-2 py-1.5"
                  role="button"
                  tabIndex={0}
                  aria-pressed={inputSpellcheckEnabled}
                  onClick={() => handleInputSpellcheckChange(!inputSpellcheckEnabled)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault()
                      handleInputSpellcheckChange(!inputSpellcheckEnabled)
                    }
                  }}
                >
                  <Checkbox
                    checked={inputSpellcheckEnabled}
                    onChange={handleInputSpellcheckChange}
                    ariaLabel={t("settings.openchamber.visual.field.enableSpellcheckInTextInputsAria")}
                  />
                  <span className="typography-ui-label text-foreground">
                    {t("settings.openchamber.visual.field.enableSpellcheckInTextInputs")}
                  </span>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
