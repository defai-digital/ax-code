import React from "react"
import { AXCodeVisualSettings } from "./AXCodeVisualSettings"
import { SessionRetentionSettings } from "./SessionRetentionSettings"
import { PasskeySettings } from "./PasskeySettings"
import { DefaultsSettings } from "./DefaultsSettings"
import { GitSettings } from "./GitSettings"
import { NotificationSettings } from "./NotificationSettings"
import { GitHubSettings } from "./GitHubSettings"
import { AxCodeCliSettings } from "./AxCodeCliSettings"
import { KeyboardShortcutsSettings } from "./KeyboardShortcutsSettings"
import { CornerRadiusSettings } from "./CornerRadiusSettings"
import { ScrollableOverlay } from "@/components/ui/ScrollableOverlay"
import type { AXCodeSection } from "./types"

interface AXCodePageProps {
  section: AXCodeSection
}

export const AXCodePage: React.FC<AXCodePageProps> = ({ section }) => {
  const renderSectionContent = () => {
    switch (section) {
      case "visual":
        return <VisualSectionContent />
      case "chat":
        return <ChatSectionContent />
      case "sessions":
        return <SessionsSectionContent />
      case "shortcuts":
        return <ShortcutsSectionContent />
      case "git":
        return <GitSectionContent />
      case "github":
        return <GitHubSectionContent />
      case "notifications":
        return <NotificationSectionContent />
      default:
        return null
    }
  }

  return (
    <ScrollableOverlay outerClassName="h-full" className="w-full">
      <div className="ax-code-page-body mx-auto max-w-3xl space-y-6 p-3 sm:p-6 sm:pt-8">{renderSectionContent()}</div>
    </ScrollableOverlay>
  )
}

const ShortcutsSectionContent: React.FC = () => {
  return <KeyboardShortcutsSettings />
}

// Visual section: Theme Mode, Font Size, Spacing, Input Bar Offset, Nav Rail
const VisualSectionContent: React.FC = () => {
  return (
    <div className="space-y-6">
      <AXCodeVisualSettings
        visibleSettings={[
          "theme",
          "timeFormat",
          "weekStart",
          "fontSize",
          "terminalFontSize",
          "spacing",
          "inputBarOffset",
          "terminalQuickKeys",
        ]}
      />
      <div className="border-t border-border/40 pt-6">
        <CornerRadiusSettings />
      </div>
    </div>
  )
}

// Chat section: User message rendering, Diff layout, Show reasoning traces, Queue mode, Persist draft
const ChatSectionContent: React.FC = () => {
  return (
    <AXCodeVisualSettings
      visibleSettings={[
        "chatRenderMode",
        "messageTransport",
        "activityRenderMode",
        "userMessageRendering",
        "mermaidRendering",
        "reasoning",
        "showToolFileIcons",
        "expandedTools",
        "showTurnChangedFiles",
        "stickyUserHeader",
        "wideChatLayout",
        "splitAssistantMessageActions",
        "diffLayout",
        "dotfiles",
        "queueMode",
        "persistDraft",
        "inputSpellcheck",
      ]}
    />
  )
}

// Sessions section: Default model & agent, Session retention
const SessionsSectionContent: React.FC = () => {
  return (
    <div className="space-y-6">
      <DefaultsSettings />
      <div className="border-t border-border/40 pt-6">
        <AxCodeCliSettings />
      </div>
      <div className="border-t border-border/40 pt-6">
        <SessionRetentionSettings />
      </div>
      <div className="border-t border-border/40 pt-6">
        <PasskeySettings />
      </div>
    </div>
  )
}

// Git section: Commit message model, Worktree settings
const GitSectionContent: React.FC = () => {
  return (
    <div className="space-y-6">
      <GitSettings />
    </div>
  )
}

// GitHub section: Connect account for PR/issue workflows
const GitHubSectionContent: React.FC = () => {
  return <GitHubSettings />
}

// Notifications section: Native browser notifications
const NotificationSectionContent: React.FC = () => {
  return <NotificationSettings />
}
