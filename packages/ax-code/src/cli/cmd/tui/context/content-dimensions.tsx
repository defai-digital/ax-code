import { createContext, useContext, type Accessor } from "solid-js"
import { useTerminalDimensions } from "ax-tui/solid"

const ContentDimensions = createContext<Accessor<{ width: number; height: number }>>()
export const ContentDimensionsProvider = ContentDimensions.Provider

/** Content measures the viewport after docking; dialogs still use the terminal. */
export function useContentDimensions() {
  return useContext(ContentDimensions) ?? useTerminalDimensions()
}
