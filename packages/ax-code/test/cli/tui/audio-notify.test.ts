import { describe, expect, test } from "vitest"

import { createAudioNotifier, speechText } from "../../../src/cli/cmd/tui/util/audio-notify"
import type { AudioNotifyDeps, AudioNotifyInput, AudioNotifySettings } from "../../../src/cli/cmd/tui/util/audio-notify"

type SpawnCall = { cmd: string[]; opts: { timeout: number; unref: boolean } }

const MACOS_CHIME = "/System/Library/Sounds/Glass.aiff"
const WINDOWS_CHIME = "C:\\Windows\\Media\\Windows Notify System Generic.wav"
const LINUX_CHIME = "/usr/share/sounds/freedesktop/stereo/complete.oga"

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await flush()
}

function fakeClock(start = 1_000_000) {
  let current = start
  const timers: { at: number; fire: () => void }[] = []
  return {
    now: () => current,
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ at: current + ms, fire: fn })
    },
    advance: async (ms: number) => {
      current += ms
      for (;;) {
        const due = timers.filter((timer) => timer.at <= current).sort((a, b) => a.at - b.at)
        if (due.length === 0) break
        for (const timer of due) {
          timers.splice(timers.indexOf(timer), 1)
          timer.fire()
        }
        await settle()
      }
      await settle()
    },
  }
}

// Controllable spawner: every spawn records its argv and parks on a manually
// resolved `exited` promise, mirroring Process.Child.
function fakeSpawn() {
  const calls: SpawnCall[] = []
  const exits: ((code: number) => void)[] = []
  const spawn: AudioNotifyDeps["spawn"] = (cmd, opts) => {
    calls.push({ cmd: [...cmd], opts })
    const exited = new Promise<number>((resolve) => exits.push(resolve))
    return { exited }
  }
  const finish = (code = 0) => {
    exits.shift()?.(code)
  }
  return { spawn, calls, finish }
}

const lookup = (available: string[]) => (cmd: string) => (available.includes(cmd) ? `/usr/bin/${cmd}` : null)

const files = (existing: string[]) => (path: string) => existing.includes(path)

const settings = (overrides: Partial<AudioNotifySettings> = {}): AudioNotifySettings => ({
  enabled: true,
  sound: "chime",
  ...overrides,
})

function notifier(input: {
  spawn?: AudioNotifyDeps["spawn"]
  platform?: string
  available?: string[]
  existing?: string[]
  clock?: ReturnType<typeof fakeClock>
}) {
  const clock = input.clock ?? fakeClock()
  const spawner = input.spawn ?? fakeSpawn().spawn
  const instance = createAudioNotifier({
    spawn: spawner,
    platform: input.platform ?? "darwin",
    which: lookup(input.available ?? []),
    fileExists: files(input.existing ?? []),
    now: clock.now,
    setTimeout: clock.setTimeout,
  })
  return { instance, clock }
}

const notify = (instance: ReturnType<typeof createAudioNotifier>, input: Partial<AudioNotifyInput> = {}) =>
  instance.notify({ kind: "permission", source: "bash", settings: settings(), ...input })

describe("speechText", () => {
  test("templates the permission name", () => {
    expect(speechText("permission", "bash")).toBe("Approval required: bash")
  })

  test("templates the question text and falls back when empty", () => {
    expect(speechText("question", "Deploy to prod?")).toBe("Question: Deploy to prod?")
    expect(speechText("question", "   ")).toBe("Question")
    expect(speechText("question")).toBe("Question")
  })

  test("templates the session title", () => {
    expect(speechText("complete", "fix the login bug")).toBe("Task complete: fix the login bug")
    expect(speechText("complete")).toBe("Task complete")
  })

  test("caps the session title at 80 code units before templating", () => {
    const title = "x".repeat(200)
    expect(speechText("complete", title)).toBe(`Task complete: ${"x".repeat(80)}`)
  })

  test("always speaks the fixed error phrase", () => {
    expect(speechText("error", "ENOENT /secret/path with credentials")).toBe("AX Code error")
    expect(speechText("error")).toBe("AX Code error")
  })

  test("strips control characters and collapses whitespace", () => {
    expect(speechText("question", "line\none\x00  two\x7fthree")).toBe("Question: line one two three")
    expect(speechText("permission", "ba\tsh\x1b[0m")).toBe("Approval required: ba sh [0m")
  })

  test("caps speech at 120 code units", () => {
    const result = speechText("question", "y".repeat(300))
    expect(result.length).toBe(120)
    expect(result.startsWith("Question: y")).toBe(true)
  })
})

describe("backend probe", () => {
  test("darwin chime plays the system sound with afplay", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({ spawn: spawner.spawn, available: ["afplay", "say"], existing: [MACOS_CHIME] })
    notify(instance)
    await settle()
    expect(spawner.calls).toEqual([{ cmd: ["afplay", MACOS_CHIME], opts: { timeout: 20_000, unref: true } }])
  })

  test("darwin chime requires the sound file to exist", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({ spawn: spawner.spawn, available: ["afplay", "say"], existing: [] })
    notify(instance)
    await settle()
    expect(spawner.calls).toEqual([])
  })

  test("darwin speak uses say with the templated text", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({ spawn: spawner.spawn, available: ["afplay", "say"], existing: [MACOS_CHIME] })
    notify(instance, {
      kind: "complete",
      source: "fix the bug",
      settings: settings({ sound: "speak", events: { complete: true } }),
    })
    await settle()
    expect(spawner.calls[0].cmd).toEqual(["say", "Task complete: fix the bug"])
  })

  test("darwin speak emits -v and -r only when configured", async () => {
    const variants: { opts: Partial<AudioNotifySettings>; cmd: string[] }[] = [
      { opts: { voice: "Samantha" }, cmd: ["say", "-v", "Samantha", "Approval required: bash"] },
      { opts: { rate: 180 }, cmd: ["say", "-r", "180", "Approval required: bash"] },
      {
        opts: { voice: "Samantha", rate: 180 },
        cmd: ["say", "-v", "Samantha", "-r", "180", "Approval required: bash"],
      },
      { opts: { voice: "", rate: 0 }, cmd: ["say", "Approval required: bash"] },
      // clamped to the 1..500 words/min range at the use site
      { opts: { rate: 1000 }, cmd: ["say", "-r", "500", "Approval required: bash"] },
    ]
    for (const variant of variants) {
      const spawner = fakeSpawn()
      const { instance } = notifier({ spawn: spawner.spawn, available: ["say"], existing: [] })
      notify(instance, { settings: settings({ sound: "speak", ...variant.opts }) })
      await settle()
      expect(spawner.calls[0].cmd).toEqual(variant.cmd)
    }
  })

  test("win32 chime plays the system sound through PowerShell", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({
      spawn: spawner.spawn,
      platform: "win32",
      available: ["powershell"],
      existing: [WINDOWS_CHIME],
    })
    notify(instance)
    await settle()
    expect(spawner.calls[0].cmd).toEqual([
      "powershell",
      "-NoProfile",
      "-Command",
      "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\Windows Notify System Generic.wav').PlaySync()",
    ])
  })

  test("win32 speak escapes single quotes by doubling them", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({
      spawn: spawner.spawn,
      platform: "win32",
      available: ["powershell"],
      existing: [WINDOWS_CHIME],
    })
    notify(instance, {
      kind: "question",
      source: `it's "ready"`,
      // voice/rate have no knob in the System.Speech backend and are ignored
      settings: settings({ sound: "speak", voice: "Zira", rate: 200 }),
    })
    await settle()
    expect(spawner.calls[0].cmd).toEqual([
      "powershell",
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('Question: it''s "ready"')`,
    ])
  })

  test("win32 chime requires the wav file to exist", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({ spawn: spawner.spawn, platform: "win32", available: ["powershell"], existing: [] })
    notify(instance)
    await settle()
    expect(spawner.calls).toEqual([])
  })

  test("linux chime prefers paplay with the freedesktop sound", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({
      spawn: spawner.spawn,
      platform: "linux",
      available: ["paplay", "canberra-gtk-play"],
      existing: [LINUX_CHIME],
    })
    notify(instance)
    await settle()
    expect(spawner.calls[0].cmd).toEqual(["paplay", LINUX_CHIME])
  })

  test("linux chime falls back to canberra-gtk-play", async () => {
    for (const input of [
      { available: ["canberra-gtk-play"], existing: [LINUX_CHIME] },
      // paplay without the sound file is not a usable backend
      { available: ["paplay", "canberra-gtk-play"], existing: [] },
    ]) {
      const spawner = fakeSpawn()
      const { instance } = notifier({ spawn: spawner.spawn, platform: "linux", ...input })
      notify(instance)
      await settle()
      expect(spawner.calls[0].cmd).toEqual(["canberra-gtk-play", "-i", "complete"])
    }
  })

  test("linux speak prefers spd-say and falls back to espeak-ng", async () => {
    const first = fakeSpawn()
    const a = notifier({ spawn: first.spawn, platform: "linux", available: ["spd-say", "espeak-ng"], existing: [] })
    notify(a.instance, { settings: settings({ sound: "speak" }) })
    await settle()
    expect(first.calls[0].cmd).toEqual(["spd-say", "Approval required: bash"])

    const second = fakeSpawn()
    const b = notifier({ spawn: second.spawn, platform: "linux", available: ["espeak-ng"], existing: [] })
    notify(b.instance, { settings: settings({ sound: "speak" }) })
    await settle()
    expect(second.calls[0].cmd).toEqual(["espeak-ng", "Approval required: bash"])
  })

  test("is a silent no-op when no backend exists", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({ spawn: spawner.spawn, platform: "linux", available: [], existing: [] })
    expect(notify(instance)).toBeUndefined()
    expect(notify(instance, { settings: settings({ sound: "speak" }) })).toBeUndefined()
    await settle()
    expect(spawner.calls).toEqual([])
  })

  test("is a silent no-op on unknown platforms", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({ spawn: spawner.spawn, platform: "freebsd", available: ["afplay", "say"] })
    notify(instance)
    await settle()
    expect(spawner.calls).toEqual([])
  })

  test("probes capability once and caches it", async () => {
    const spawner = fakeSpawn()
    let probes = 0
    const clock = fakeClock()
    const instance = createAudioNotifier({
      spawn: spawner.spawn,
      platform: "darwin",
      which: (cmd) => {
        probes += 1
        return lookup(["afplay", "say"])(cmd)
      },
      fileExists: files([MACOS_CHIME]),
      now: clock.now,
      setTimeout: clock.setTimeout,
    })
    notify(instance, { key: "one" })
    await settle()
    const afterFirst = probes
    spawner.finish()
    await clock.advance(2_000)
    notify(instance, { key: "two" })
    await settle()
    expect(afterFirst).toBeGreaterThan(0)
    expect(probes).toBe(afterFirst)
    expect(spawner.calls).toHaveLength(2)
  })
})

describe("playback queue", () => {
  test("is fire-and-forget: notify returns without awaiting playback", () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({ spawn: spawner.spawn, available: ["afplay", "say"], existing: [MACOS_CHIME] })
    expect(notify(instance)).toBeUndefined()
    // The first play starts synchronously; the caller never waits for exit.
    expect(spawner.calls).toHaveLength(1)
  })

  test("serializes playback: one in flight, then the pending item", async () => {
    const spawner = fakeSpawn()
    const { instance, clock } = notifier({ spawn: spawner.spawn, available: ["say"], existing: [] })
    const speak = settings({ sound: "speak", events: { complete: true } })
    notify(instance, { kind: "complete", source: "one", settings: speak })
    notify(instance, { kind: "complete", source: "two", settings: speak })
    await settle()
    expect(spawner.calls).toHaveLength(1)
    expect(spawner.calls[0].cmd).toEqual(["say", "Task complete: one"])

    spawner.finish()
    await clock.advance(2_000)
    expect(spawner.calls).toHaveLength(2)
    expect(spawner.calls[1].cmd).toEqual(["say", "Task complete: two"])
  })

  test("enforces a minimum 2s gap between play starts", async () => {
    const spawner = fakeSpawn()
    const { instance, clock } = notifier({
      spawn: spawner.spawn,
      available: ["afplay", "say"],
      existing: [MACOS_CHIME],
    })
    notify(instance, { key: "first" })
    spawner.finish()
    await settle()
    expect(spawner.calls).toHaveLength(1)

    notify(instance, { key: "second" })
    await settle()
    expect(spawner.calls).toHaveLength(1)
    await clock.advance(1_999)
    expect(spawner.calls).toHaveLength(1)
    await clock.advance(1)
    expect(spawner.calls).toHaveLength(2)
  })

  test("a new trigger of the same kind replaces the pending item", async () => {
    const spawner = fakeSpawn()
    const { instance, clock } = notifier({ spawn: spawner.spawn, available: ["say"], existing: [] })
    const speak = settings({ sound: "speak" })
    notify(instance, { kind: "permission", source: "edit", settings: speak })
    notify(instance, { kind: "permission", source: "bash", settings: speak })
    notify(instance, { kind: "permission", source: "grep", settings: speak })
    await settle()
    expect(spawner.calls).toHaveLength(1)
    expect(spawner.calls[0].cmd).toEqual(["say", "Approval required: edit"])

    spawner.finish()
    await clock.advance(2_000)
    // Only the newest pending trigger played; the middle one never did.
    expect(spawner.calls).toHaveLength(2)
    expect(spawner.calls[1].cmd).toEqual(["say", "Approval required: grep"])
  })

  test("passes a 20s kill timeout and unref to the spawner", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({ spawn: spawner.spawn, available: ["afplay", "say"], existing: [MACOS_CHIME] })
    notify(instance)
    await settle()
    expect(spawner.calls[0].opts).toEqual({ timeout: 20_000, unref: true })
  })

  test("playback failures stay inside the queue and the next item still plays", async () => {
    const spawner = fakeSpawn()
    const { instance, clock } = notifier({
      spawn: spawner.spawn,
      available: ["afplay", "say"],
      existing: [MACOS_CHIME],
    })
    notify(instance, { key: "first" })
    notify(instance, { key: "second" })
    await settle()
    spawner.finish(1)
    await clock.advance(2_000)
    expect(spawner.calls).toHaveLength(2)
  })

  test("a fire-once key plays at most once", async () => {
    const spawner = fakeSpawn()
    const { instance, clock } = notifier({
      spawn: spawner.spawn,
      available: ["afplay", "say"],
      existing: [MACOS_CHIME],
    })
    notify(instance, { key: "permission:abc" })
    notify(instance, { key: "permission:abc" })
    await settle()
    expect(spawner.calls).toHaveLength(1)

    spawner.finish()
    await clock.advance(2_000)
    notify(instance, { key: "permission:abc" })
    await clock.advance(2_000)
    expect(spawner.calls).toHaveLength(1)
  })
})

describe("config gating", () => {
  const darwin = { available: ["afplay", "say"], existing: [MACOS_CHIME] }

  test("sound off or unset spawns nothing", async () => {
    for (const sound of ["off", undefined] as const) {
      const spawner = fakeSpawn()
      const { instance } = notifier({ spawn: spawner.spawn, ...darwin })
      notify(instance, { settings: settings({ sound }) })
      notify(instance, { kind: "complete", settings: settings({ sound, events: { complete: true } }) })
      await settle()
      expect(spawner.calls).toEqual([])
    }
  })

  test("disabled notifications spawn nothing even with sound on", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({ spawn: spawner.spawn, ...darwin })
    notify(instance, { settings: settings({ enabled: false }) })
    notify(instance, { kind: "error", settings: settings({ enabled: false, sound: "speak" }) })
    await settle()
    expect(spawner.calls).toEqual([])
  })

  test("complete is off by default; permission, question, and error are on", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({ spawn: spawner.spawn, ...darwin })
    notify(instance, { kind: "complete", source: "done" })
    notify(instance, { kind: "error" })
    notify(instance, { kind: "question", source: "ok?" })
    notify(instance, { kind: "permission", source: "bash" })
    await settle()
    // Only one play in flight: the first enabled kind (error). Complete never
    // entered the queue; the pending slot keeps the newest enabled trigger.
    expect(spawner.calls).toHaveLength(1)
    spawner.finish()
  })

  test("per-event toggles apply to both chime and speak", async () => {
    const spawner = fakeSpawn()
    const { instance } = notifier({ spawn: spawner.spawn, ...darwin })
    notify(instance, { settings: settings({ events: { permission: false } }) })
    notify(instance, { settings: settings({ sound: "speak", events: { permission: false } }) })
    notify(instance, { kind: "complete", settings: settings({ events: { complete: true } }) })
    notify(instance, { kind: "complete", settings: settings({ sound: "speak", events: { complete: true } }) })
    await settle()
    // Both permission calls were gated off; the first enabled complete chime
    // played, the speak complete held the pending slot.
    expect(spawner.calls).toHaveLength(1)
    expect(spawner.calls[0].cmd).toEqual(["afplay", MACOS_CHIME])
  })
})
