import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { ProjectTable } from "../src/project/project.sql"
import { ProjectID } from "../src/project/schema"
import { ModelID, ProviderID } from "../src/provider/schema"
import type { MessageV2 } from "../src/session/message-v2"
import { MessageWrite } from "../src/session/message-write"
import { createPartWriteBatcher } from "../src/session/part-write-batcher"
import { MessageID, PartID, SessionID } from "../src/session/schema"
import { SessionTable } from "../src/session/session.sql"
import { Database } from "../src/storage/db"
// "#db" subpath import (package.json imports): tsx treats a literal
// `../src/storage/db.node` specifier as a native addon and never tries the
// `.ts` extension, so the canonical alias is required for the CLI lane.
import { init } from "#db"
import { migrate } from "../src/storage/migrate-journal"
import { MigrationLock } from "../src/storage/migrate-lock"

export type JournalMode = "WAL" | "DELETE"

export type StallRow = {
  journalMode: JournalMode
  burstSize: number
  writesScheduled: number
  writesActual: number
  writesCoalesced: number
  writeMsP50: number
  writeMsP95: number
  writeMsMax: number
  stallMsMax: number
  wallMs: number
  dbBytesBefore: number
  dbBytesAfter: number
  walBytesBefore: number
  walBytesAfter: number
  journalBytesBefore: number
  journalBytesAfter: number
  checkpointMs: number | null
}

export type RunOpts = {
  dir: string
  bursts: number[]
  journalModes?: JournalMode[]
  keep?: boolean
  windowMs?: number
  windowFor?: (part: MessageV2.Part) => number
  deltasPerMessage?: number
  deltaChars?: number
  heartbeatMs?: number
}

const DEFAULT_BURSTS = [10, 50, 100]
const DEFAULT_WINDOW_MS = 250
const DEFAULT_DELTAS = 16
const DEFAULT_DELTA_CHARS = 64
const DEFAULT_HEARTBEAT_MS = 1
const MIGRATION_DIR = path.join(import.meta.dirname, "../migration")

export function parseArgs(argv: string[]): { dir: string; bursts: number[]; out?: string; keep: boolean } {
  let dir = os.tmpdir()
  let bursts = DEFAULT_BURSTS
  let out: string | undefined
  let keep = false

  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]!
    const take = (flag: string): string | undefined => {
      if (item === flag) {
        const next = argv[i + 1]
        if (!next || next.startsWith("--")) throw new Error(`Missing value for ${flag}`)
        i += 1
        return next
      }
      if (item.startsWith(`${flag}=`)) return item.slice(flag.length + 1)
    }

    const dirVal = take("--dir")
    if (dirVal !== undefined) {
      dir = dirVal
      continue
    }
    const burstsVal = take("--bursts")
    if (burstsVal !== undefined) {
      bursts = burstsVal.split(",").map((token) => {
        const trimmed = token.trim()
        const parsed = Number(trimmed)
        if (trimmed === "" || !Number.isFinite(parsed)) throw new Error(`Invalid --bursts value: ${burstsVal}`)
        return parsed
      })
      continue
    }
    const outVal = take("--out")
    if (outVal !== undefined) {
      out = outVal
      continue
    }
    if (item === "--keep") {
      keep = true
      continue
    }
    throw new Error(`Unknown argument: ${item}`)
  }

  const result: { dir: string; bursts: number[]; out?: string; keep: boolean } = { dir, bursts, keep }
  if (out !== undefined) result.out = out
  return result
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const clamped = Math.min(100, Math.max(0, p))
  const idx = (clamped / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const low = sorted[lo] ?? 0
  const high = sorted[hi] ?? low
  if (lo === hi) return low
  return low + (high - low) * (idx - lo)
}

export function formatTable(rows: StallRow[]): string {
  const headers = [
    "journal",
    "burst",
    "scheduled",
    "actual",
    "coalesced",
    "p50",
    "p95",
    "max",
    "stall",
    "wall",
    "wal",
    "journalB",
    "ckpt",
  ]
  const body = rows.map((row) => [
    row.journalMode,
    String(row.burstSize),
    String(row.writesScheduled),
    String(row.writesActual),
    String(row.writesCoalesced),
    row.writeMsP50.toFixed(2),
    row.writeMsP95.toFixed(2),
    row.writeMsMax.toFixed(2),
    row.stallMsMax.toFixed(2),
    row.wallMs.toFixed(2),
    String(row.walBytesAfter),
    String(row.journalBytesAfter),
    row.checkpointMs === null ? "-" : row.checkpointMs.toFixed(2),
  ])
  const widths = headers.map((header, col) => Math.max(header.length, ...body.map((line) => line[col]!.length)))
  const fmt = (cells: string[]) => cells.map((cell, col) => cell.padStart(widths[col]!)).join("  ")
  return [fmt(headers), fmt(widths.map((width) => "-".repeat(width))), ...body.map(fmt)].join("\n")
}

function productionWindowFor(part: MessageV2.Part): number {
  if (part.type === "text" || part.type === "reasoning") return Math.max(250, part.text.length / 1024)
  return 250
}

function migrationTime(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

function loadMigrations(dir: string) {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const entries: { sql: string; timestamp: number; name: string }[] = []
  for (const name of names) {
    const file = path.join(dir, name, "migration.sql")
    if (!existsSync(file)) continue
    entries.push({ sql: readFileSync(file, "utf-8"), timestamp: migrationTime(name), name })
  }
  return entries.sort((a, b) => a.timestamp - b.timestamp)
}

function fileBytes(target: string) {
  return statSync(target, { throwIfNoEntry: false })?.size ?? 0
}

function sidecarBytes(dbPath: string) {
  return {
    db: fileBytes(dbPath),
    wal: fileBytes(`${dbPath}-wal`),
    shm: fileBytes(`${dbPath}-shm`),
    journal: fileBytes(`${dbPath}-journal`),
  }
}

function withJournalEnv<T>(mode: JournalMode, fn: () => T): T {
  const key = "AX_CODE_SQLITE_JOURNAL"
  const previous = process.env[key]
  process.env[key] = mode === "WAL" ? "wal" : "delete"
  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
}

function seedMessages(db: ReturnType<typeof init>, sessionID: SessionID, burstSize: number, now: number) {
  const ids: ReturnType<typeof MessageID.ascending>[] = []
  for (let i = 0; i < burstSize; i++) {
    const info: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      time: { created: now },
      agent: "build",
      model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    }
    MessageWrite.message(db, info, now)
    ids.push(info.id)
  }
  return ids
}

function growText(deltaChars: number, deltas: number) {
  return "x".repeat(deltaChars * deltas)
}

export async function runBurst(opts: RunOpts & { journalMode: JournalMode; burstSize: number }): Promise<StallRow> {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS
  const windowFor = opts.windowFor ?? productionWindowFor
  const deltasPerMessage = opts.deltasPerMessage ?? DEFAULT_DELTAS
  const deltaChars = opts.deltaChars ?? DEFAULT_DELTA_CHARS
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS

  await fs.mkdir(opts.dir, { recursive: true })
  const cellDir = await fs.mkdtemp(path.join(opts.dir, `stall-${opts.journalMode}-${opts.burstSize}-`))
  const dbPath = path.join(cellDir, "ax-code.db")

  let client: ReturnType<typeof init> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let lastTick = 0
  let stallMsMax = 0

  try {
    client = init(dbPath)
    withJournalEnv(opts.journalMode, () => {
      Database.applyStartupPragmas({
        run: (sql) => client!.run(sql),
        path: dbPath,
      })
    })

    const journal = loadMigrations(MIGRATION_DIR)
    const release = MigrationLock.acquire(dbPath)
    try {
      migrate(client, journal)
    } finally {
      release()
    }

    const now = Date.now()
    const projectID = ProjectID.make("proj_sqlite_stall")
    const sessionID = SessionID.ascending()
    client
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: cellDir,
        vcs: "git",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()
    client
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: "sqlite-stall",
        directory: cellDir,
        title: "sqlite stall",
        version: "1",
        time_created: now,
        time_updated: now,
      })
      .run()
    const messageIDs = seedMessages(client, sessionID, opts.burstSize, now)

    const before = sidecarBytes(dbPath)
    const writeMs: number[] = []
    let writesScheduled = 0
    const db = client

    const batcher = createPartWriteBatcher<MessageV2.Part>({
      windowMs,
      windowFor,
      write: (part) => {
        const started = performance.now()
        MessageWrite.parts(db, [part], Date.now())
        writeMs.push(performance.now() - started)
      },
    })

    lastTick = performance.now()
    heartbeat = setInterval(() => {
      const tick = performance.now()
      stallMsMax = Math.max(stallMsMax, tick - lastTick)
      lastTick = tick
    }, heartbeatMs)
    heartbeat.unref()

    const wallStart = performance.now()
    for (const messageID of messageIDs) {
      const textID = PartID.ascending()
      const textBase = { id: textID, sessionID, messageID, type: "text" as const }
      writesScheduled += 1
      await batcher.forceImmediate({ ...textBase, text: "" })
      for (let delta = 1; delta <= deltasPerMessage; delta++) {
        writesScheduled += 1
        batcher.schedule({ ...textBase, text: growText(deltaChars, delta) })
      }
      writesScheduled += 1
      await batcher.forceImmediate({ ...textBase, text: growText(deltaChars, deltasPerMessage) })

      const toolID = PartID.ascending()
      const toolBase = {
        id: toolID,
        sessionID,
        messageID,
        type: "tool" as const,
        callID: `call_${messageID}`,
        tool: "bash",
      }
      const toolStart = Date.now()
      writesScheduled += 1
      await batcher.forceImmediate({ ...toolBase, state: { status: "pending", input: {}, raw: "" } })
      writesScheduled += 1
      await batcher.forceImmediate({ ...toolBase, state: { status: "running", input: {}, time: { start: toolStart } } })
      writesScheduled += 1
      await batcher.forceImmediate({
        ...toolBase,
        state: {
          status: "completed",
          input: {},
          output: "ok",
          title: "bash",
          metadata: {},
          time: { start: toolStart, end: Date.now() },
        },
      })
      await batcher.flush()
    }

    let checkpointMs: number | null = null
    if (opts.journalMode === "WAL") {
      const started = performance.now()
      db.run("PRAGMA wal_checkpoint(PASSIVE)")
      checkpointMs = performance.now() - started
    }
    const wallMs = performance.now() - wallStart
    stallMsMax = Math.max(stallMsMax, performance.now() - lastTick)

    const after = sidecarBytes(dbPath)
    const sorted = [...writeMs].sort((a, b) => a - b)
    const writesActual = writeMs.length
    return {
      journalMode: opts.journalMode,
      burstSize: opts.burstSize,
      writesScheduled,
      writesActual,
      writesCoalesced: writesScheduled - writesActual,
      writeMsP50: percentile(sorted, 50),
      writeMsP95: percentile(sorted, 95),
      writeMsMax: sorted.at(-1) ?? 0,
      stallMsMax,
      wallMs,
      dbBytesBefore: before.db,
      dbBytesAfter: after.db,
      walBytesBefore: before.wal,
      walBytesAfter: after.wal,
      journalBytesBefore: before.journal,
      journalBytesAfter: after.journal,
      checkpointMs,
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    try {
      client?.$client.close()
    } catch {
      // Close is best-effort so the cell directory can still be removed.
    }
    if (!opts.keep) await fs.rm(cellDir, { recursive: true, force: true })
  }
}

export async function runMatrix(opts: RunOpts): Promise<StallRow[]> {
  const journalModes = opts.journalModes ?? ["WAL", "DELETE"]
  const rows: StallRow[] = []
  for (const journalMode of journalModes) {
    for (const burstSize of opts.bursts) {
      rows.push(await runBurst({ ...opts, journalMode, burstSize }))
    }
  }
  return rows
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await fs.mkdir(args.dir, { recursive: true })
  const root = await fs.mkdtemp(path.join(args.dir, "ax-sqlite-stall-"))
  try {
    const rows = await runMatrix({ dir: root, bursts: args.bursts, keep: args.keep })
    console.log(formatTable(rows))
    if (args.out) await fs.writeFile(args.out, `${JSON.stringify(rows, null, 2)}\n`)
  } finally {
    if (!args.keep) await fs.rm(root, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
