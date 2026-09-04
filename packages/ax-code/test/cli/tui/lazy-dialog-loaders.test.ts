import { afterEach, describe, expect, test, vi } from "vitest"
import { createTuiDialogLoaders, replaceLazyDialog } from "../../../src/cli/cmd/tui/tui-dialogs"
import type { DialogContext } from "../../../src/cli/cmd/tui/ui/dialog"
import { DialogAlert } from "../../../src/cli/cmd/tui/ui/dialog-alert"

vi.mock("@tui/ui/dialog-alert", () => ({ DialogAlert: { show: vi.fn() } }))

afterEach(() => vi.restoreAllMocks())

function host() {
  let stack: DialogContext["stack"] = []
  const replace = vi.fn(() => {
    stack = [{ element: undefined }]
  })
  return {
    get stack() {
      return stack
    },
    replace,
    size: "medium" as const,
    setSize: vi.fn(),
    clear() {
      stack = []
    },
  }
}

function load(dialog: ReturnType<typeof host>, toast = { show: vi.fn() }) {
  const pending = Promise.withResolvers<() => undefined>()
  const result = replaceLazyDialog({
    dialog,
    toast,
    load: () => pending.promise,
    warn: "dialog fixture load failed",
    fail: "Dialog failed to open",
  })
  return { ...pending, result, toast }
}

describe("lazy dialog loaders", () => {
  test("opens the loaded dialog when the host is unchanged", async () => {
    const dialog = host()
    const pending = load(dialog)
    const view = () => undefined
    pending.resolve(view)
    await pending.result

    expect(dialog.replace).toHaveBeenCalledWith(view)
  })

  test("does not reopen a dialog after another dialog was opened and closed", async () => {
    const dialog = host()
    const pending = load(dialog)
    dialog.replace()
    dialog.clear()
    dialog.replace.mockClear()
    pending.resolve(() => undefined)
    await pending.result

    expect(dialog.replace).not.toHaveBeenCalled()
  })

  test("honors the most recent request when an earlier import resolves first", async () => {
    const dialog = host()
    const first = load(dialog)
    const second = load(dialog)
    const firstView = () => undefined
    const secondView = () => undefined
    first.resolve(firstView)
    await first.result
    second.resolve(secondView)
    await second.result

    expect(dialog.replace).toHaveBeenCalledExactlyOnceWith(secondView)
  })

  test("ignores an earlier import that resolves after the latest dialog opens", async () => {
    const dialog = host()
    const first = load(dialog)
    const second = load(dialog)
    const secondView = () => undefined
    second.resolve(secondView)
    await second.result
    first.resolve(() => undefined)
    await first.result

    expect(dialog.replace).toHaveBeenCalledExactlyOnceWith(secondView)
  })

  test("does not show stale errors after the dialog host changes", async () => {
    const dialog = host()
    const pending = load(dialog)
    dialog.replace()
    pending.reject(new Error("Import failed"))
    await pending.result

    expect(pending.toast.show).not.toHaveBeenCalled()
  })

  test("does not show errors from a superseded request", async () => {
    const dialog = host()
    const first = load(dialog)
    const second = load(dialog)
    first.reject(new Error("Import failed"))
    await first.result
    second.resolve(() => undefined)
    await second.result

    expect(first.toast.show).not.toHaveBeenCalled()
  })

  test("reports a failure for the current request", async () => {
    const pending = load(host())
    pending.reject(new Error("Import failed"))
    await pending.result

    expect(pending.toast.show).toHaveBeenCalledWith({ message: "Dialog failed to open", variant: "error" })
  })

  test("does not resurrect an earlier request when the latest request fails", async () => {
    const dialog = host()
    const first = load(dialog)
    const second = load(dialog)
    second.reject(new Error("Import failed"))
    await second.result
    first.resolve(() => undefined)
    await first.result

    expect(dialog.replace).not.toHaveBeenCalled()
    expect(second.toast.show).toHaveBeenCalledOnce()
  })

  test("keeps independent dialog hosts independent", async () => {
    const firstHost = host()
    const secondHost = host()
    const first = load(firstHost)
    const second = load(secondHost)
    first.resolve(() => undefined)
    second.resolve(() => undefined)
    await Promise.all([first.result, second.result])

    expect(firstHost.replace).toHaveBeenCalledOnce()
    expect(secondHost.replace).toHaveBeenCalledOnce()
  })

  test("does not replace the effort fallback alert with an empty view", async () => {
    const dialog = host()
    const pending = load(dialog)
    const toast = { show: vi.fn() }
    const dialogs = createTuiDialogLoaders({
      dialog,
      toast,
      variantCount: () => 0,
      currentModelName: () => "Test model",
    })
    await dialogs.showEffortDialog()
    pending.resolve(() => undefined)
    await pending.result

    expect(DialogAlert.show).toHaveBeenCalledWith(dialog, "Effort", expect.stringContaining("Test model"))
    expect(dialog.replace).not.toHaveBeenCalled()
    expect(toast.show).not.toHaveBeenCalled()
  })
})
