// Exercise real Solid dialogs with the native renderer and isolated user state.
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Message, Part } from "@ax-code/sdk/v2"
import type { ParentProps } from "solid-js"
import type { Renderable } from "ax-tui"

const state = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-tui-adoption-"))
process.env.XDG_STATE_HOME = state
process.env.XDG_CONFIG_HOME = state
process.env.XDG_DATA_HOME = state
process.env.AX_CODE_DISABLE_PROJECT_CONFIG = "true"
const { testRender } = await import("ax-tui/solid")
const { InputRenderable, MouseButton, VirtualListRenderable, RGBA } = await import("ax-tui")
const { KVProvider, useKV } = await import("../src/cli/tui/context/kv")
const { TuiConfigProvider } = await import("../src/cli/tui/context/tui-config")
const { LanguageProvider } = await import("../src/cli/tui/context/language")
const { ThemeProvider } = await import("../src/cli/tui/context/theme")
const { KeybindProvider } = await import("../src/cli/tui/context/keybind")
const { ToastProvider } = await import("../src/cli/tui/ui/toast")
const { DialogProvider, DialogStack, useDialog } = await import("../src/cli/tui/ui/dialog")
const { CommandProvider, useCommandDialog } = await import("../src/cli/tui/component/dialog-command")
const { createCommandExecutor } = await import("../src/cli/tui/component/command-execution")
const { DialogSelect } = await import("../src/cli/tui/ui/dialog-select")
const { Keybinds } = await import("../src/config/schema")
const { createEffect, createSignal } = await import("solid-js")
const { DialogPrivateGpuConnect } = await import("../src/cli/tui/component/dialog-private-gpu")
const { PRIVATE_GPU_VENDORS } = await import("../src/provider/private-gpu/presets")
const { DialogImagePreview } = await import("../src/cli/tui/ui/dialog-image-preview")
const { ImagePreviewLink } = await import("../src/cli/tui/ui/image-preview-link")
const { ImageRenderable, TextareaRenderable, getCommandRegistry } = await import("ax-tui")

const { useSessionImagePreview, sessionImageAttachments } = await import("../src/cli/tui/routes/session/image-preview")
const [imageSession, setImageSession] = createSignal("session_preview")
const [imageMessages, setImageMessages] = createSignal<readonly Pick<Message, "id" | "role">[]>([])
const [imageParts, setImageParts] = createSignal<Record<string, Part[]>>({})
let openImage!: ReturnType<typeof useSessionImagePreview>
const [probeTitle, setProbeTitle] = createSignal("Async probe")
const [probeEnabled, setProbeEnabled] = createSignal(true)
let commandAPI!: ReturnType<typeof useCommandDialog>
let commandScope = "session-a"
let commandAction: (dialog: ReturnType<typeof useDialog>) => Promise<void> = async () => {}
let slashAction: (args: string, dialog: ReturnType<typeof useDialog>) => Promise<void> = async () => {}
const duplicateCalls: string[] = []
let dialog!: ReturnType<typeof useDialog>
let kvStore!: ReturnType<typeof useKV>
let ready = false
let backgroundCommands = 0
function findRenderable(node: Renderable, matches: (node: Renderable) => boolean): Renderable | undefined {
  if (matches(node)) return node
  for (const child of node.getChildren()) {
    const found = findRenderable(child, matches)
    if (found) return found
  }
}
function Controls() {
  dialog = useDialog()
  const kv = useKV()
  kvStore = kv
  commandAPI = useCommandDialog()
  commandAPI.setScope(() => commandScope)
  openImage = useSessionImagePreview({ sessionID: imageSession, messages: imageMessages, parts: imageParts })
  commandAPI.register(() => [
    {
      title: probeTitle(),
      value: "test.async",
      enabled: probeEnabled(),
      slash: { name: "probe", aliases: ["probe-alias"], arguments: true },
      onSelect: (api) => commandAction(api),
      onSlashArguments: (args, api) => slashAction(args, api),
    },
    {
      title: "Duplicate",
      value: "test.duplicate-one",
      onSelect: () => {
        duplicateCalls.push("one")
      },
    },
    {
      title: "Duplicate",
      value: "test.duplicate-two",
      onSelect: () => {
        duplicateCalls.push("two")
      },
    },
    {
      title: "Background command probe",
      value: "test.background-command",
      keybind: "session_new",
      onSelect: () => backgroundCommands++,
    },
  ])
  createEffect(() => {
    ready = kv.ready
  })
  return null
}
function Providers(props: ParentProps) {
  return (
    <KVProvider>
      <TuiConfigProvider config={{ keybinds: Keybinds.parse({}) }}>
        <LanguageProvider>
          <ToastProvider>
            <ThemeProvider mode="dark">
              <KeybindProvider>
                <DialogProvider>
                  <CommandProvider>
                    <Controls />
                    {props.children}
                    <DialogStack />
                  </CommandProvider>
                </DialogProvider>
              </KeybindProvider>
            </ThemeProvider>
          </ToastProvider>
        </LanguageProvider>
      </TuiConfigProvider>
    </KVProvider>
  )
}

const setup = await testRender(() => <Providers />, { width: 80, height: 30, exitOnCtrlC: false })
try {
  const deadline = Date.now() + 5000
  while (!ready && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    await setup.flush()
  }
  assert(ready)
  const background = new InputRenderable(setup.renderer, { id: "background-editor", width: 30 })
  setup.renderer.root.add(background)
  background.focus()
  let confirmed = 0
  for (let repeat = 0; repeat < 3; repeat++) {
    dialog.replace(() => (
      <DialogPrivateGpuConnect
        vendor={PRIVATE_GPU_VENDORS[0]!}
        defaultBaseURL="https://gpu.example.com/v1"
        onConfirm={() => {
          confirmed++
        }}
      />
    ))
    await setup.flush()
    const first = setup.renderer.currentFocusedRenderable
    assert(first instanceof TextareaRenderable)
    setup.mockInput.pressKey("TAB")
    await setup.flush()
    const second = setup.renderer.currentFocusedRenderable
    assert(second instanceof TextareaRenderable && second !== first)
    setup.mockInput.pressKey("TAB", { shift: true })
    await setup.flush()
    assert.equal(setup.renderer.currentFocusedRenderable, first)
    await setup.mockMouse.click(second.x + 1, second.y + 1, MouseButton.LEFT)
    await setup.flush()
    assert.equal(setup.renderer.currentFocusedRenderable, second)
    second.setText("test-token")
    setup.mockInput.pressKey("RETURN")
    await setup.flush()
    assert.equal(confirmed, repeat + 1, "mouse focus must update the field used by Enter")
    setup.mockInput.pressKey("ESCAPE")
    await new Promise((resolve) => setTimeout(resolve, 150))
    await setup.flush()
    assert.equal(
      dialog.stack.length,
      0,
      `connection Escape selected=${setup.renderer.getSelection()?.getSelectedText().length ?? 0}`,
    )
    assert.equal(setup.renderer.currentFocusedRenderable, background)
  }
  const valid = {
    id: "file_preview",
    sessionID: "session_preview",
    messageID: "message_preview",
    type: "file" as const,
    mime: "image/png",
    filename: "preview.png",
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR4nGNgCPj/H4xhDABLsgk56rbLVwAAAABJRU5ErkJggg==",
  }
  let linkClicks = 0
  dialog.replace(() => (
    <box
      id="image-link-probe"
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
    >
      <ImagePreviewLink
        file={valid}
        fg={RGBA.fromInts(255, 255, 255)}
        onOpen={() => {
          linkClicks++
        }}
      >
        Preview attachment
      </ImagePreviewLink>
    </box>
  ))
  await setup.flush()
  const link = findRenderable(setup.renderer.root, (node) => node.id === "image-link-probe")!.getChildren()[0]!
  await setup.mockMouse.click(link.x + 1, link.y, MouseButton.RIGHT)
  assert.equal(linkClicks, 0, "right-click must not open a preview")
  await setup.mockMouse.drag(link.x + 1, link.y, link.x + 5, link.y, MouseButton.LEFT)
  assert.equal(linkClicks, 0, "selecting attachment text must not open a preview")
  setup.renderer.clearSelection()
  await setup.mockMouse.click(link.x + 1, link.y, MouseButton.LEFT)
  assert.equal(linkClicks, 1, "a left click must open the preview")
  dialog.clear()
  await setup.flush()
  let listeners = 0
  for (let repeat = 0; repeat < 20; repeat++) {
    dialog.replace(() => <DialogImagePreview file={valid} />)
    await setup.flush()
    const preview = findRenderable(setup.renderer.root, (node) => node instanceof ImageRenderable)
    assert(preview instanceof ImageRenderable)
    await preview.loadPromise
    await setup.flush()
    assert.equal(preview.loadError, null)
    assert.equal(preview.effectiveProtocol, "blocks")
    assert(setup.captureCharFrame().includes("preview.png"))
    dialog.clear()
    await setup.flush()
    assert(preview.isDestroyed)
    if (repeat === 0) listeners = setup.renderer.listenerCount("frame")
    assert.equal(setup.renderer.listenerCount("frame"), listeners, "preview must release frame listeners")
  }
  dialog.replace(() => <DialogImagePreview file={{ ...valid, mime: "image/jpeg" }} />)
  await setup.flush()
  assert(setup.captureCharFrame().includes("failed to render"))
  dialog.clear()
  await setup.flush()
  assert.equal(setup.renderer.currentFocusedRenderable, background)
  const completed: Part = {
    id: "tool_completed",
    sessionID: "session_preview",
    messageID: "assistant_preview",
    type: "tool",
    callID: "completed",
    tool: "image_gen",
    state: {
      status: "completed",
      input: {},
      output: "Image created",
      title: "Generated image",
      metadata: {},
      time: { start: 1, end: 2 },
      attachments: [{ ...valid, id: "file_generated" }],
    },
  }
  const pending: Part = { ...completed, id: "tool_pending", state: { status: "pending", input: {}, raw: "" } }
  setImageMessages([
    { id: "message_preview", role: "user" },
    { id: "assistant_preview", role: "assistant" },
  ])
  setImageParts({
    message_preview: [
      valid,
      { ...valid, id: "jpeg", mime: "image/jpeg" },
      { ...valid, id: "remote", url: "https://example.com/image.png" },
    ],
    assistant_preview: [completed, pending],
  })
  await setup.flush()
  assert.equal(
    sessionImageAttachments(imageMessages(), imageParts()).length,
    2,
    "pending tools and unsupported or remote images must not be offered",
  )
  assert(commandAPI.trySlash("images"))
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await setup.flush()
  assert.equal(dialog.stack.length, 1, "images command must open its picker")
  setup.mockInput.pressKey("HOME")
  await setup.flush()
  setup.mockInput.pressKey("RETURN")
  await new Promise((resolve) => setImmediate(resolve))
  await setup.flush()
  const keyboardImage = findRenderable(setup.renderer.root, (node) => node instanceof ImageRenderable)
  assert(
    keyboardImage instanceof ImageRenderable,
    `/images must open a preview from keyboard selection: stack=${dialog.stack.length}, files=${sessionImageAttachments(imageMessages(), imageParts()).length}, ${setup.captureCharFrame()}`,
  )
  await keyboardImage.loadPromise
  setImageSession("another-session")
  await setup.flush()
  assert.equal(dialog.stack.length, 0, "switching sessions must close the owned preview")
  assert(keyboardImage.isDestroyed)
  openImage(valid)
  await setup.flush()
  assert.equal(dialog.stack.length, 0, "a stale row must not reopen another session's image")
  setImageSession("session_preview")
  await setup.flush()
  openImage(valid)
  await setup.flush()
  setImageParts({})
  await setup.flush()
  assert.equal(dialog.stack.length, 0, "removing an attachment must retire its preview")
  const registry = getCommandRegistry(setup.renderer)
  const recoveryEntries = [
    { value: "test.registry-first", title: "First" },
    { value: "test.registry-second", title: "Second" },
    { value: "\ud800", title: "\u001b[0m" },
    { value: "\udfff", title: "Unicode identity" },
  ]
  const recovery = createCommandExecutor({
    renderer: setup.renderer,
    entries: () => recoveryEntries,
    scope: () => "registry-recovery",
    dialog,
    record: () => {},
  })
  const removeCollision = registry.register({
    id: "ax-code.command/test.registry-second/0",
    title: "Occupied",
    run: () => {},
  })
  assert.throws(() => recovery.sync(), /unique/)
  assert(
    !registry.search("test.registry-first").some((entry) => entry.id.includes("test.registry-first")),
    "partial registration must be rolled back",
  )
  removeCollision()
  recovery.sync()
  assert.equal((await recovery.execute(recoveryEntries[0]!, "trigger")).status, "executed")
  assert.equal((await recovery.execute(recoveryEntries[0]!, "trigger", "invalid arguments")).status, "disabled")
  assert.equal((await recovery.execute(recoveryEntries[2]!, "trigger")).status, "executed")
  assert.equal((await recovery.execute(recoveryEntries[3]!, "trigger")).status, "executed")
  recovery.dispose()
  const completion = Promise.withResolvers<void>()
  let actionCalls = 0
  commandAction = async () => {
    actionCalls++
    await completion.promise
  }
  const actionResult = commandAPI.trigger("test.async")
  let settled = false
  void actionResult?.then(() => {
    settled = true
  })
  await setup.flush()
  assert.equal(actionCalls, 1)
  assert.equal(settled, false, "registry must await the actual async handler")
  completion.resolve()
  assert.equal((await actionResult)?.status, "executed")
  assert.equal((kvStore.get("slash_command_frecency") as Record<string, { count: number }>)["test.async"].count, 1)
  assert.equal(registry.search("Duplicate").length, 2)
  await commandAPI.trigger("test.duplicate-one")
  await commandAPI.trigger("test.duplicate-two")
  assert.deepEqual(duplicateCalls, ["one", "two"])
  setProbeTitle("Renamed probe")
  await setup.flush()
  const metadata = registry.search("test.async").find((entry) => entry.id.includes("test.async"))!
  assert.equal(metadata.title, "Renamed probe")
  setProbeEnabled(false)
  await setup.flush()
  assert.equal((await registry.execute(metadata.id)).status, "disabled")
  assert.equal(actionCalls, 1)
  setProbeEnabled(true)
  await setup.flush()
  commandAction = async () => {
    throw new Error("Expected command failure")
  }
  assert.equal((await commandAPI.trigger("test.async"))?.status, "error")
  commandAction = async () => {
    actionCalls++
  }
  const stale = commandAPI.trigger("test.async")
  commandScope = "session-b"
  assert.equal((await stale)?.status, "stale-context")
  assert.equal(actionCalls, 1)
  let seenArgs = ""
  slashAction = async (args) => {
    seenArgs = args
  }
  assert(commandAPI.trySlashWithArguments("probe-alias", "  preserve  spaces "))
  await setup.flush()
  assert.equal(seenArgs, "  preserve  spaces ")
  const delayed = Promise.withResolvers<void>()
  let cancelled = false
  commandAction = async (api) => {
    await delayed.promise
    api.replace(
      () => <text>Stale dialog</text>,
      () => {
        cancelled = true
      },
    )
  }
  const late = commandAPI.trigger("test.async")
  await setup.flush()
  commandScope = "session-c"
  dialog.replace(() => <text>Current dialog</text>)
  const currentDialog = dialog.stack.at(-1)
  delayed.resolve()
  await late
  assert.equal(dialog.stack.at(-1), currentDialog)
  assert(cancelled, "stale async dialog prompts must settle as cancelled")
  dialog.clear()
  await setup.flush()
  const ownedCompletion = Promise.withResolvers<void>()
  commandAction = async (api) => {
    api.replace(() => <text>Command loading</text>)
    await ownedCompletion.promise
    api.clear()
  }
  const ownedAction = commandAPI.trigger("test.async")
  await setup.flush()
  assert.equal(dialog.stack.length, 1)
  commandScope = "session-d"
  ownedCompletion.resolve()
  await ownedAction
  assert.equal(dialog.stack.length, 0, "a late command may close the dialog it created before navigation")
  const pickedCompletion = Promise.withResolvers<void>()
  let pickedCalls = 0
  commandAction = async () => {
    pickedCalls++
    await pickedCompletion.promise
  }
  const usageBefore = (kvStore.get("slash_command_frecency") as Record<string, { count: number }>)["test.async"].count
  commandAPI.show()
  await setup.flush()
  const commandSearch = setup.renderer.currentFocusedRenderable
  assert(commandSearch instanceof InputRenderable, "command picker must focus its search input")
  commandSearch.value = "Renamed probe"
  await setup.flush()
  setup.mockInput.pressKey("HOME")
  setup.mockInput.pressKey("RETURN")
  setup.mockInput.pressKey("RETURN")
  await new Promise((resolve) => setImmediate(resolve))
  await setup.flush()
  assert.equal(pickedCalls, 1, "repeated Enter must await the real registry handler")
  assert.equal(
    (kvStore.get("slash_command_frecency") as Record<string, { count: number }>)["test.async"].count,
    usageBefore + 1,
  )
  pickedCompletion.resolve()
  dialog.clear()
  await setup.flush()
  for (const length of [4, 120]) {
    let boundaryPicked = -1
    const boundaryOptions = Array.from({ length }, (_, value) => ({
      value,
      title: `Boundary ${value}`,
      disabled: value === 0 || value === length - 1,
    }))
    dialog.replace(() => (
      <DialogSelect
        title="Disabled boundary picker"
        options={boundaryOptions}
        onSelect={(option) => {
          boundaryPicked = option.value
        }}
      />
    ))
    await setup.flush()
    setup.mockInput.pressKey("END")
    await setup.flush()
    setup.mockInput.pressKey("RETURN")
    await setup.flush()
    assert.equal(boundaryPicked, length - 2, `End must select the last enabled option in a ${length}-row picker`)
    setup.mockInput.pressKey("HOME")
    await setup.flush()
    setup.mockInput.pressKey("RETURN")
    await setup.flush()
    assert.equal(boundaryPicked, 1, "Home must select the first enabled option")
    dialog.clear()
    await setup.flush()
  }
  const [delayedOptions, setDelayedOptions] = createSignal<{ title: string; value: number }[]>([])
  let delayedPicked = -1
  dialog.replace(() => (
    <DialogSelect
      title="Delayed current value"
      current={2}
      options={delayedOptions()}
      onSelect={(option) => {
        delayedPicked = option.value
      }}
    />
  ))
  await setup.flush()
  setDelayedOptions(Array.from({ length: 4 }, (_, value) => ({ title: `Loaded ${value}`, value })))
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 160))
  setup.mockInput.pressKey("RETURN")
  await setup.flush()
  assert.equal(delayedPicked, 2, "options loaded after mount must select the current value")
  setup.mockInput.pressKey("ARROW_DOWN")
  await setup.flush()
  setDelayedOptions((options) => options.map((option) => ({ ...option, title: `${option.title}!` })))
  await setup.flush()
  setup.mockInput.pressKey("RETURN")
  await setup.flush()
  assert.equal(delayedPicked, 3, "unrelated option updates must preserve manual navigation")
  dialog.clear()
  await setup.flush()
  const options = Array.from({ length: 5000 }, (_, index) => ({
    value: `entry-${index}`,
    title: `Entry ${String(index).padStart(5, "0")}`,
    category: `Group ${String(Math.floor(index / 100)).padStart(2, "0")}`,
  }))
  let picked = ""
  const opened = performance.now()
  dialog.replace(() => (
    <DialogSelect
      title="Large picker"
      options={options}
      onSelect={(option) => {
        picked = option.value
      }}
    />
  ))
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await setup.flush()
  const openMs = performance.now() - opened
  const firstFrame = setup.captureCharFrame()
  const countRows = (node: Renderable): number =>
    (node.id.startsWith("dialog-select-option-") ? 1 : 0) +
    node.getChildren().reduce((total, child) => total + countRows(child), 0)
  const mountedRows = countRows(setup.renderer.root)
  const scrolled = performance.now()
  setup.mockInput.pressKey("END")
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await setup.flush()
  const endMs = performance.now() - scrolled
  const lastFrame = setup.captureCharFrame()
  assert(lastFrame.includes("Entry 04999"))
  const expected = (await import("../test/fixture/tui-large-picker.json", { with: { type: "json" } })).default
  assert.equal(firstFrame, expected.firstFrame)
  assert.equal(lastFrame, expected.lastFrame)
  assert(mountedRows < 100, "large picker must bound mounted rows")
  const mouseRow = findRenderable(setup.renderer.root, (node) => node.id === "dialog-select-option-4998")!
  assert(mouseRow, "the penultimate virtual row must be mounted for a mouse click")
  await setup.mockMouse.click(mouseRow.x + 4, mouseRow.y, MouseButton.LEFT)
  await setup.flush()
  assert.equal(picked, "entry-4998", "virtual rows must retain mouse hit testing")
  setup.mockInput.pressKey("PAGEUP")
  await setup.flush()
  const virtual = findRenderable(setup.renderer.root, (node) => node instanceof VirtualListRenderable)
  assert(virtual instanceof VirtualListRenderable, "Page Up must retain the virtual list")
  assert(virtual.mountedCount < 100)
  const search = findRenderable(setup.renderer.root, (node) => node instanceof InputRenderable && node !== background)
  assert(search instanceof InputRenderable, "picker search input must remain mounted")
  await setup.mockMouse.click(search.x + 1, search.y, MouseButton.LEFT)
  await setup.flush()
  assert.equal(setup.renderer.currentFocusedRenderable, search)
  search.value = "Entry 00042"
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await setup.flush()
  assert.equal(countRows(setup.renderer.root), 1)
  assert(!findRenderable(setup.renderer.root, (node) => node instanceof VirtualListRenderable))
  assert(setup.captureCharFrame().includes("Entry 00042"))
  const benchmark = { openMs, endMs, mountedRows, firstFrame, lastFrame }
  const benchmarkPath = process.env.AX_TUI_PICKER_BENCHMARK
  if (benchmarkPath) await fs.writeFile(benchmarkPath, JSON.stringify(benchmark, null, 2))
  console.log(`Large picker: ${mountedRows} mounted rows; open ${openMs.toFixed(1)}ms; End ${endMs.toFixed(1)}ms`)
  dialog.clear()
  await setup.flush()
  background.destroyRecursively()
  const shutdown = createCommandExecutor({
    renderer: setup.renderer,
    entries: () => recoveryEntries,
    scope: () => "shutdown",
    dialog,
    record: () => {},
  })
  shutdown.sync()
  setup.renderer.destroy()
  assert.equal((await shutdown.execute(recoveryEntries[0]!, "trigger")).status, "disposed")
  shutdown.dispose()
  console.log(
    "AX TUI 2.1 adoption: modal Tab/Shift+Tab, mouse field focus, prompt restoration, PNG fallback/error, repeated disposal, command execution and picker parity passed",
  )
} finally {
  setup.renderer.destroy()
  await fs.rm(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
