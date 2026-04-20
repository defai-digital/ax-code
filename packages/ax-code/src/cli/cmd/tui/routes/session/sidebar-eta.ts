export type ContextEtaRun = {
  startedAt: number
  startTokens: number
}

export type ContextEtaSample = {
  time: number
  tokens: number
}

const ETA_MIN_ELAPSED_SEC = 10
const ETA_MIN_CONSUMED_TOKENS = 512
const ETA_SAMPLE_INTERVAL_MS = 5_000
const ETA_EMA_ALPHA = 0.2

export function estimateContextEta(input: {
  now: number
  limit: number
  totalTokens: number
  run: ContextEtaRun
  prevSample?: ContextEtaSample
  smoothRate?: number
}) {
  let prevSample = input.prevSample
  let smoothRate = input.smoothRate

  if (input.limit <= 0) return { prevSample, smoothRate }

  const elapsedSec = Math.max(0, Math.round((input.now - input.run.startedAt) / 1000))
  const consumed = Math.max(0, input.totalTokens - input.run.startTokens)

  if (!prevSample) {
    prevSample = { time: input.now, tokens: input.totalTokens }
  }

  if (elapsedSec < ETA_MIN_ELAPSED_SEC || consumed < ETA_MIN_CONSUMED_TOKENS) {
    return { prevSample, smoothRate }
  }

  const runRate = consumed / elapsedSec

  if (prevSample && input.now - prevSample.time >= ETA_SAMPLE_INTERVAL_MS) {
    const dt = (input.now - prevSample.time) / 1000
    const deltaTokens = input.totalTokens - prevSample.tokens

    if (dt > 0 && deltaTokens > 0) {
      const instantRate = deltaTokens / dt
      smoothRate = smoothRate !== undefined ? smoothRate * (1 - ETA_EMA_ALPHA) + instantRate * ETA_EMA_ALPHA : runRate
    }

    prevSample = { time: input.now, tokens: input.totalTokens }
  }

  const tokPerSec = smoothRate ?? runRate
  if (tokPerSec <= 0) return { prevSample, smoothRate }

  const remaining = input.limit - input.totalTokens
  if (remaining <= 0) {
    return {
      prevSample,
      smoothRate,
      estimate: {
        computedAt: input.now,
        remainSec: 0,
        totalSec: elapsedSec,
      },
    }
  }

  const remainSec = Math.max(1, Math.round(remaining / tokPerSec))

  return {
    prevSample,
    smoothRate,
    estimate: {
      computedAt: input.now,
      remainSec,
      totalSec: elapsedSec + remainSec,
    },
  }
}

export function formatContextEtaLabel(remainSec: number) {
  const h = Math.floor(remainSec / 3600)
  const m = Math.floor((remainSec % 3600) / 60)
  const sec = remainSec % 60

  if (h > 0) return `ctx full ~${h}h ${m}m`
  if (m > 0) return `ctx full ~${m}m ${sec}s`
  return `ctx full ~${sec}s`
}
