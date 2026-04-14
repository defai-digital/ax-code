import type { Args } from "../context/args"
import type { EventSource } from "../context/sdk"
import type { TuiConfig } from "@/config/tui"

type NativePartLike = {
  type: string
  text?: string
  tool?: string
  filename?: string
  url?: string
  state?: { status?: string }
}

type NativeMessageLike = {
  info?: {
    role?: string
  }
  parts?: NativePartLike[]
}

export type NativeTranscriptEntry = {
  role: "assistant" | "system" | "user"
  text: string
}

export type NativeViewport = {
  width: number
  height: number
}

export type NativeInputAction =
  | { type: "key"; name: string; ctrl?: boolean; meta?: boolean; shift?: boolean }
  | { type: "text"; text: string }

export type NativeTuiSliceInput = {
  url: string
  args: Args
  config: TuiConfig.Info
  onSnapshot?: () => Promise<string[]>
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: EventSource
}

type NativeTerminalCore = {
  parseInputJson?: (input: string) => string
}

type NativeReadable = {
  isTTY?: boolean
  setRawMode?: (enabled: boolean) => void
  resume?: () => void
  pause?: () => void
  on?: (event: "data", handler: (chunk: Buffer | string) => void) => unknown
  off?: (event: "data", handler: (chunk: Buffer | string) => void) => unknown
}

type NativeWritable = {
  isTTY?: boolean
  columns?: number
  rows?: number
  write: (chunk: string) => unknown
  on?: (event: "resize", handler: () => void) => unknown
  off?: (event: "resize", handler: () => void) => unknown
}

export type NativeTuiIO = {
  stdin?: NativeReadable
  stdout?: NativeWritable
}

export async function runNativeTuiSlice(input: NativeTuiSliceInput, io: NativeTuiIO = process) {
  const stdin = io.stdin
  const stdout = io.stdout
  if (!stdout) return

  const core = await loadNativeTerminalCore()
  let transcript = await loadNativeTranscript(input)
  let prompt = input.args.prompt ?? ""
  let closed = false

  return new Promise<void>((resolve) => {
    const viewport = (): NativeViewport => ({
      width: stdout.columns ?? 80,
      height: stdout.rows ?? 24,
    })

    const paint = () => {
      stdout.write(renderNativeFrame({ viewport: viewport(), transcript, prompt }))
    }

    const close = () => {
      if (closed) return
      closed = true
      process.off("SIGINT", onSignal)
      process.off("SIGTERM", onSignal)
      stdout.off?.("resize", paint)
      stdin?.off?.("data", onData)
      if (stdin?.isTTY) stdin.setRawMode?.(false)
      stdin?.pause?.()
      stdout.write("\x1b[?25h\x1b[?1049l")
      resolve()
    }

    const onData = (chunk: Buffer | string) => {
      for (const action of parseNativeInputActions(chunk, core)) {
        if (action.type === "key" && action.ctrl && (action.name === "c" || action.name === "d")) {
          close()
          return
        }
        if (action.type === "key" && action.name === "enter") {
          const text = prompt.trim()
          if (text) transcript = [...transcript, { role: "user", text }]
          prompt = ""
          paint()
          continue
        }
        prompt = applyNativePromptAction(prompt, action)
      }
      paint()
    }

    const onSignal = () => close()

    stdout.write("\x1b[?1049h\x1b[?25l")
    if (stdin?.isTTY) stdin.setRawMode?.(true)
    stdin?.resume?.()
    stdin?.on?.("data", onData)
    stdout.on?.("resize", paint)
    process.once("SIGINT", onSignal)
    process.once("SIGTERM", onSignal)
    paint()
  })
}

export async function loadNativeTranscript(input: NativeTuiSliceInput): Promise<NativeTranscriptEntry[]> {
  const sessionID = await resolveNativeSessionID(input)
  if (!sessionID) return []

  try {
    const url = new URL(`/session/${encodeURIComponent(sessionID)}/message`, input.url)
    url.searchParams.set("limit", "20")
    if (input.directory) url.searchParams.set("directory", input.directory)

    const response = await (input.fetch ?? fetch)(url, { headers: input.headers })
    if (!response.ok) return [{ role: "system", text: `Unable to load session ${sessionID}` }]

    const data = await response.json()
    return Array.isArray(data) ? projectNativeTranscript(data) : []
  } catch {
    return [{ role: "system", text: `Unable to load session ${sessionID}` }]
  }
}

async function resolveNativeSessionID(input: NativeTuiSliceInput) {
  if (input.args.sessionID) return input.args.sessionID
  if (!input.args.continue) return undefined

  try {
    const url = new URL("/session", input.url)
    url.searchParams.set("limit", "1")
    if (input.directory) url.searchParams.set("directory", input.directory)

    const response = await (input.fetch ?? fetch)(url, { headers: input.headers })
    if (!response.ok) return undefined
    const data = await response.json()
    return Array.isArray(data) && typeof data[0]?.id === "string" ? data[0].id : undefined
  } catch {
    return undefined
  }
}

export function projectNativeTranscript(messages: NativeMessageLike[]): NativeTranscriptEntry[] {
  return messages.flatMap((message) => {
    const role = nativeRole(message.info?.role)
    const text = nativeMessageText(message.parts ?? [])
    if (!text) return []
    return [{ role, text }]
  })
}

export function nativeFrameLines(input: {
  viewport: NativeViewport
  transcript: NativeTranscriptEntry[]
  prompt: string
}) {
  const width = viewportDimension(input.viewport.width, 80, 1, 240)
  const height = viewportDimension(input.viewport.height, 24, 1, 200)
  const header = fitLine(`AX Code native renderer (${width}x${height})`, width)
  const divider = "-".repeat(width)
  const prompt = fitLine(`> ${input.prompt}`, width)
  if (height === 1) return [prompt]
  if (height === 2) return [header, prompt]
  if (height === 3) return [header, divider, prompt]

  const bodyHeight = height - 4
  const body = input.transcript.flatMap((entry) => wrapNativeLine(`${label(entry.role)}: ${entry.text}`, width))
  const visible = body.slice(-bodyHeight)

  while (visible.length < bodyHeight) visible.unshift("")
  return [header, divider, ...visible, divider, prompt]
}

export function renderNativeFrame(input: {
  viewport: NativeViewport
  transcript: NativeTranscriptEntry[]
  prompt: string
}) {
  const lines = nativeFrameLines(input)
  return `\x1b[H\x1b[2J${lines.join("\r\n")}`
}

export function parseNativeInputActions(input: Buffer | string, core?: NativeTerminalCore): NativeInputAction[] {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input
  const parsed = parseWithNativeCore(text, core)
  if (parsed) return parsed
  return parseFallbackInput(text)
}

export function applyNativePromptAction(prompt: string, action: NativeInputAction) {
  if (action.type === "text") return prompt + action.text
  if (action.type === "key" && action.name === "backspace") return Array.from(prompt).slice(0, -1).join("")
  return prompt
}

async function loadNativeTerminalCore(): Promise<NativeTerminalCore | undefined> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<NativeTerminalCore>
    return await dynamicImport("@ax-code/terminal")
  } catch {
    return undefined
  }
}

function parseWithNativeCore(input: string, core?: NativeTerminalCore): NativeInputAction[] | undefined {
  if (!core?.parseInputJson) return undefined
  try {
    const events = JSON.parse(core.parseInputJson(input))
    if (!Array.isArray(events)) return undefined
    return events.flatMap(mapNativeInputEvent)
  } catch {
    return undefined
  }
}

function mapNativeInputEvent(event: unknown): NativeInputAction[] {
  if (!event || typeof event !== "object") return []
  if ("type" in event && typeof event.type === "string") {
    const tagged = event as {
      type: string
      name?: unknown
      text?: unknown
      ctrl?: unknown
      alt?: unknown
      meta?: unknown
      shift?: unknown
    }
    if ((tagged.type === "text" || tagged.type === "paste") && typeof tagged.text === "string") {
      return [{ type: "text", text: tagged.text }]
    }
    if (tagged.type === "key" && typeof tagged.name === "string") {
      return [
        {
          type: "key",
          name: tagged.name,
          ctrl: Boolean(tagged.ctrl),
          meta: Boolean(tagged.meta ?? tagged.alt),
          shift: Boolean(tagged.shift),
        },
      ]
    }
    return []
  }
  if ("Text" in event && typeof event.Text === "string") return [{ type: "text", text: event.Text }]
  if ("Paste" in event && typeof event.Paste === "string") return [{ type: "text", text: event.Paste }]
  if ("Key" in event && event.Key && typeof event.Key === "object") {
    const key = event.Key as { name?: unknown; ctrl?: unknown; alt?: unknown; meta?: unknown; shift?: unknown }
    if (typeof key.name !== "string") return []
    return [
      {
        type: "key",
        name: key.name,
        ctrl: Boolean(key.ctrl),
        meta: Boolean(key.meta ?? key.alt),
        shift: Boolean(key.shift),
      },
    ]
  }
  return []
}

function parseFallbackInput(input: string): NativeInputAction[] {
  const actions: NativeInputAction[] = []
  let text = ""

  const flush = () => {
    if (!text) return
    actions.push({ type: "text", text })
    text = ""
  }

  for (const ch of input) {
    if (ch === "\u0003") {
      flush()
      actions.push({ type: "key", name: "c", ctrl: true })
    } else if (ch === "\u0004") {
      flush()
      actions.push({ type: "key", name: "d", ctrl: true })
    } else if (ch === "\r" || ch === "\n") {
      flush()
      actions.push({ type: "key", name: "enter" })
    } else if (ch === "\u007f" || ch === "\b") {
      flush()
      actions.push({ type: "key", name: "backspace" })
    } else if (ch >= " " && ch !== "\u001b") {
      text += ch
    }
  }

  flush()
  return actions
}

function nativeRole(role?: string): NativeTranscriptEntry["role"] {
  if (role === "assistant" || role === "user") return role
  return "system"
}

function nativeMessageText(parts: NativePartLike[]) {
  return parts.map(nativePartText).filter(Boolean).join("\n").trim()
}

function nativePartText(part: NativePartLike) {
  if (part.type === "text" || part.type === "reasoning") return part.text ?? ""
  if (part.type === "tool") return `[tool:${part.tool ?? "unknown"}] ${part.state?.status ?? "pending"}`
  if (part.type === "file") return `[file] ${part.filename ?? part.url ?? "attachment"}`
  if (part.type === "compaction") return "[compaction]"
  return ""
}

function wrapNativeLine(input: string, width: number) {
  const lines: string[] = []
  for (const raw of input.split(/\r?\n/)) {
    const chars = Array.from(raw)
    if (chars.length === 0) {
      lines.push("")
      continue
    }
    for (let index = 0; index < chars.length; index += width) {
      lines.push(chars.slice(index, index + width).join(""))
    }
  }
  return lines
}

function fitLine(input: string, width: number) {
  return Array.from(input).slice(0, width).join("").padEnd(width, " ")
}

function label(role: NativeTranscriptEntry["role"]) {
  if (role === "assistant") return "assistant"
  if (role === "user") return "you"
  return "system"
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function viewportDimension(value: number, fallback: number, min: number, max: number) {
  return clamp(Number.isFinite(value) ? Math.floor(value) : fallback, min, max)
}
