import { useTheme } from "@tui/context/theme"
import { GradientText } from "@tui/ui/primitives/gradient-text"
import { logo } from "@/cli/logo"

// Renders the "AX-CODE" slant figlet (5 lines, 53 columns) used on the TUI
// welcome screen with a primary→secondary brand gradient; non-truecolor
// terminals fall back to plain themed bold text.
export function Logo() {
  const { theme } = useTheme()
  return (
    <GradientText
      lines={logo}
      from={theme.brandGradientStart}
      to={theme.brandGradientEnd}
      fallback={theme.text}
      bold
      diagonalBias={3}
    />
  )
}
