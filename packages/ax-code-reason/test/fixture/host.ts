// In-memory fake of the CURRENT (post-Phase-2) CodeReasonHost shape.
//
// Phase 2 (D2, E3): engine modules no longer touch a drizzle handle
// directly. Every persistence operation goes through host.stores.* — a
// pair of `PlanRepository` / `EmbeddingRepository` interfaces. The fake
// hosts two Map-backed repository implementations plus the new
// environment accessors (`sourceState` / `graphRevision` / `clock` /
// `abort`) the engine consults from long-running entrypoints.
//
// The host is fully in-process: no core imports, no real database, no
// real graph. Production wiring (drizzle + Database.use/transaction)
// lives in core/packages/ax-code/src/dre/repositories.ts; the engine
// sees only the narrow interfaces.

import path from "path"
import {
  configureCodeReasonHost,
  type CodeReasonHost,
  type CorrelatedDiagnosticsPayload,
  type DiagnosticEvent,
} from "../../src/host"
import type { ProjectID } from "../../src/id"
import { RefactorPlanID, EmbeddingCacheID } from "../../src/id"
import {
  type DebugEngineStores,
  type PlanInsert,
  type PlanListOptions,
  type PlanRepository,
  type PlanRow,
  type EmbeddingInsert,
  type EmbeddingRepository,
  type EmbeddingRow,
} from "../../src/repository"
import type { RefactorPlanStatus } from "../../src/schema.sql"
import type { SourceState } from "../../src/quality/freshness"
import { setLogSink } from "../../src/log"
import { createFakeGraph, type FakeGraph } from "./graph"

// ─── Map-backed plan + embedding repositories ───────────────────────────
//
// Each repo exposes a `storeFor(projectID)` accessor for assertions —
// tests inspect raw rows by primary key (plan id) or node_id
// (embedding). This keeps test ergonomics close to the previous
// drizzle-backed FakeDb shape (`testHost.db.storeFor(table)`) so the
// test surface stays small after the Phase-2 port swap.
//
// `hooks.beforePlanWrite` / `hooks.beforeEmbeddingWrite` are thrown at
// the same boundary as the old `hooks.beforeCommit` was: the repo
// installs a one-shot throw that aborts the write before any rows are
// committed. Tests that exercise transaction-rollback semantics install
// a hook that throws.

type Row = Record<string, unknown>

class FakePlanRepository implements PlanRepository {
  rows: Map<string, Map<string, PlanRow>> = new Map()
  hooks: { beforePlanWrite?: () => void } = {}

  private table(projectID: ProjectID): Map<string, PlanRow> {
    let m = this.rows.get(projectID)
    if (!m) {
      m = new Map()
      this.rows.set(projectID, m)
    }
    return m
  }

  insertPlan(row: PlanInsert): void {
    this.hooks.beforePlanWrite?.()
    const t = this.table(row.project_id)
    const now = row.time_updated ?? Date.now()
    t.set(String(row.id), { ...row, time_updated: now })
  }

  getPlan(projectID: ProjectID, id: RefactorPlanID): PlanRow | undefined {
    return this.table(projectID).get(String(id))
  }

  listPlans(projectID: ProjectID, opts?: PlanListOptions): PlanRow[] {
    const limit = normalizeQueryLimit(opts?.limit)
    if (limit === 0) return []
    const all = [...this.table(projectID).values()]
    const filtered = opts?.status ? all.filter((r) => r.status === opts.status) : all
    filtered.sort((a, b) => b.time_created - a.time_created)
    return limit === undefined ? filtered : filtered.slice(0, limit)
  }

  updatePlanStatus(projectID: ProjectID, id: RefactorPlanID, status: RefactorPlanStatus): void {
    this.hooks.beforePlanWrite?.()
    const t = this.table(projectID)
    const row = t.get(String(id))
    if (!row) return
    t.set(String(id), { ...row, status, time_updated: Date.now() })
  }

  deletePlan(projectID: ProjectID, id: RefactorPlanID): void {
    this.hooks.beforePlanWrite?.()
    this.table(projectID).delete(String(id))
  }

  /** Raw row accessor (assertions) — keyed by plan id. */
  storeFor(projectID: ProjectID): Map<string, PlanRow> {
    return this.table(projectID)
  }

  /** Drop every row for a project (test helper). */
  __clearProject(projectID: ProjectID): void {
    this.rows.delete(projectID)
  }
}

class FakeEmbeddingRepository implements EmbeddingRepository {
  rows: Map<string, Map<string, EmbeddingRow>> = new Map()
  hooks: { beforeEmbeddingWrite?: () => void } = {}

  private table(projectID: ProjectID): Map<string, EmbeddingRow> {
    let m = this.rows.get(projectID)
    if (!m) {
      m = new Map()
      this.rows.set(projectID, m)
    }
    return m
  }

  upsertEmbedding(row: EmbeddingInsert): void {
    this.hooks.beforeEmbeddingWrite?.()
    const t = this.table(row.project_id)
    const existing = t.get(row.node_id)
    if (existing) t.delete(row.node_id)
    const now = row.time_updated ?? Date.now()
    t.set(row.node_id, { ...row, time_updated: now })
  }

  getEmbedding(projectID: ProjectID, nodeID: string): EmbeddingRow | undefined {
    return this.table(projectID).get(nodeID)
  }

  deleteEmbedding(projectID: ProjectID, nodeID: string): void {
    this.hooks.beforeEmbeddingWrite?.()
    this.table(projectID).delete(nodeID)
  }

  /** Raw row accessor (assertions) — keyed by node_id. */
  storeFor(projectID: ProjectID): Map<string, EmbeddingRow> {
    return this.table(projectID)
  }

  /** Drop every row for a project (test helper). */
  __clearProject(projectID: ProjectID): void {
    this.rows.delete(projectID)
  }
}

function normalizeQueryLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isFinite(limit)) return 0
  return Math.max(0, Math.floor(limit))
}

export type FakeStoreHooks = {
  /** Install a one-shot throw on the next plan write (simulates a persistence failure). */
  beforePlanWrite?: () => void
  /** Install a one-shot throw on the next embedding write. */
  beforeEmbeddingWrite?: () => void
}

export type FakePlanRepositoryHandle = FakePlanRepository & {
  __clearProject(projectID: ProjectID): void
  storeFor(projectID: ProjectID): Map<string, PlanRow>
}

export type FakeEmbeddingRepositoryHandle = FakeEmbeddingRepository & {
  __clearProject(projectID: ProjectID): void
  storeFor(projectID: ProjectID): Map<string, EmbeddingRow>
}

export type FakeStores = {
  plans: FakePlanRepositoryHandle
  embeddings: FakeEmbeddingRepositoryHandle
  /** Combined hook surface — tests flip either side without retyping the full shape. */
  hooks: FakeStoreHooks
}

function createFakeStores(): FakeStores {
  const plans = new FakePlanRepository()
  const embeddings = new FakeEmbeddingRepository()
  const combined: FakeStoreHooks = {
    set beforePlanWrite(fn: (() => void) | undefined) {
      plans.hooks.beforePlanWrite = fn
    },
    set beforeEmbeddingWrite(fn: (() => void) | undefined) {
      embeddings.hooks.beforeEmbeddingWrite = fn
    },
    get beforePlanWrite() {
      return plans.hooks.beforePlanWrite
    },
    get beforeEmbeddingWrite() {
      return embeddings.hooks.beforeEmbeddingWrite
    },
  }
  return {
    plans: plans as unknown as FakePlanRepositoryHandle,
    embeddings: embeddings as unknown as FakeEmbeddingRepositoryHandle,
    hooks: combined,
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
  /** Override the host's AbortSignal — defaults to a never-aborted controller. */
  signal?: AbortSignal
  /** Override the host clock — defaults to a deterministic counter. */
  now?: () => number
  /** Override the host's source-state implementation. */
  sourceState?: () => Promise<SourceState> | SourceState
  /** Override the host's graph-revision implementation. */
  graphRevision?: () => string | null
}

export type TestHost = {
  host: CodeReasonHost
  graph: FakeGraph
  stores: FakeStores
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
  const stores = createFakeStores()
  const published: CorrelatedDiagnosticsPayload[] = []
  const subscribers = new Set<(event: DiagnosticEvent) => void>()
  const killTreeCalls: TestHost["killTreeCalls"] = []
  let clockNow = 1000
  const clock: () => number = opts.now ?? (() => clockNow)
  const env = {
    projectID: opts.projectID ?? "test-project",
    projectRoot: opts.projectRoot ?? "/repo",
    worktreeRoot: opts.worktreeRoot ?? "/repo",
    vcs: opts.vcs ?? "git",
  }
  const signal = opts.signal ?? new AbortController().signal

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

  const defaultSourceState = (): SourceState => ({ available: false, commit: null, dirtyDigest: null })
  const sourceState: CodeReasonHost["sourceState"] = async () => {
    const override = opts.sourceState
    if (override) return Promise.resolve(override())
    return defaultSourceState()
  }
  const graphRevision: CodeReasonHost["graphRevision"] = opts.graphRevision ?? (() => null)

  const host: CodeReasonHost = {
    projectID: () => env.projectID,
    projectRoot: () => env.projectRoot,
    worktreeRoot: () => env.worktreeRoot,
    projectVcs: () => env.vcs,
    containsPath: opts.containsPath ?? defaultContainsPath,
    flags: () => ({ nativeScan: opts.nativeScan ?? false }),
    graph: graph.port,
    stores,
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
    state: <S>(
      init: () => S,
      dispose?: (state: Awaited<S>) => Promise<void>,
    ): (() => S) & { invalidate: () => Promise<void> } => {
      let initialized = false
      let value: S | undefined
      const get = ((): S => {
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
    bind: <F extends (...args: any[]) => any>(fn: F): F => fn,
    sourceState,
    graphRevision,
    clock,
    abort: () => signal,
  }

  // Keep engine logs out of test output; tests that care about logging
  // install their own sink.
  setLogSink(() => undefined)

  configureCodeReasonHost(host)
  return {
    host,
    graph,
    stores,
    env,
    events: { published, subscriberCount: () => subscribers.size },
    killTreeCalls,
  }
}

// The host singleton has no "unconfigure" — resetting installs a fresh
// default host so no state (graph symbols, repo rows, published events)
// leaks between tests.
export function resetTestHost(): TestHost {
  return installTestHost()
}

// ─── Branded helpers re-exported for tests ───────────────────────────────
//
// Kept here so tests don't need to also import schema.sql for trivial
// branded constructors. The host fixture is the canonical "everything
// the engine talks to" surface.
export { RefactorPlanID, EmbeddingCacheID }

// Avoid unused-row warnings when a test only cares about types.
export type { Row }
