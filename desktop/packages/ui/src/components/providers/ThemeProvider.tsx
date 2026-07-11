import React from "react"
import { useUIStore } from "@/stores/useUIStore"
import { applyCornerRadius } from "@/lib/cornerRadius"

interface ThemeProviderProps {
  children: React.ReactNode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const fontSize = useUIStore((state) => state.fontSize)
  const applyTypography = useUIStore((state) => state.applyTypography)
  const padding = useUIStore((state) => state.padding)
  const applyPadding = useUIStore((state) => state.applyPadding)
  const cornerRadius = useUIStore((state) => state.cornerRadius)

  React.useLayoutEffect(() => {
    applyTypography()
    applyPadding()
    applyCornerRadius(cornerRadius)
  }, [fontSize, applyTypography, padding, applyPadding, cornerRadius])

  return <>{children}</>
}
