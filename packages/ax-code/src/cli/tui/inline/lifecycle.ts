import type { CliRenderer, CliRendererConfig } from "ax-tui"
import type { TuiRenderProfile } from "../renderer"
import { destroyTuiRenderer } from "../renderer"
import { flushTuiStdout, restoreTuiStdinMode, resetTuiTerminalState } from "../terminal-cleanup"
import { registerTuiTerminalLifecycle } from "../util/lifecycle"

export function inlineFooterHeight(draftRows: number, terminalHeight: number, expanded = false) {
  return Math.max(1, Math.min(Math.max(4, Math.min(expanded ? terminalHeight : 6, draftRows + 3)), terminalHeight - 1))
}

export function inlineRenderOptions(): Partial<CliRendererConfig> {
  return { exitSignals: [], footerHeight: 4, externalOutputMode: "capture-stdout", clearOnShutdown: false }
}

export function createInlineLifecycle(renderer: CliRenderer, profile: TuiRenderProfile, flush: () => Promise<void>) {
  let task: Promise<void> | undefined
  let rows = 1
  let expanded = false
  const resize = () => {
    if (!renderer.isDestroyed) renderer.footerHeight = inlineFooterHeight(rows, renderer.terminalHeight, expanded)
  }
  renderer.on("resize", resize)
  const close = () =>
    (task ??= (async () => {
      let failure: unknown
      const attempt = async (action: () => void | Promise<void>) => {
        try {
          await action()
        } catch (error) {
          failure ??= error
        }
      }
      await attempt(flush)
      renderer.off("resize", resize)
      if (!renderer.isDestroyed) {
        // Do not let a failed stage strand input or skip native destruction.
        await attempt(() => {
          renderer.externalOutputMode = "passthrough"
        })
        await attempt(() => {
          renderer.screenMode = "main-screen"
        })
        await attempt(() => destroyTuiRenderer(renderer, profile))
      }
      // Native signal handlers may destroy the renderer before our async drain.
      // Restore protocols even when destruction has already happened.
      await attempt(() => {
        resetTuiTerminalState({ screenMode: "split-footer", kittyKeyboard: profile.useKittyKeyboard })
      })
      await attempt(() => {
        process.stdout.write("\r\n")
      })
      await attempt(() => flushTuiStdout())
      restoreTuiStdinMode()
      unregister()
      if (failure) throw failure
    })())
  const unregister = registerTuiTerminalLifecycle({ profile, close })
  return {
    close,
    resize(draftRows: number, expand = false) {
      expanded = expand
      rows = draftRows
      resize()
    },
  }
}
