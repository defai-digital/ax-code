import { afterEach, describe, expect, test, vi } from "vitest"
import { promptCommands, type PromptCommandsInput } from "../../../src/cli/cmd/tui/component/prompt/prompt-commands"
import type { DialogContext } from "../../../src/cli/cmd/tui/ui/dialog"

afterEach(() => vi.restoreAllMocks())

function setup() {
  const composer = {
    focused: true,
    cursorOffset: 0,
    extmarks: { clear: vi.fn() },
    clear: vi.fn(),
    insertText: vi.fn(),
    setText: vi.fn(),
    gotoBufferEnd: vi.fn(),
  }
  let current: typeof composer | undefined
  const abort = vi.fn<PromptCommandsInput["sdk"]["client"]["session"]["abort"]>().mockResolvedValue({ data: true })
  const dialog = { clear: vi.fn(), stack: [], replace: vi.fn() } as unknown as DialogContext
  const host: PromptCommandsInput = {
    input: () => current!,
    store: { mode: "normal", prompt: { input: "draft", parts: [] } },
    setStore: vi.fn(),
    setExpandedPastes: vi.fn(),
    submit: vi.fn(),
    pasteClipboardImage: vi.fn(),
    autocompleteVisible: () => false,
    sessionID: () => "ses_prompt_commands",
    statusType: () => "busy",
    sdk: { client: { session: { abort } } },
    log: { warn: vi.fn() },
    toast: { show: vi.fn() },
    renderer: {},
    restoreExtmarksFromParts: vi.fn(),
    allPastesExpanded: () => false,
    pasteViewsLength: () => 0,
    setAllPastePreviews: vi.fn(),
    dialog,
    stash: { push: vi.fn(), pop: vi.fn(), list: () => [] },
  }
  return { composer, host, dialog, abort, mount: () => (current = composer) }
}

describe("prompt command lifecycle", () => {
  test("resolves the composer after command registration and before clearing a prompt", async () => {
    const { host, composer, dialog, mount } = setup()
    const commands = promptCommands(host)
    mount()

    await commands.find((command) => command.value === "prompt.clear")!.onSelect!(dialog)

    expect(composer.clear).toHaveBeenCalledOnce()
    expect(composer.extmarks.clear).toHaveBeenCalledOnce()
    expect(host.setStore).toHaveBeenCalledWith("prompt", { input: "", parts: [] })
  })

  test("resolves the mounted composer before submitting from a command", async () => {
    const { host, dialog, mount } = setup()
    const commands = promptCommands(host)
    mount()

    await commands.find((command) => command.value === "prompt.submit")!.onSelect!(dialog)

    expect(host.submit).toHaveBeenCalledOnce()
  })
})

describe("prompt session interrupt", () => {
  test.each([
    { error: { message: "Server refused interrupt" }, message: "Server refused interrupt" },
    { error: { data: { message: "Session is unavailable" } }, message: "Session is unavailable" },
    { error: "Connection failed", message: "Connection failed" },
    { error: { status: 503 }, message: "Failed to interrupt session" },
  ])("surfaces resolved SDK errors: $message", async ({ error, message }) => {
    const { host, dialog, mount, abort } = setup()
    mount()
    abort.mockResolvedValue({ error })
    const command = promptCommands(host).find((command) => command.value === "session.interrupt")!

    await command.onSelect!(dialog)
    await Promise.resolve()
    await Promise.resolve()

    expect(host.toast.show).toHaveBeenCalledWith({
      message,
      variant: "error",
    })
  })

  test("does not show an error for a successful interrupt", async () => {
    const { host, dialog, mount, abort } = setup()
    mount()
    const command = promptCommands(host).find((command) => command.value === "session.interrupt")!

    await command.onSelect!(dialog)
    await Promise.resolve()

    expect(abort).toHaveBeenCalledWith({ sessionID: "ses_prompt_commands" })
    expect(host.toast.show).not.toHaveBeenCalled()
  })
})
