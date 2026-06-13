import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { type IPty } from "bun-pty"
import z from "zod"
import { Log } from "../util/log"
import { lazy } from "@ax-code/util/lazy"
import { Shell } from "@/shell/shell"
import { Plugin } from "@/plugin"
import { Env } from "@/util/env"
import { PtyID } from "./schema"

export namespace Pty {
  const log = Log.create({ service: "pty" })

  const BUFFER_LIMIT = 1024 * 1024 * 2
  const BUFFER_CHUNK = 64 * 1024
  const TERM_VALUE = "xterm-256color"
  const AX_CODE_TERMINAL_VALUE = "1"
  const FORBIDDEN_USER_ENV_KEYS = new Set([
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_EXTRA_CA_CERTS",
    "RUBYOPT",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "JAVA_TOOL_OPTIONS",
    "JAVA_OPTIONS",
    "PATH",
    "SHELL",
    "HOME",
    "LD_LIBRARY_PATH",
  ])
  const encoder = new TextEncoder()

  type Socket = {
    readyState: number
    data?: unknown
    send: (data: string | Uint8Array | ArrayBuffer) => void
    close: (code?: number, reason?: string) => void
  }

  type Active = {
    info: Info
    process: IPty
    buffer: string
    bufferCursor: number
    cursor: number
    subscribers: Map<unknown, Socket>
    dispose: Array<{ dispose: () => void }>
  }

  type State = {
    dir: string
    sessions: Map<PtyID, Active>
  }

  type ReplayMeta = {
    cursor: number
    from?: number
    gap?: {
      requested: number
      available: number
    }
  }

  type ReplayWindow = Pick<Active, "buffer" | "bufferCursor" | "cursor">

  // WebSocket control frame: 0x00 + UTF-8 JSON.
  const meta = (payload: ReplayMeta) => {
    const json = JSON.stringify(payload)
    const bytes = encoder.encode(json)
    const out = new Uint8Array(bytes.length + 1)
    out[0] = 0
    out.set(bytes, 1)
    return out
  }

  export function replayBufferedOutput(session: ReplayWindow, cursor?: number): { data: string; meta: ReplayMeta } {
    const start = session.bufferCursor
    const end = session.cursor
    const from =
      cursor === -1 ? end : typeof cursor === "number" && Number.isSafeInteger(cursor) ? Math.max(0, cursor) : 0
    const actualFrom = Math.max(from, start)

    const data = (() => {
      if (!session.buffer) return ""
      if (actualFrom >= end) return ""
      const offset = actualFrom - start
      if (offset >= session.buffer.length) return ""
      return session.buffer.slice(offset)
    })()

    return {
      data,
      meta:
        from < start
          ? {
              cursor: end,
              from: actualFrom,
              gap: { requested: from, available: start },
            }
          : { cursor: end },
    }
  }

  const trySend = (ws: Socket, data: string | Uint8Array | ArrayBuffer) => {
    try {
      ws.send(data)
      return true
    } catch {
      return false
    }
  }

  const trySendBuffered = (ws: Socket, data: string) => {
    try {
      for (let i = 0; i < data.length; i += BUFFER_CHUNK) {
        ws.send(data.slice(i, i + BUFFER_CHUNK))
      }
      return true
    } catch {
      return false
    }
  }

  export function sanitizeUserEnv(input?: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {}
    if (!input) return out

    const sanitized = Env.sanitize(input)
    for (const [key, value] of Object.entries(sanitized)) {
      if (value === undefined) continue
      if (FORBIDDEN_USER_ENV_KEYS.has(key.toUpperCase())) continue
      out[key] = value
    }
    return out
  }

  const pty = lazy(async () => {
    const { spawn } = await import("bun-pty")
    return spawn
  })

  export const Info = z
    .object({
      id: PtyID.zod,
      title: z.string(),
      command: z.string(),
      args: z.array(z.string()),
      cwd: z.string(),
      status: z.enum(["running", "exited"]),
      pid: z.number(),
    })
    .meta({ ref: "Pty" })

  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    title: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })

  export type CreateInput = z.infer<typeof CreateInput>

  export const UpdateInput = z.object({
    title: z.string().optional(),
    size: z
      .object({
        rows: z.number(),
        cols: z.number(),
      })
      .optional(),
  })

  export type UpdateInput = z.infer<typeof UpdateInput>

  export const Event = {
    Created: BusEvent.define("pty.created", z.object({ info: Info })),
    Updated: BusEvent.define("pty.updated", z.object({ info: Info })),
    Exited: BusEvent.define("pty.exited", z.object({ id: PtyID.zod, exitCode: z.number() })),
    Deleted: BusEvent.define("pty.deleted", z.object({ id: PtyID.zod })),
  }

  function teardown(session: Active) {
    for (const item of session.dispose) {
      try {
        item.dispose()
      } catch {}
    }
    session.dispose = []
    try {
      session.process.kill()
    } catch {}
    for (const [key, ws] of session.subscribers.entries()) {
      try {
        if (ws.data === key) ws.close()
      } catch {}
    }
    session.subscribers.clear()
  }

  const state = Instance.state(
    () => ({
      dir: Instance.directory,
      sessions: new Map<PtyID, Active>(),
    }),
    async (state) => {
      for (const session of state.sessions.values()) {
        teardown(session)
      }
      state.sessions.clear()
    },
  )

  export async function list() {
    const current = state()
    return Array.from(current.sessions.values()).map((session) => session.info)
  }

  export async function get(id: PtyID) {
    const current = state()
    return current.sessions.get(id)?.info
  }

  export async function resize(id: PtyID, cols: number, rows: number) {
    const current = state()
    const session = current.sessions.get(id)
    if (session && session.info.status === "running") {
      session.process.resize(cols, rows)
    }
  }

  export async function write(id: PtyID, data: string) {
    const current = state()
    const session = current.sessions.get(id)
    if (session && session.info.status === "running") {
      session.process.write(data)
    }
  }

  export async function connect(id: PtyID, ws: Socket, cursor?: number) {
    const current = state()
    const session = current.sessions.get(id)
    if (!session) {
      ws.close()
      return
    }
    log.info("client connected to session", { id })

    // Use ws.data as the unique key for this connection lifecycle.
    // If ws.data is undefined, fallback to ws object.
    const key = ws.data && typeof ws.data === "object" ? ws.data : ws
    // Optionally cleanup if the key somehow exists
    session.subscribers.delete(key)
    session.subscribers.set(key, ws)

    const cleanup = () => {
      session.subscribers.delete(key)
    }

    const replay = replayBufferedOutput(session, cursor)

    if (replay.data && !trySendBuffered(ws, replay.data)) {
      cleanup()
      ws.close()
      return
    }

    if (!trySend(ws, meta(replay.meta))) {
      cleanup()
      ws.close()
      return
    }

    return {
      onMessage: (message: string | ArrayBuffer) => {
        if (session.info.status !== "running") return
        session.process.write(String(message))
      },
      onClose: () => {
        log.info("client disconnected from session", { id })
        cleanup()
      },
    }
  }

  export async function create(input: CreateInput) {
    const current = state()
    const id = PtyID.ascending()
    const command = input.command || Shell.preferred()
    const args = [...(input.args ?? [])]
    const shell =
      command
        .split(/[\\/]/)
        .at(-1)
        ?.replace(/\.exe$/i, "") ?? command
    if (["sh", "bash", "zsh", "dash", "ash", "ksh", "csh", "tcsh"].includes(shell)) {
      args.push("-l")
    }

    if (input.cwd && !Filesystem.contains(Instance.directory, input.cwd)) {
      throw new Error(`PTY cwd escapes project directory: ${input.cwd}`)
    }
    const cwd = input.cwd || current.dir
    const shellEnv = await Plugin.trigger("shell.env", { cwd }, { env: {} })
    const baseEnv = Env.sanitize({
      ...Env.sanitize(process.env),
      ...shellEnv.env,
    })
    const env = {
      ...baseEnv,
      ...sanitizeUserEnv(input.env),
      TERM: TERM_VALUE,
      AX_CODE_TERMINAL: AX_CODE_TERMINAL_VALUE,
    } as Record<string, string>

    if (process.platform === "win32") {
      env.LC_ALL = "C.UTF-8"
      env.LC_CTYPE = "C.UTF-8"
      env.LANG = "C.UTF-8"
    }
    log.info("creating session", { id, cmd: command, args, cwd })

    const spawn = await pty()
    const proc = spawn(command, args, {
      name: TERM_VALUE,
      cwd,
      env,
    })

    const info = {
      id,
      title: input.title || `Terminal ${id.slice(-4)}`,
      command,
      args,
      cwd,
      status: "running",
      pid: proc.pid,
    } as const
    const session: Active = {
      info,
      process: proc,
      buffer: "",
      bufferCursor: 0,
      cursor: 0,
      subscribers: new Map(),
      dispose: [],
    }
    current.sessions.set(id, session)
    const onData = proc.onData(
      Instance.bind((chunk) => {
        session.cursor += chunk.length

        for (const [key, ws] of session.subscribers.entries()) {
          if (ws.readyState !== 1) {
            session.subscribers.delete(key)
            continue
          }
          // Recycled-socket guard: only meaningful when the key is the
          // socket's `data` object. When we fell back to the socket
          // itself as the key (ws.data not an object), `ws.data !== key`
          // would always be true and wrongly drop a live subscriber on
          // its first chunk.
          if (key !== ws && ws.data !== key) {
            session.subscribers.delete(key)
            continue
          }
          try {
            ws.send(chunk)
          } catch {
            session.subscribers.delete(key)
          }
        }

        session.buffer += chunk
        if (session.buffer.length <= BUFFER_LIMIT) return
        const excess = session.buffer.length - BUFFER_LIMIT
        session.buffer = session.buffer.slice(excess)
        session.bufferCursor += excess
      }),
    )
    const onExit = proc.onExit(
      Instance.bind(({ exitCode }) => {
        if (session.info.status === "exited") return
        log.info("session exited", { id, exitCode })
        session.info.status = "exited"
        Bus.publishDetached(Event.Exited, { id, exitCode })
        void remove(id).catch((error) => log.warn("failed to remove exited pty", { id, error }))
      }),
    )
    session.dispose.push(onData, onExit)
    await Bus.publish(Event.Created, { info })
    return info
  }

  export async function update(id: PtyID, input: UpdateInput) {
    const current = state()
    const session = current.sessions.get(id)
    if (!session) return
    if (input.title) {
      session.info.title = input.title
    }
    if (input.size && session.info.status === "running") {
      session.process.resize(input.size.cols, input.size.rows)
    }
    await Bus.publish(Event.Updated, { info: session.info })
    return session.info
  }

  export async function remove(id: PtyID) {
    const current = state()
    const session = current.sessions.get(id)
    if (!session) return
    current.sessions.delete(id)
    log.info("removing session", { id })
    if (session.info.status !== "exited") {
      session.info.status = "exited"
      Bus.publishDetached(Event.Exited, { id, exitCode: 0 })
    }
    teardown(session)
    Bus.publishDetached(Event.Deleted, { id: session.info.id })
  }
}
