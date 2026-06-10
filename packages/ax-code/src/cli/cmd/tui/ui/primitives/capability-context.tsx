import { createMemo, type Accessor } from "solid-js"
import { Flag } from "@/flag/flag"
import { createSimpleContext } from "@tui/context/helper"
import { useKV } from "@tui/context/kv"
import { getTuiRenderProfile } from "@tui/renderer"
import { shouldUseTuiAnimations } from "@tui/component/spinner-profile"
import { resolveNerdFontEnabled, detectNerdFontTerminal, NERD_FONT_KV_KEY } from "@tui/ui/glyphs"
import { resolveVisualCapability, type VisualCapability } from "./capability"

export const { use: useVisualCapability, provider: VisualCapabilityProvider } = createSimpleContext({
  name: "VisualCapability",
  init: (): { capability: Accessor<VisualCapability> } => {
    const kv = useKV()
    const profile = getTuiRenderProfile()
    const capability = createMemo(() =>
      resolveVisualCapability({
        advancedTerminal: profile.advancedTerminal,
        colorterm: process.env["COLORTERM"],
        termProgram: process.env["TERM_PROGRAM"],
        term: process.env["TERM"],
        animationsEnabled: shouldUseTuiAnimations({ userEnabled: kv.get("animations_enabled", true) }),
        nerdFont: resolveNerdFontEnabled({
          env: Flag.AX_CODE_NERD_FONT_ENV,
          kv: kv.get(NERD_FONT_KV_KEY),
          detected: detectNerdFontTerminal({
            termProgram: process.env["TERM_PROGRAM"],
            term: process.env["TERM"],
          }),
        }),
      }),
    )
    return { capability }
  },
})
