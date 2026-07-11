import React from "react"
import { cn } from "@/lib/utils"
import { getAgentColor } from "@/lib/agentColors"
import { useProviderLogo } from "@/hooks/useProviderLogo"
import { Icon } from "@/components/icon/Icon"
import { formatTimestampForDisplay } from "./timeFormat"
import { useUIStore } from "@/stores/useUIStore"

interface MessageHeaderProps {
  isUser: boolean
  providerID: string | null
  agentName: string | undefined
  modelName: string | undefined
  variant?: string
  isDarkTheme: boolean
  timestamp?: number
}

const MessageHeader: React.FC<MessageHeaderProps> = ({
  isUser,
  providerID,
  agentName,
  modelName,
  variant,
  isDarkTheme,
  timestamp,
}) => {
  const timeFormatPreference = useUIStore((state) => state.timeFormatPreference)
  const formattedTimestamp = React.useMemo(
    () =>
      typeof timestamp === "number" && timestamp > 0
        ? formatTimestampForDisplay(timestamp, timeFormatPreference)
        : null,
    [timeFormatPreference, timestamp],
  )
  const { src: logoSrc, onError: handleLogoError, hasLogo } = useProviderLogo(providerID)

  return (
    <div className={cn("mb-1.5")}>
      <div className={cn("flex items-center justify-between gap-2")}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="flex-shrink-0">
            {isUser ? (
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                <Icon name="user-3" className="h-3.5 w-3.5 text-primary" />
              </div>
            ) : (
              <div className="flex h-5 w-5 items-center justify-center">
                {hasLogo && logoSrc ? (
                  <img
                    src={logoSrc}
                    alt={`${providerID} logo`}
                    className="h-4 w-4"
                    style={{
                      filter: isDarkTheme ? "brightness(0.9) contrast(1.1) invert(1)" : "brightness(0.9) contrast(1.1)",
                    }}
                    onError={handleLogoError}
                  />
                ) : (
                  <Icon
                    name="brain-ai-3"
                    className="h-4 w-4"
                    style={{ color: `var(${getAgentColor(agentName).var})` }}
                  />
                )}
              </div>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <h3
              className={cn(
                "min-w-0 truncate font-medium typography-ui-label tracking-tight leading-none",
                isUser ? "text-primary" : "text-foreground",
              )}
            >
              {isUser ? "You" : modelName || "Assistant"}
            </h3>
            {!isUser && agentName && (
              <div
                className={cn(
                  "flex flex-shrink-0 items-center gap-1 px-1.5 py-0 rounded cursor-default",
                  "agent-badge typography-meta",
                  "hover:bg-[rgb(from_var(--agent-color-bg)_r_g_b_/_0.1)] hover:border-[rgb(from_var(--agent-color)_r_g_b_/_0.2)]",
                  getAgentColor(agentName).class,
                )}
              >
                <Icon name="ai-agent" className="h-3 w-3 flex-shrink-0" />
                <span className="font-medium">{agentName}</span>
              </div>
            )}
            {!isUser && variant && (
              <div
                className={cn(
                  "flex flex-shrink-0 items-center gap-1 px-1.5 py-0 rounded cursor-default",
                  "agent-badge typography-meta",
                  "hover:bg-[rgb(from_var(--agent-color-bg)_r_g_b_/_0.1)] hover:border-[rgb(from_var(--agent-color)_r_g_b_/_0.2)]",
                  variant === "Default" ? undefined : "agent-info",
                )}
                style={
                  variant === "Default"
                    ? ({
                        "--agent-color": "var(--muted-foreground)",
                        "--agent-color-bg": "var(--muted-foreground)",
                      } as React.CSSProperties)
                    : undefined
                }
              >
                <Icon name="brain-ai-3" className="h-3 w-3 flex-shrink-0" />
                <span className="font-medium">
                  {variant.length > 0 ? variant[0].toLowerCase() + variant.slice(1) : variant}
                </span>
              </div>
            )}
          </div>
        </div>
        {formattedTimestamp && (
          <span className="shrink-0 typography-micro text-muted-foreground/40 tabular-nums select-none">
            {formattedTimestamp}
          </span>
        )}
      </div>
    </div>
  )
}

export default React.memo(MessageHeader)
