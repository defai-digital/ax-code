import { useCallback } from "react"
import { useUIStore } from "@/stores/useUIStore"
import type { MainTab } from "@/stores/useUIStore-impl"

export type SplitPaneRightTab = Exclude<MainTab, "chat">

const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

export function useSplitPane() {
  const splitEnabled = useUIStore((s) => s.splitPaneEnabled)
  const splitRatio = useUIStore((s) => s.splitPaneRatio)
  const splitRightTab = useUIStore((s) => s.splitPaneRightTab)

  const toggleSplit = useCallback(() => {
    const current = useUIStore.getState().splitPaneEnabled
    useUIStore.setState({ splitPaneEnabled: !current })
  }, [])

  const setSplitEnabled = useCallback((enabled: boolean) => {
    useUIStore.setState({ splitPaneEnabled: enabled })
  }, [])

  const setSplitRatio = useCallback((ratio: number) => {
    const clamped = Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio))
    useUIStore.setState({ splitPaneRatio: clamped })
  }, [])

  const setSplitRightTab = useCallback((tab: SplitPaneRightTab) => {
    useUIStore.setState({ splitPaneRightTab: tab })
  }, [])

  return {
    splitEnabled,
    splitRatio,
    splitRightTab,
    toggleSplit,
    setSplitEnabled,
    setSplitRatio,
    setSplitRightTab,
  }
}
