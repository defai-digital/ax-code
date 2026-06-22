import * as React from "react"
import { Icon } from "@/components/icon/Icon"
import { toast } from "@/components/ui/toast"
import { reloadAxCodeConfiguration } from "@/stores/useAgentsStore"
import { useUIStore } from "@/stores/useUIStore"
import { useI18n } from "@/lib/i18n"
import { getSafeStorage } from "@/stores/utils/safeStorage"
import { API_ENDPOINTS } from "@/lib/http"
import {
  resolveAxCodeIncompatibility,
  resolveAxCodeUpdateVersion,
  resolveAxCodeUpgradeStatusVersion,
  shouldShowAxCodeUpdateToast,
  type AxCodeUpgradeStatusLike,
} from "./axCodeUpdateDedup"

const UPDATE_TOAST_ID = "ax-code-update-available"
const UPGRADE_TOAST_ID = "ax-code-upgrade-progress"
const INCOMPATIBLE_TOAST_ID = "ax-code-incompatible-version"
const INITIAL_CHECK_DELAY_MS = 5_000
const CHECK_RETRY_DELAYS_MS = [10_000, 60_000]
const UPDATE_TOAST_DISMISSED_VERSION_KEY = "ax-code-update-toast-dismissed-version"

export const AxCodeUpdateToast: React.FC = () => {
  const { t } = useI18n()
  const showAxCodeUpdateNotifications = useUIStore((state) => state.showAxCodeUpdateNotifications)
  const seenVersionsRef = React.useRef(new Set<string>())
  const upgradingRef = React.useRef(false)
  const warnedIncompatibleVersionRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!showAxCodeUpdateNotifications) {
      toast.dismiss(UPDATE_TOAST_ID)
    }
  }, [showAxCodeUpdateNotifications])

  const reloadAxCode = React.useCallback(() => {
    toast.dismiss(UPGRADE_TOAST_ID)
    void reloadAxCodeConfiguration({
      message: t("axCodeUpdate.toast.reload.message"),
      mode: "projects",
      scopes: ["all"],
    })
  }, [t])

  const runUpgrade = React.useCallback(async () => {
    if (upgradingRef.current) return
    upgradingRef.current = true
    toast.dismiss(UPDATE_TOAST_ID)
    toast.message(t("axCodeUpdate.toast.upgrading.title"), {
      id: UPGRADE_TOAST_ID,
      description: t("axCodeUpdate.toast.upgrading.description"),
      duration: Infinity,
      icon: <Icon name="refresh" className="h-4 w-4 animate-spin text-muted-foreground" />,
    })

    try {
      const response = await fetch(API_ENDPOINTS.axCode.upgrade, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({}),
      })
      const payload = (await response.json().catch(() => null)) as null | {
        success?: boolean
        version?: string
        error?: string
      }
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || response.statusText || t("axCodeUpdate.toast.failed.description"))
      }

      warnedIncompatibleVersionRef.current = null
      toast.dismiss(INCOMPATIBLE_TOAST_ID)
      toast.success(t("axCodeUpdate.toast.updated.title"), {
        id: UPGRADE_TOAST_ID,
        description: payload?.version
          ? t("axCodeUpdate.toast.updated.descriptionWithVersion", { version: payload.version })
          : t("axCodeUpdate.toast.updated.description"),
        duration: Infinity,
        icon: <Icon name="check" className="h-4 w-4 text-[var(--status-success)]" />,
        action: {
          label: t("axCodeUpdate.toast.actions.reload"),
          onClick: reloadAxCode,
        },
      })
    } catch (error) {
      toast.error(t("axCodeUpdate.toast.failed.title"), {
        id: UPGRADE_TOAST_ID,
        description: error instanceof Error ? error.message : t("axCodeUpdate.toast.failed.description"),
        duration: Infinity,
      })
    } finally {
      upgradingRef.current = false
    }
  }, [reloadAxCode, t])

  React.useEffect(() => {
    const showUpdateAvailableToast = (version: string) => {
      // Upstream setting wins over our dedup logic: if user disabled
      // ax-code update notifications, dismiss any active toast and bail
      // before consulting dedup state.
      if (!useUIStore.getState().showAxCodeUpdateNotifications) {
        toast.dismiss(UPDATE_TOAST_ID)
        return
      }
      const decision = shouldShowAxCodeUpdateToast({
        version,
        dismissedVersion: getSafeStorage().getItem(UPDATE_TOAST_DISMISSED_VERSION_KEY),
        seenVersions: seenVersionsRef.current,
      })
      if (!decision) {
        return
      }
      seenVersionsRef.current.add(version)

      toast.info(t("axCodeUpdate.toast.available.title"), {
        id: UPDATE_TOAST_ID,
        description: t("axCodeUpdate.toast.available.description", { version }),
        duration: Infinity,
        action: {
          label: t("axCodeUpdate.toast.actions.update"),
          onClick: runUpgrade,
        },
        cancel: {
          label: t("axCodeUpdate.toast.actions.dismiss"),
          onClick: () => {
            getSafeStorage().setItem(UPDATE_TOAST_DISMISSED_VERSION_KEY, version)
            toast.dismiss(UPDATE_TOAST_ID)
          },
        },
      })
    }

    const onUpdateAvailable = (event: Event) => {
      const version = resolveAxCodeUpdateVersion((event as CustomEvent<unknown>).detail)
      showUpdateAvailableToast(version)
    }

    let cancelled = false
    const timeoutIds: Array<ReturnType<typeof setTimeout>> = []

    // The incompatibility warning is an error condition, not a notification:
    // it shows regardless of the update-notification preference.
    const showIncompatibleToast = (incompatibility: { version: string; minSupportedVersion: string }) => {
      if (warnedIncompatibleVersionRef.current === incompatibility.version) {
        return
      }
      warnedIncompatibleVersionRef.current = incompatibility.version

      toast.warning(t("axCodeUpdate.toast.incompatible.title"), {
        id: INCOMPATIBLE_TOAST_ID,
        description: t("axCodeUpdate.toast.incompatible.description", {
          version: incompatibility.version,
          minVersion: incompatibility.minSupportedVersion,
        }),
        duration: Infinity,
        action: {
          label: t("axCodeUpdate.toast.actions.update"),
          onClick: runUpgrade,
        },
      })
    }

    const checkForUpdate = async (attempt: number) => {
      try {
        const response = await fetch(API_ENDPOINTS.axCode.upgradeStatus, { headers: { Accept: "application/json" } })
        if (!response.ok) throw new Error(response.statusText || "ax-code upgrade status check failed")
        const status = (await response.json().catch(() => null)) as AxCodeUpgradeStatusLike | null
        if (cancelled) return

        const incompatibility = resolveAxCodeIncompatibility(status)
        if (incompatibility) {
          showIncompatibleToast(incompatibility)
        }

        const version = resolveAxCodeUpgradeStatusVersion(status)
        if (version) {
          showUpdateAvailableToast(version)
        }
      } catch {
        const delay = CHECK_RETRY_DELAYS_MS[attempt]
        if (!cancelled && delay !== undefined) {
          timeoutIds.push(
            setTimeout(() => {
              void checkForUpdate(attempt + 1)
            }, delay),
          )
        }
      }
    }

    timeoutIds.push(
      setTimeout(() => {
        void checkForUpdate(0)
      }, INITIAL_CHECK_DELAY_MS),
    )

    window.addEventListener("openchamber:ax-code-update-available", onUpdateAvailable)
    return () => {
      cancelled = true
      for (const timeoutId of timeoutIds) clearTimeout(timeoutId)
      window.removeEventListener("openchamber:ax-code-update-available", onUpdateAvailable)
    }
  }, [runUpgrade, showAxCodeUpdateNotifications, t])

  return null
}
