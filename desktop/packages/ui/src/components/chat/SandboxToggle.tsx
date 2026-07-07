import React from "react"
import { Icon } from "@/components/icon/Icon"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { useSandboxStore } from "@/stores/useSandboxStore"
import { normalizeDirectoryKey } from "@/stores/utils/directoryKey"

interface SandboxToggleProps {
  className?: string
  iconSizeClass?: string
}

export const SandboxToggle: React.FC<SandboxToggleProps> = ({ className, iconSizeClass = "h-3.5 w-3.5" }) => {
  const { t } = useI18n()
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory)
  // Must match the key the store writes under (normalizeDirectoryKey), not a
  // plain trim — otherwise unnormalized paths (trailing slash, backslashes)
  // subscribe to a key the store never populates.
  const dirKey = normalizeDirectoryKey(currentDirectory)

  const sandbox = useSandboxStore((s) => s.sandboxByDirectory[dirKey])
  const pending = useSandboxStore((s) => s.pendingByDirectory[dirKey] === true)
  const loadSandbox = useSandboxStore((s) => s.loadSandbox)
  const setSandbox = useSandboxStore((s) => s.setSandbox)

  React.useEffect(() => {
    void loadSandbox(currentDirectory)
  }, [currentDirectory, loadSandbox])

  const isOn = sandbox === true
  const label = isOn ? t("chat.chatInput.sandbox.on") : t("chat.chatInput.sandbox.off")

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={isOn}
      disabled={pending || sandbox === undefined}
      onClick={() => {
        if (pending || sandbox === undefined) return
        void setSandbox(currentDirectory, !isOn)
      }}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md border border-border/40 px-2 typography-meta text-foreground outline-none hover:bg-interactive-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
    >
      <Icon
        name={pending ? "loader-4" : isOn ? "shield-check" : "lock-unlock"}
        className={cn(iconSizeClass, "flex-shrink-0", pending && "animate-spin")}
      />
      <span className="truncate">{t("chat.chatInput.sandbox.title")}</span>
    </button>
  )
}
