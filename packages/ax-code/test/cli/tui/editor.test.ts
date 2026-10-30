import { access, writeFile } from "node:fs/promises"
import type { CliRenderer } from "ax-tui"
import { afterEach, expect, test, vi } from "vitest"
import { Process } from "../../../src/util/process"
import { Editor } from "../../../src/cli/tui/util/editor"
import { disposeTuiProgramChrome, updateTuiProgramChrome } from "../../../src/cli/tui/program-chrome"

afterEach(() => {
  disposeTuiProgramChrome()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test("the external editor owns the terminal until it returns", async () => {
  vi.useFakeTimers()
  vi.stubEnv("VISUAL", "test-editor")
  const writes: string[] = []
  updateTuiProgramChrome(
    { enabled: true, busy: true, animations: true, statusText: "Working" },
    {
      owner: writes,
      env: { TERM_PROGRAM: "Akitty" },
      isTTY: true,
      write: (sequence) => {
        writes.push(sequence)
        return true
      },
      onError: vi.fn(),
    },
  )
  let finish!: (code: number) => void
  const exited = new Promise<number>((resolve) => {
    finish = resolve
  })
  const spawn = vi.spyOn(Process, "spawn").mockReturnValue({ exited } as Process.Child)
  const renderer = {
    suspend: vi.fn(),
    resume: vi.fn(),
    requestRender: vi.fn(),
    currentRenderBuffer: { clear: vi.fn() },
  }
  const editing = Editor.open({ value: "draft", renderer: renderer as unknown as CliRenderer })
  try {
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    const count = writes.length
    vi.advanceTimersByTime(1000)
    expect(writes).toHaveLength(count)
  } finally {
    finish(0)
    await editing
  }
  const count = writes.length
  vi.advanceTimersByTime(250)
  expect(writes.length).toBeGreaterThan(count)
})

test.each([0, 7])("external editor exit %i controls whether draft edits are accepted", async (code) => {
  vi.stubEnv("VISUAL", "test-editor")
  let temporaryFile = ""
  vi.spyOn(Process, "spawn").mockImplementation((command) => {
    temporaryFile = command.at(-1)!
    return {
      exited: writeFile(temporaryFile, "partial editor changes").then(() => code),
    } as Process.Child
  })
  const renderer = {
    suspend: vi.fn(),
    resume: vi.fn(),
    requestRender: vi.fn(),
    currentRenderBuffer: { clear: vi.fn() },
  }

  const result = await Editor.open({ value: "original draft", renderer: renderer as unknown as CliRenderer })

  expect(result).toEqual(code === 0 ? { status: "saved", content: "partial editor changes" } : { status: "cancelled" })
  expect(renderer.suspend).toHaveBeenCalledOnce()
  expect(renderer.resume).toHaveBeenCalledOnce()
  expect(renderer.requestRender).toHaveBeenCalledOnce()
  await expect(access(temporaryFile)).rejects.toMatchObject({ code: "ENOENT" })
})
