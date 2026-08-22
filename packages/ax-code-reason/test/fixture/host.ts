import path from "path"
import {
  configureCodeReasonHost,
  type CodeReasonHost,
  type CorrelatedDiagnosticsPayload,
  type DiagnosticEvent,
  type DreDbPort,
} from "../../src/host"
import { setLogSink } from "../../src/log"
import { createFakeGraph, type FakeGraph } from "./graph"

// In-memory fake of the CURRENT (pre-Phase-2) CodeReasonHost shape.
//
// Everything the engine reads from its environment is served from Maps and
// plain options here: no core imports, no real database, no real graph.
// The db port interprets just enough of the drizzle query-builder surface
// used by src/query.ts (insert / select-where-orderBy-limit / update /
// delete with eq()+and() conditions and desc() ordering) to run the real
// query code against Map-backed tables.
//
// installTestHost() configures the package singleton
// (configureCodeReasonHost) and returns handles for inspection and failure
// injection. resetTestHost() installs a fresh default host — the singleton
// has no "unconfigure", so resetting means replacing it.

type Row = Record<string, unknown>

type FakeSelectChain = {
  all(): Row[]
  limit(n: number): { all(): Row[] }
  orderBy(...orders: unknown[]): {
    all(): Row[]
    limit(n: number): { all(): Row[] }
  }
}

export type FakeTrx = {
  insert(table: object): { values(row: Row): { run(): void } }
  select(): { from(table: object): { where(cond: unknown): FakeSelectChain } }
  update(table: object): { set(patch: Row): { where(cond: unknown): { run(): void } } }
  delete(table: object): { where(cond: unknown): { run(): void } }
}

// ─── Drizzle condition interpretation ────────────────────────────────────
//
// src/query.ts builds conditions exclusively with eq(column, value) and
// and(...). Drizzle compiles those into SQL chunk trees where every bound
// value is a Param node whose `encoder` is the column itself. Walking the
// tree and ANDing every (encoder.name, value) pair therefore reproduces
// the exact filter semantics — no SQL parsing needed.

type Predicate = { column: string; value: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function collectPredicates(node: unknown, out: Predicate[]): void {
  if (!isRecord(node)) return
  const ctor = (node.constructor as { name?: string } | undefined)?.name
  if (ctor === "Param") {
    const encoder = node.encoder
    if (isRecord(encoder) && typeof encoder.name === "string") {
      out.push({ column: encoder.name, value: node.value })
    }
    return
  }
  const chunks = node.queryChunks
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) collectPredicates(chunk, out)
  }
}

function matchesCondition(cond: unknown, row: Row): boolean {
  if (cond === undefined || cond === null) return true
  const predicates: Predicate[] = []
  collectPredicates(cond, predicates)
  return predicates.every((p) => row[p.column] === p.value)
}

// desc(column) compiles to an SQL chunk tree containing the column node.
// Drizzle column objects carry a string `name` and a `table` back-reference.
function collectColumns(node: unknown, out: string[]): void {
  if (!isRecord(node)) return
  const ctor = (node.constructor as { name?: string } | undefined)?.name
  if (ctor !== undefined && ctor.startsWith("SQLite") && typeof node.name === "string" && "table" in node) {
    out.push(node.name as string)
    return
  }
  const chunks = node.queryChunks
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) collectColumns(chunk, out)
  }
}

class FakeTables {
  stores = new Map<object, Map<string, Row>>()

  store(table: object): Map<string, Row> {
    let store = this.stores.get(table)
    if (!store) {
      store = new Map()
      this.stores.set(table, store)
    }
    return store
  }

  snapshot(): Map<object, Map<string, Row>> {
    const snap = new Map<object, Map<string, Row>>()
    for (const [table, store] of this.stores) snap.set(table, new Map(store))
    return snap
  }

  restore(snap: Map<object, Map<string, Row>>): void {
    this.stores = snap
  }
}

export type FakeDbHooks = {
  /** Runs at the top of use()/transaction(). Throw to simulate an unavailable database. */
  beforeUse?: () => void
  /** Runs after a transaction callback succeeds, before the staged writes commit. Throw to simulate a commit-time failure. */
  beforeCommit?: () => void
}

export type FakeDb = {
  use<T>(callback: (trx: FakeTrx) => T): T
  transaction<T>(callback: (trx: FakeTrx) => T): T
  /** Raw row access for assertions, keyed by the row's `id`. */
  storeFor(table: object): Map<string, Row>
  hooks: FakeDbHooks
}

function createFakeDb(): FakeDb {
  const tables = new FakeTables()
  const hooks: FakeDbHooks = {}

  const trx: FakeTrx = {
    insert(table) {
      return {
        values(row: Row) {
          return {
            run() {
              tables.store(table).set(String(row.id), { ...row })
            },
          }
        },
      }
    },
    select() {
      return {
        from(table) {
          return {
            where(cond) {
              const matched = () =>
                [...tables.store(table).values()]
                  .filter((row) => matchesCondition(cond, row))
                  .map((row) => ({ ...row }))
              const sorted = (orders: unknown[]) => {
                const rows = matched()
                const columns: string[] = []
                for (const order of orders) collectColumns(order, columns)
                // Only desc() is used by src/query.ts — sort every extracted
                // column descending, last column breaking ties.
                for (const column of columns.reverse()) {
                  rows.sort((a, b) => {
                    const av = a[column] as number | string
                    const bv = b[column] as number | string
                    return av < bv ? 1 : av > bv ? -1 : 0
                  })
                }
                return rows
              }
              return {
                all: () => matched(),
                limit: (n: number) => ({ all: () => matched().slice(0, n) }),
                orderBy: (...orders: unknown[]) => ({
                  all: () => sorted(orders),
                  limit: (n: number) => ({ all: () => sorted(orders).slice(0, n) }),
                }),
              }
            },
          }
        },
      }
    },
    update(table) {
      return {
        set(patch: Row) {
          return {
            where(cond) {
              return {
                run() {
                  const store = tables.store(table)
                  for (const [key, row] of [...store]) {
                    if (matchesCondition(cond, row)) store.set(key, { ...row, ...patch })
                  }
                },
              }
            },
          }
        },
      }
    },
    delete(table) {
      return {
        where(cond) {
          return {
            run() {
              const store = tables.store(table)
              for (const [key, row] of [...store]) {
                if (matchesCondition(cond, row)) store.delete(key)
              }
            },
          }
        },
      }
    },
  }

  return {
    hooks,
    storeFor: (table) => tables.store(table),
    use(callback) {
      hooks.beforeUse?.()
      return callback(trx)
    },
    transaction(callback) {
      hooks.beforeUse?.()
      const snapshot = tables.snapshot()
      try {
        const result = callback(trx)
        hooks.beforeCommit?.()
        return result
      } catch (err) {
        // A transactional host leaves no partial state behind.
        tables.restore(snapshot)
        throw err
      }
    },
  }
}

// ─── Host assembly ────────────────────────────────────────────────────────

export type TestHostOptions = {
  projectID?: string
  projectRoot?: string
  worktreeRoot?: string
  vcs?: string
  graph?: FakeGraph
  containsPath?: (path: string) => boolean
  nativeScan?: boolean
  killTree?: CodeReasonHost["killTree"]
}

export type TestHost = {
  host: CodeReasonHost
  graph: FakeGraph
  db: FakeDb
  /** Mutable environment bag the host closures read from — tests can flip vcs/roots mid-test. */
  env: { projectID: string; projectRoot: string; worktreeRoot: string; vcs: string }
  events: {
    published: CorrelatedDiagnosticsPayload[]
    subscriberCount(): number
  }
  killTreeCalls: Array<{ pid: number | undefined; signal: NodeJS.Signals | number | undefined; alreadyExited: boolean }>
}

export function installTestHost(opts: TestHostOptions = {}): TestHost {
  const graph = opts.graph ?? createFakeGraph()
  const db = createFakeDb()
  const published: CorrelatedDiagnosticsPayload[] = []
  const subscribers = new Set<(event: DiagnosticEvent) => void>()
  const killTreeCalls: TestHost["killTreeCalls"] = []
  const env = {
    projectID: opts.projectID ?? "test-project",
    projectRoot: opts.projectRoot ?? "/repo",
    worktreeRoot: opts.worktreeRoot ?? "/repo",
    vcs: opts.vcs ?? "git",
  }

  const defaultContainsPath = (candidate: string): boolean => {
    const resolved = path.resolve(candidate)
    const inside = (root: string) => resolved === root || resolved.startsWith(root + path.sep)
    return inside(path.resolve(env.projectRoot)) || inside(path.resolve(env.worktreeRoot))
  }

  const defaultKillTree: CodeReasonHost["killTree"] = async (proc, killOpts) => {
    const alreadyExited = killOpts?.exited?.() ?? false
    killTreeCalls.push({ pid: proc.pid, signal: killOpts?.signal, alreadyExited })
    if (alreadyExited || proc.pid === undefined) return
    try {
      proc.kill(killOpts?.signal ?? "SIGKILL")
    } catch {
      // Already gone — nothing to escalate against.
    }
  }

  const host: CodeReasonHost = {
    projectID: () => env.projectID,
    projectRoot: () => env.projectRoot,
    worktreeRoot: () => env.worktreeRoot,
    projectVcs: () => env.vcs,
    containsPath: opts.containsPath ?? defaultContainsPath,
    flags: () => ({ nativeScan: opts.nativeScan ?? false }),
    graph: graph.port,
    // The fake trx is not a real drizzle handle — the cast is contained to
    // this fixture; engine code only sees the DreDbPort interface.
    db: db as unknown as DreDbPort,
    events: {
      subscribeClientDiagnostics(callback) {
        subscribers.add(callback)
        return () => subscribers.delete(callback)
      },
      publishCorrelatedDiagnostics(payload) {
        published.push(payload)
      },
    },
    killTree: opts.killTree ?? defaultKillTree,
    state: <S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) => {
      let initialized = false
      let value: S | undefined
      const get = (() => {
        if (!initialized) {
          value = init()
          initialized = true
        }
        return value as S
      }) as (() => S) & { invalidate: () => Promise<void> }
      get.invalidate = async () => {
        if (initialized && dispose) await dispose(value as Awaited<S>)
        initialized = false
        value = undefined
      }
      return get
    },
    bind: (fn) => fn,
  }

  // Keep engine logs out of test output; tests that care about logging
  // install their own sink.
  setLogSink(() => undefined)

  configureCodeReasonHost(host)
  return {
    host,
    graph,
    db,
    env,
    events: { published, subscriberCount: () => subscribers.size },
    killTreeCalls,
  }
}

// The host singleton has no "unconfigure" — resetting installs a fresh
// default host so no state (graph symbols, db rows, published events)
// leaks between tests.
export function resetTestHost(): TestHost {
  return installTestHost()
}
