import { beforeEach, expect, test, vi } from "vitest"
import { resolveRenderLib } from "../src/core/zig.js"
import { Audio } from "../src/core/audio.js"

vi.mock("../src/core/zig.js", () => ({ resolveRenderLib: vi.fn() }))

const lib = {
  createAudioEngine: vi.fn(),
  audioStart: vi.fn(),
  audioStartMixer: vi.fn(),
  audioStop: vi.fn(),
  destroyAudioEngine: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveRenderLib).mockReturnValue(lib as never)
  lib.createAudioEngine.mockReturnValue({} as never)
  lib.audioStart.mockReturnValue(0)
  lib.audioStartMixer.mockReturnValue(0)
  lib.audioStop.mockReturnValue(0)
})

test("createAudioEngine failure reaches a listener attached after create", async () => {
  lib.createAudioEngine.mockReturnValue(null as never)

  const audio = Audio.create()
  const onError = vi.fn()
  audio.on("error", onError)
  await Promise.resolve()

  expect(onError).toHaveBeenCalledTimes(1)
  const [error, ctx] = onError.mock.calls[0]!
  expect(ctx.action).toBe("createAudioEngine")
  expect(error.message).toMatch(/returned null/)
})

test("autoStart failure during construction reaches a listener attached after create", async () => {
  lib.audioStart.mockReturnValue(5)

  const audio = Audio.create({ autoStart: true })
  const onError = vi.fn()
  audio.on("error", onError)
  await Promise.resolve()

  expect(audio.isStarted()).toBe(false)
  expect(onError).toHaveBeenCalledTimes(1)
  const [, ctx] = onError.mock.calls[0]!
  expect(ctx).toMatchObject({ action: "start", status: 5 })
})

test("start after startMixer does not emit a second mixerStarted", () => {
  const audio = Audio.create()
  const onStarted = vi.fn()
  const onMixerStarted = vi.fn()
  audio.on("started", onStarted)
  audio.on("mixerStarted", onMixerStarted)

  expect(audio.startMixer()).toBe(true)
  expect(onMixerStarted).toHaveBeenCalledTimes(1)

  expect(audio.start()).toBe(true)
  expect(onStarted).toHaveBeenCalledTimes(1)
  expect(onMixerStarted).toHaveBeenCalledTimes(1)

  audio.dispose()
})

test("start on a fresh engine emits started and mixerStarted once each", () => {
  const audio = Audio.create()
  const onStarted = vi.fn()
  const onMixerStarted = vi.fn()
  audio.on("started", onStarted)
  audio.on("mixerStarted", onMixerStarted)

  expect(audio.start()).toBe(true)
  expect(onStarted).toHaveBeenCalledTimes(1)
  expect(onMixerStarted).toHaveBeenCalledTimes(1)

  audio.dispose()
})
