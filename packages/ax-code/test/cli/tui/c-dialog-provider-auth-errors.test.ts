import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "vitest"

// Regression guards (source-pattern tests, matching h-session-undo-redo-revert-error.test.ts):
// The v2 SDK client resolves `{error}` instead of rejecting when throwOnError is
// falsy (the default), so `.catch()`/discarded results on sdk.client.auth.* and
// sdk.client.provider.oauth.* calls are dead code for HTTP/network failures. The
// provider dialog used to run its success path (dispose/bootstrap, "Connected"/
// "Disconnected" toast, model picker) on FAILED auth writes/removes and OAuth
// callbacks. Each must now inspect the resolved `.error` and route failures into
// the toast/error path before any success side effect.

const TUI_ROOT = path.join(__dirname, "../../../src/cli/cmd/tui")
const DIALOG_PROVIDER_SRC = path.join(TUI_ROOT, "component/dialog-provider.tsx")

function sliceFrom(src: string, marker: string, length = 900) {
  const index = src.indexOf(marker)
  expect(index).toBeGreaterThan(0)
  return src.slice(index, index + length)
}

describe("tui provider dialog SDK-error handling", () => {
  test("CLI provider connect checks auth.set result before dispose/success toast", async () => {
    const src = await fs.readFile(DIALOG_PROVIDER_SRC, "utf8")
    const block = sliceFrom(src, "store a marker in auth.json", 1100)
    expect(block).toContain("const stored = await sdk.client.auth.set(")
    const guard = block.indexOf("if (stored.error)")
    expect(guard).toBeGreaterThan(0)
    // dispose + bootstrap + success toast must all sit after the error guard.
    expect(block.indexOf("sdk.client.instance.dispose", guard)).toBeGreaterThan(guard)
    expect(block.indexOf("Connected ${provider.name}", guard)).toBeGreaterThan(guard)
  })

  test("CLI provider disconnect checks auth.remove result before success", async () => {
    const src = await fs.readFile(DIALOG_PROVIDER_SRC, "utf8")
    const block = sliceFrom(src, 'action === "disconnect"', 700)
    expect(block).toContain("const removed = await sdk.client.auth.remove(")
    const guard = block.indexOf("if (removed.error)")
    expect(guard).toBeGreaterThan(0)
    expect(block.indexOf("Disconnected ${provider.name}", guard)).toBeGreaterThan(guard)
  })

  test("API provider remove checks auth.remove result before success", async () => {
    const src = await fs.readFile(DIALOG_PROVIDER_SRC, "utf8")
    const block = sliceFrom(src, 'action === "remove"', 500)
    expect(block).toContain("const removed = await sdk.client.auth.remove(")
    expect(block).toContain("if (removed.error)")
  })

  test("ApiMethod checks auth.set result before advancing to the model picker", async () => {
    const src = await fs.readFile(DIALOG_PROVIDER_SRC, "utf8")
    const block = sliceFrom(src, "API key is required", 800)
    expect(block).toContain("const stored = await sdk.client.auth.set(")
    const guard = block.indexOf("if (stored.error)")
    expect(guard).toBeGreaterThan(0)
    // The model picker replace must be gated behind the error guard.
    expect(block.indexOf("DialogModel providerID", guard)).toBeGreaterThan(guard)
  })

  test("AutoMethod toasts a failed OAuth callback and only advances on success", async () => {
    const src = await fs.readFile(DIALOG_PROVIDER_SRC, "utf8")
    const block = sliceFrom(src, "let cancelled = false", 1100)
    // Failure surfaces a toast (mirrors the authorize step) instead of a silent clear.
    expect(block).toContain("if (result.error)")
    expect(block).toContain("toast.show({ variant: \"error\", message: JSON.stringify(result.error) })")
    // On a late success after cancellation, dispose + bootstrap still run; only
    // the DialogModel replace is skipped by the trailing `if (cancelled) return`.
    const dispose = block.indexOf("sdk.client.instance.dispose")
    const bootstrap = block.indexOf("sync.bootstrap")
    const cancelledGuard = block.indexOf("if (cancelled) return", dispose)
    const replace = block.indexOf("DialogModel providerID", dispose)
    expect(dispose).toBeGreaterThan(0)
    expect(bootstrap).toBeGreaterThan(dispose)
    expect(cancelledGuard).toBeGreaterThan(bootstrap)
    expect(replace).toBeGreaterThan(cancelledGuard)
  })

  test("CodeMethod derives the inline error from the payload, not a static string", async () => {
    const src = await fs.readFile(DIALOG_PROVIDER_SRC, "utf8")
    const block = sliceFrom(src, "placeholder=\"Authorization code\"", 1400)
    expect(block).toContain("const result = await sdk.client.provider.oauth.callback(")
    expect(block).toContain("setError(sdkErrorMessage(result.error, \"Invalid code\"))")
    // The signal now carries a message string, rendered in the description.
    expect(src).toContain("const [error, setError] = createSignal<string | null>(null)")
  })

  test('cancel copy is spelled "Cancelled connecting"', async () => {
    const src = await fs.readFile(DIALOG_PROVIDER_SRC, "utf8")
    expect(src).toContain("Cancelled connecting ${provider.name}")
    expect(src).not.toContain("Canceled connecting")
  })
})
