// Audio notifications (system chime or opt-in templated speech) fired
// alongside the terminal notifier. Platform capability is probed once per
// notifier instance and cached; playback is serialized — one sound in flight,
// a single pending slot, a minimum gap between play starts — and fully
// fire-and-forget, so the render loop never awaits it. With no usable backend
// the notifier is a silent no-op (the OSC 9 / BEL path stays the fallback).
// Every failure is logged, never thrown, never surfaced to the user.

import { existsSync } from "fs"
import { Log } from "@/util/log"
import { Process } from "@/util/process"
import { which } from "@/util/which"

const log = Log.create({ service: "tui.audio-notify" })

export type AudioEventKind = "permission" | "question" | "complete" | "error"

export type AudioNotifySettings = {
  // notifications.enabled — sound never plays while terminal notifications
  // are disabled.
  enabled: boolean
  // notifications.sound (effective default "off")
  sound?: "off" | "chime" | "speak"
  // notifications.voice — empty/omitted uses the platform default voice
  voice?: string
  // notifications.rate — 0/omitted uses the platform default rate
  rate?: number
  // notifications.events per-kind toggles
  events?: Partial<Record<AudioEventKind, boolean>>
}

export type AudioNotifyInput = {
  kind: AudioEventKind
  // Source string for the speech template: permission name, question
  // header/text, or session title. Ignored for chimes and errors.
  source?: string
  settings: AudioNotifySettings
  // Fire-once key, same mechanism as util/terminal-notify.ts: a key plays at
  // most once per notifier instance, so reactive re-renders cannot replay a
  // sound for the same event.
  key?: string
}

export type AudioSpawn = (cmd: string[], opts: { timeout: number; unref: boolean }) => { exited: Promise<number> }

export type AudioNotifyDeps = {
  spawn: AudioSpawn
  platform: string
  which: (cmd: string) => string | null
  fileExists: (path: string) => boolean
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
}

const PLAY_TIMEOUT_MS = 20_000
const MIN_PLAY_GAP_MS = 2_000
const MAX_SPEECH_LENGTH = 120
const MAX_TITLE_LENGTH = 80
const MAX_SPEAK_RATE = 500

const MACOS_CHIME_PATH = "/System/Library/Sounds/Glass.aiff"
const WINDOWS_CHIME_PATH = "C:\\Windows\\Media\\Windows Notify System Generic.wav"
const LINUX_CHIME_PATH = "/usr/share/sounds/freedesktop/stereo/complete.oga"

// Per-event defaults: everything but turn completion is on.
const DEFAULT_EVENT_ENABLED: Record<AudioEventKind, boolean> = {
  permission: true,
  question: true,
  complete: false,
  error: true,
}

// Strip control characters and collapse whitespace runs, then cap the length
// in UTF-16 code units. The only text ever spoken comes from the fixed
// templates in speechText — never tool arguments, payload paths, model
// output, or error messages.
function sanitizeSpeech(value: string) {
  return value
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SPEECH_LENGTH)
}

export function speechText(kind: AudioEventKind, source?: string): string {
  // Error speech is a fixed phrase: error text may contain paths, arguments,
  // or model output that must never be read aloud.
  if (kind === "error") return "AX Code error"
  // The session title is capped before templating so the prefix always fits.
  const text = sanitizeSpeech(kind === "complete" ? (source ?? "").slice(0, MAX_TITLE_LENGTH) : (source ?? ""))
  switch (kind) {
    case "permission":
      return sanitizeSpeech(text ? `Approval required: ${text}` : "Approval required")
    case "question":
      return sanitizeSpeech(text ? `Question: ${text}` : "Question")
    case "complete":
      return sanitizeSpeech(text ? `Task complete: ${text}` : "Task complete")
  }
}

// Single-quoted PowerShell literal; the only escape inside one is a doubled
// single quote. Speech text is already sanitized, so this is the sole
// interpolation barrier needed.
function powershellQuote(text: string) {
  return `'${text.replace(/'/g, "''")}'`
}

function clampSpeakRate(rate: number) {
  return Math.min(MAX_SPEAK_RATE, Math.max(1, Math.round(rate)))
}

type SpeakCommand = (text: string, opts: { voice?: string; rate?: number }) => string[]

type AudioBackends = {
  chime?: string[]
  speak?: SpeakCommand
}

// Runtime capability probe: executable availability, plus file existence
// where the command references a sound file. First success wins.
function probeBackends(deps: AudioNotifyDeps): AudioBackends {
  switch (deps.platform) {
    case "darwin": {
      const chime = deps.which("afplay") && deps.fileExists(MACOS_CHIME_PATH) ? ["afplay", MACOS_CHIME_PATH] : undefined
      const speak: SpeakCommand | undefined = deps.which("say")
        ? (text, opts) => [
            "say",
            ...(opts.voice ? ["-v", opts.voice] : []),
            ...(opts.rate ? ["-r", String(opts.rate)] : []),
            text,
          ]
        : undefined
      return { chime, speak }
    }
    case "win32": {
      if (!deps.which("powershell")) return {}
      const chime = deps.fileExists(WINDOWS_CHIME_PATH)
        ? ["powershell", "-NoProfile", "-Command", `(New-Object Media.SoundPlayer '${WINDOWS_CHIME_PATH}').PlaySync()`]
        : undefined
      const speak: SpeakCommand = (text) => [
        "powershell",
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak(${powershellQuote(text)})`,
      ]
      return { chime, speak }
    }
    case "linux": {
      const chime =
        deps.which("paplay") && deps.fileExists(LINUX_CHIME_PATH)
          ? ["paplay", LINUX_CHIME_PATH]
          : deps.which("canberra-gtk-play")
            ? ["canberra-gtk-play", "-i", "complete"]
            : undefined
      const speak: SpeakCommand | undefined = deps.which("spd-say")
        ? (text) => ["spd-say", text]
        : deps.which("espeak-ng")
          ? (text) => ["espeak-ng", text]
          : undefined
      return { chime, speak }
    }
    default:
      return {}
  }
}

export function createAudioNotifier(overrides: Partial<AudioNotifyDeps> = {}) {
  const deps: AudioNotifyDeps = {
    spawn: (cmd, opts) => Process.spawn(cmd, { timeout: opts.timeout, unref: opts.unref }),
    platform: process.platform,
    which,
    fileExists: existsSync,
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
      setTimeout(fn, ms)
    },
    ...overrides,
  }

  let backends: AudioBackends | undefined
  const firedKeys = new Set<string>()
  let playing = false
  let pending: string[] | undefined
  let lastPlayStart = Number.NEGATIVE_INFINITY

  const sleep = (ms: number) => new Promise<void>((resolve) => deps.setTimeout(resolve, ms))

  async function drain() {
    if (playing) return
    playing = true
    try {
      while (pending !== undefined) {
        const argv = pending
        pending = undefined
        const wait = MIN_PLAY_GAP_MS - (deps.now() - lastPlayStart)
        if (wait > 0) await sleep(wait)
        lastPlayStart = deps.now()
        try {
          const proc = deps.spawn(argv, { timeout: PLAY_TIMEOUT_MS, unref: true })
          const code = await proc.exited
          if (code !== 0) log.debug("audio playback exited nonzero", { code, cmd: argv[0] })
        } catch (error) {
          log.debug("audio playback failed", { error, cmd: argv[0] })
        }
      }
    } finally {
      playing = false
    }
  }

  function notify(input: AudioNotifyInput) {
    try {
      const { settings } = input
      if (!settings.enabled) return
      const sound = settings.sound ?? "off"
      if (sound === "off") return
      if (!(settings.events?.[input.kind] ?? DEFAULT_EVENT_ENABLED[input.kind])) return
      if (input.key !== undefined) {
        if (firedKeys.has(input.key)) return
        firedKeys.add(input.key)
      }
      backends ??= probeBackends(deps)
      if (sound === "chime") {
        if (!backends.chime) return
        pending = backends.chime
      } else {
        if (!backends.speak) return
        const voice = settings.voice?.trim() || undefined
        const rate = settings.rate && settings.rate > 0 ? clampSpeakRate(settings.rate) : undefined
        pending = backends.speak(speechText(input.kind, input.source), { voice, rate })
      }
      // Fire-and-forget: the render path never awaits playback. Triggers that
      // arrive while a sound plays hold the single pending slot — newest
      // wins, so a repeated trigger of the same kind replaces its own
      // pending play instead of stacking.
      void drain().catch((error) => log.debug("audio playback queue failed", { error }))
    } catch (error) {
      log.debug("audio notification failed", { error })
    }
  }

  return { notify }
}

let shared: ReturnType<typeof createAudioNotifier> | undefined

// Process-wide notifier used by the TUI app. Created lazily so the capability
// probe runs at most once per process.
export function notifyAudioEvent(input: AudioNotifyInput) {
  shared ??= createAudioNotifier()
  shared.notify(input)
}
