import type { CliRenderer } from "ax-tui"
import { createMockKeys } from "ax-tui/testing"
import type { TuiDebugAction, TuiDebugScreen } from "@ax-code/sdk/tui-debug"
import { redactAuditText } from "@/audit/redact"

/** Adapt the installed renderer's public APIs; no alternate renderer or private methods. */
export function createTuiDebugRenderer(renderer: CliRenderer, modalDepth: () => number) {
  const keys = createMockKeys(renderer, { kittyKeyboard: true })
  let injecting = false
  const keyNames = {
    enter: "RETURN",
    escape: "ESCAPE",
    tab: "TAB",
    backspace: "BACKSPACE",
    delete: "DELETE",
    up: "ARROW_UP",
    down: "ARROW_DOWN",
    left: "ARROW_LEFT",
    right: "ARROW_RIGHT",
    home: "HOME",
    end: "END",
  } as const
  return {
    get injecting() {
      return injecting
    },
    fence: () =>
      JSON.stringify({
        focusedId: renderer.currentFocusedRenderable?.id ?? null,
        modalDepth: modalDepth(),
        width: renderer.width,
        height: renderer.height,
      }),
    snapshot(): TuiDebugScreen {
      const buffer = renderer.currentRenderBuffer
      const cursor = renderer.getCursorState()
      return {
        frameId: renderer.frameId,
        width: buffer.width,
        height: buffer.height,
        text: redactAuditText(new TextDecoder().decode(buffer.getRealCharBytes(true))),
        focusedId: renderer.currentFocusedRenderable?.id.slice(0, 256) ?? null,
        modalDepth: modalDepth(),
        cursor: { x: cursor.x, y: cursor.y, visible: cursor.visible },
      }
    },
    input(action: TuiDebugAction) {
      injecting = true
      try {
        if (action.kind === "resize") {
          renderer.resize(action.width, action.height)
        } else if (action.kind === "paste") {
          // One parser delivery. Escapes/control bytes are excluded by the shared schema.
          renderer.stdin.emit("data", Buffer.from("\x1b[200~" + action.text + "\x1b[201~"))
        } else if (action.kind === "click") {
          // SGR coordinates are one-based. Both events are synchronous and frame-fenced.
          const pos = `${action.x + 1};${action.y + 1}`
          renderer.stdin.emit("data", Buffer.from(`\x1b[<0;${pos}M\x1b[<0;${pos}m`))
        } else if (action.key === "pageup" || action.key === "pagedown") {
          const code = action.key === "pageup" ? 5 : 6
          const modifier = 1 + (action.shift ? 1 : 0) + (action.meta ? 2 : 0) + (action.ctrl ? 4 : 0)
          renderer.stdin.emit("data", Buffer.from(modifier === 1 ? `\x1b[${code}~` : `\x1b[${code};${modifier}~`))
        } else {
          const key = Object.hasOwn(keyNames, action.key) ? keyNames[action.key as keyof typeof keyNames] : action.key
          keys.pressKey(key, { ctrl: action.ctrl, shift: action.shift, meta: action.meta })
        }
        renderer.requestRender()
      } finally {
        injecting = false
      }
    },
  }
}
