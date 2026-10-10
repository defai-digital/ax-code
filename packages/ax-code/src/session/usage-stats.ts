import { and, inArray, sql } from "../storage/db"
import { providerModelKey } from "../provider/model-key"
import type { SessionID } from "./schema"
import { MessageTable, PartTable } from "./session.sql"
import type { SessionShard } from "./shard"

/**
 * Per-session usage aggregates computed inside SQLite.
 *
 * `ax-code stats` only needs token sums, a message count and tool-call counts.
 * Hydrating every message and part into JS (including large tool outputs) to
 * add them up cost ~38 s on a 10 GB database; aggregating with `json_extract`
 * keeps the payloads inside SQLite and transfers one row per group.
 */
export namespace SessionUsageStats {
  export type Tokens = { input: number; output: number; reasoning: number; cache: { read: number; write: number } }

  export type ModelUsage = { messages: number; tokens: Tokens }

  export type Aggregate = {
    messageCount: number
    models: Map<string, ModelUsage>
    tools: Map<string, number>
  }

  // Queries are always restricted by session so small windows (`--days 7`) use
  // the session indexes instead of scanning the whole database; measured on a
  // 10 GB store this is as fast as a full-table GROUP BY even for every session.
  // Chunking keeps each IN list well under SQLite's bound-parameter limit.
  const CHUNK = 500

  export function emptyTokens(): Tokens {
    return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  }

  /**
   * Aggregate usage for `sessionIDs` from one store. Sessions without messages
   * are absent from the result. Rows whose JSON is malformed are skipped
   * instead of failing the whole query.
   */
  export function load(store: SessionShard.Store, sessionIDs: readonly SessionID[]): Map<SessionID, Aggregate> {
    const result = new Map<SessionID, Aggregate>()
    const entry = (sessionID: SessionID) => {
      let aggregate = result.get(sessionID)
      if (!aggregate) {
        aggregate = { messageCount: 0, models: new Map(), tools: new Map() }
        result.set(sessionID, aggregate) // @scan-suppress lifecycle_scan - Call-local query output is bounded by the selected session IDs.
      }
      return aggregate
    }

    for (const scope of chunk(sessionIDs, CHUNK)) {
      const messageRows = store.use((db) => {
        const role = sql<string | null>`json_extract(${MessageTable.data}, '$.role')`
        const providerID = sql<string | null>`json_extract(${MessageTable.data}, '$.providerID')`
        const modelID = sql<string | null>`json_extract(${MessageTable.data}, '$.modelID')`
        const total = (path: string) =>
          sql<number>`coalesce(sum(json_extract(${MessageTable.data}, ${path})), 0)`.mapWith(Number)
        return db
          .select({
            sessionID: MessageTable.session_id,
            role,
            providerID,
            modelID,
            messages: sql<number>`count(*)`.mapWith(Number),
            input: total("$.tokens.input"),
            output: total("$.tokens.output"),
            reasoning: total("$.tokens.reasoning"),
            cacheRead: total("$.tokens.cache.read"),
            cacheWrite: total("$.tokens.cache.write"),
          })
          .from(MessageTable)
          .where(and(inArray(MessageTable.session_id, scope), sql`json_valid(${MessageTable.data})`))
          .groupBy(MessageTable.session_id, role, providerID, modelID)
          .all()
      })
      for (const row of messageRows) {
        const aggregate = entry(row.sessionID)
        aggregate.messageCount += row.messages
        if (row.role !== "assistant") continue
        const key = providerModelKey({ providerID: row.providerID ?? "", modelID: row.modelID ?? "" })
        const usage = aggregate.models.get(key) ?? { messages: 0, tokens: emptyTokens() }
        usage.messages += row.messages
        usage.tokens.input += row.input
        usage.tokens.output += row.output
        usage.tokens.reasoning += row.reasoning
        usage.tokens.cache.read += row.cacheRead
        usage.tokens.cache.write += row.cacheWrite
        aggregate.models.set(key, usage) // @scan-suppress lifecycle_scan - Call-local output is bounded by this session's SQL model groups.
      }

      const toolRows = store.use((db) => {
        const tool = sql<string | null>`json_extract(${PartTable.data}, '$.tool')`
        return db
          .select({
            sessionID: PartTable.session_id,
            tool,
            calls: sql<number>`count(*)`.mapWith(Number),
          })
          .from(PartTable)
          .where(
            and(
              inArray(PartTable.session_id, scope),
              sql`json_valid(${PartTable.data}) and json_extract(${PartTable.data}, '$.type') = 'tool'`,
            ),
          )
          .groupBy(PartTable.session_id, tool)
          .all()
      })
      for (const row of toolRows) {
        if (!row.tool) continue
        const tools = entry(row.sessionID).tools
        tools.set(row.tool, (tools.get(row.tool) ?? 0) + row.calls) // @scan-suppress lifecycle_scan - Call-local output is bounded by this session's SQL tool groups.
      }
    }
    return result
  }

  function chunk<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
    return out
  }
}
