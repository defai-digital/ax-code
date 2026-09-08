import { Database } from "../storage/db"
import { Session } from "./index"
import { SessionTable } from "./session.sql"
import { providerModelKey } from "../provider/model-key"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"

const log = Log.create({ service: "session.usage" })

const MS_IN_DAY = 24 * 60 * 60 * 1000
const BATCH_SIZE = 20

/**
 * Usage aggregation for the web dashboard. One batched pass over sessions and
 * their messages produces totals, a per-day activity series, per-model and
 * per-tool breakdowns, and per-session token counts.
 *
 * Deliberately separate from cli/cmd/stats.ts: the dashboard needs the per-day
 * series and per-session map that the CLI report does not compute, and the CLI
 * output must not change as the dashboard evolves.
 */
export namespace SessionUsage {
  export type Tokens = {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }

  export type ModelUsage = {
    messages: number
    tokens: number
  }

  export type DayUsage = {
    /** local calendar day, YYYY-MM-DD */
    day: string
    sessions: number
    tokens: number
  }

  export type Info = {
    days: number | undefined
    sessions: number
    messages: number
    tokens: Tokens
    totalTokens: number
    /** cacheRead / (input + cacheRead), undefined when no tokens recorded */
    cacheShare: number | undefined
    models: Record<string, ModelUsage>
    tools: Record<string, number>
    /** chronological, one entry per day in the window (empty days included); empty when days is undefined */
    perDay: DayUsage[]
    perSession: Record<string, number>
    activeDays: number
  }

  function dayKey(ts: number) {
    const d = new Date(ts)
    const month = `${d.getMonth() + 1}`.padStart(2, "0")
    const day = `${d.getDate()}`.padStart(2, "0")
    return `${d.getFullYear()}-${month}-${day}`
  }

  function emptyTokens(): Tokens {
    return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  }

  function totalTokens(tokens: Tokens) {
    return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  }

  export async function load(input: { days?: number; projectID?: string; sessionID?: string }): Promise<Info> {
    const cutoff = (() => {
      if (input.days === undefined) return 0
      if (input.days === 0) {
        const now = new Date()
        now.setHours(0, 0, 0, 0)
        return now.getTime()
      }
      return Date.now() - input.days * MS_IN_DAY
    })()

    const rows = Database.use((db) => db.select().from(SessionTable).all())
    const sessions = rows
      .flatMap((row) => {
        const next = Session.safe(row)
        return next ? [next] : []
      })
      .filter((session) => {
        if (input.sessionID && session.id !== input.sessionID) return false
        if (input.projectID && session.projectID !== input.projectID) return false
        if (cutoff > 0 && session.time.updated < cutoff) return false
        return true
      })

    const info: Info = {
      days: input.days,
      sessions: sessions.length,
      messages: 0,
      tokens: emptyTokens(),
      totalTokens: 0,
      cacheShare: undefined,
      models: {},
      tools: {},
      perDay: [],
      perSession: {},
      activeDays: 0,
    }

    const perDay = new Map<string, DayUsage>()
    if (input.days !== undefined) {
      const windowDays = Math.max(1, input.days)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      for (let i = windowDays - 1; i >= 0; i--) {
        const ts = today.getTime() - i * MS_IN_DAY
        const key = dayKey(ts)
        perDay.set(key, { day: key, sessions: 0, tokens: 0 })
      }
    }

    const bumpDay = (ts: number, tokens: number) => {
      const key = dayKey(ts)
      const entry = perDay.get(key)
      if (!entry) return
      entry.tokens += tokens
    }

    for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
      const batch = sessions.slice(i, i + BATCH_SIZE)
      const settled = await Promise.allSettled(
        batch.map(async (session) => {
          const messages = await Session.messages({ sessionID: session.id })
          return { session, messages }
        }),
      )

      for (const entry of settled) {
        if (entry.status === "rejected") {
          log.warn("usage aggregation batch failed", { error: toErrorMessage(entry.reason) })
          continue
        }
        const { session, messages } = entry.value
        info.messages += messages.length

        const sessionTokens = emptyTokens()
        const sessionDay = perDay.get(dayKey(session.time.created))
        if (sessionDay) sessionDay.sessions += 1

        for (const message of messages) {
          if (message.info.role === "assistant" && message.info.tokens) {
            const tokens = message.info.tokens
            sessionTokens.input += tokens.input ?? 0
            sessionTokens.output += tokens.output ?? 0
            sessionTokens.reasoning += tokens.reasoning ?? 0
            sessionTokens.cache.read += tokens.cache?.read ?? 0
            sessionTokens.cache.write += tokens.cache?.write ?? 0

            const model = providerModelKey(message.info)
            const modelEntry = (info.models[model] ??= { messages: 0, tokens: 0 })
            modelEntry.messages++
            modelEntry.tokens +=
              (tokens.input ?? 0) +
              (tokens.output ?? 0) +
              (tokens.reasoning ?? 0) +
              (tokens.cache?.read ?? 0) +
              (tokens.cache?.write ?? 0)

            bumpDay(
              message.info.time.created,
              totalTokens({
                input: tokens.input ?? 0,
                output: tokens.output ?? 0,
                reasoning: tokens.reasoning ?? 0,
                cache: { read: tokens.cache?.read ?? 0, write: tokens.cache?.write ?? 0 },
              }),
            )
          }

          for (const part of message.parts) {
            if (part.type === "tool" && part.tool) {
              info.tools[part.tool] = (info.tools[part.tool] ?? 0) + 1
            }
          }
        }

        info.tokens.input += sessionTokens.input
        info.tokens.output += sessionTokens.output
        info.tokens.reasoning += sessionTokens.reasoning
        info.tokens.cache.read += sessionTokens.cache.read
        info.tokens.cache.write += sessionTokens.cache.write
        info.perSession[session.id] = totalTokens(sessionTokens)
      }
    }

    info.totalTokens = totalTokens(info.tokens)
    const cacheBase = info.tokens.input + info.tokens.cache.read
    info.cacheShare = cacheBase > 0 ? info.tokens.cache.read / cacheBase : undefined
    info.perDay = [...perDay.values()]
    info.activeDays = info.perDay.filter((day) => day.sessions > 0 || day.tokens > 0).length
    return info
  }
}
