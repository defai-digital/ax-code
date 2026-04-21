import fs from "fs/promises"
import path from "path"
import { Flag } from "../flag/flag"
import type { Risk } from "../risk/score"
import type { Session } from "../session"
import { Log } from "../util/log"
import { QualityCalibrationModel } from "./calibration-model"
import { QualityModelRegistry } from "./model-registry"
import { ProbabilisticRollout } from "./probabilistic-rollout"
import { QualityShadowStore } from "./shadow-store"

const log = Log.create({ service: "quality.shadow" })

type PredictionCache = {
  file: ProbabilisticRollout.PredictionFile
  mtimeMs: number
  path: string
}

type ModelCache = {
  file: QualityCalibrationModel.ModelFile
  mtimeMs: number
  path: string
}

let predictionCache: PredictionCache | undefined
let modelCache: ModelCache | undefined

export namespace QualityShadow {
  function numberField(input: Record<string, unknown> | undefined, key: string) {
    const value = input?.[key]
    return typeof value === "number" ? value : undefined
  }

  function booleanField(input: Record<string, unknown> | undefined, key: string) {
    const value = input?.[key]
    return typeof value === "boolean" ? value : undefined
  }

  function touchedFiles(session: Session.Info) {
    return [...new Set(session.summary?.diffs?.map((diff) => diff.file) ?? [])]
  }

  function replayItem(session: Session.Info, assessment: Risk.Assessment): ProbabilisticRollout.ReplayItem {
    return {
      schemaVersion: 1,
      kind: "ax-code-quality-replay-item",
      workflow: "review",
      artifactKind: "review_run",
      artifactID: `review:${session.id}`,
      sessionID: session.id,
      projectID: session.projectID,
      title: session.title,
      createdAt: new Date(session.time.created).toISOString(),
      baseline: {
        source: "Risk.assess",
        confidence: assessment.confidence,
        score: assessment.score,
        readiness: assessment.readiness,
        rank: null,
      },
      context: {
        directory: session.directory,
        graphCommitSha: null,
        touchedFiles: touchedFiles(session),
        diffSummary: {
          files: session.summary?.files ?? 0,
          additions: session.summary?.additions ?? 0,
          deletions: session.summary?.deletions ?? 0,
        },
        eventCount: 0,
        toolCount: 0,
      },
      evidence: {
        toolSummaries: [],
        summary: {
          level: assessment.level,
          score: assessment.score,
          readiness: assessment.readiness,
          summary: assessment.summary,
        },
      },
    }
  }

  function debugReplayItem(input: {
    session: Session.Info
    callID: string
    error: string
    stackTrace?: string
    metadata?: Record<string, unknown>
  }): ProbabilisticRollout.ReplayItem {
    return {
      schemaVersion: 1,
      kind: "ax-code-quality-replay-item",
      workflow: "debug",
      artifactKind: "debug_hypothesis",
      artifactID: `debug:${input.session.id}:${input.callID}`,
      sessionID: input.session.id,
      projectID: input.session.projectID,
      title: input.error.slice(0, 120),
      createdAt: new Date(input.session.time.created).toISOString(),
      baseline: {
        source: "debug_analyze",
        confidence: numberField(input.metadata, "confidence") ?? null,
        score: null,
        readiness: null,
        rank: 1,
      },
      context: {
        directory: input.session.directory,
        graphCommitSha: null,
        touchedFiles: touchedFiles(input.session),
        diffSummary: {
          files: input.session.summary?.files ?? 0,
          additions: input.session.summary?.additions ?? 0,
          deletions: input.session.summary?.deletions ?? 0,
        },
        eventCount: 0,
        toolCount: 1,
      },
      evidence: {
        toolSummaries: [
          {
            tool: "debug_analyze",
            callID: input.callID,
            status: "completed",
            timeCreated: input.session.time.updated ?? input.session.time.created,
            durationMs: 0,
            confidence: numberField(input.metadata, "confidence"),
            truncated: booleanField(input.metadata, "truncated"),
            input: {
              error: input.error,
              stackTrace: input.stackTrace,
            },
          },
        ],
        summary: {
          error: input.error,
          hasStackTrace: typeof input.stackTrace === "string",
          chainLength: numberField(input.metadata, "chainLength"),
          resolvedCount: numberField(input.metadata, "resolvedCount"),
          truncated: booleanField(input.metadata, "truncated"),
        },
      },
    }
  }

  async function loadPredictionFile() {
    if (!Flag.AX_CODE_EXPERIMENTAL_QUALITY_SHADOW) return
    const configured = Flag.AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS
    if (!configured) return

    const resolved = path.resolve(configured)
    const stat = await fs.stat(resolved)
    if (predictionCache && predictionCache.path === resolved && predictionCache.mtimeMs === stat.mtimeMs) {
      return predictionCache.file
    }

    const parsed = ProbabilisticRollout.PredictionFile.parse(
      JSON.parse(await fs.readFile(resolved, "utf8")),
    )
    predictionCache = { file: parsed, mtimeMs: stat.mtimeMs, path: resolved }
    return parsed
  }

  async function loadModelFile() {
    if (!Flag.AX_CODE_EXPERIMENTAL_QUALITY_SHADOW) return
    const configured = Flag.AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL
    if (!configured) return

    const resolved = path.resolve(configured)
    const stat = await fs.stat(resolved)
    if (modelCache && modelCache.path === resolved && modelCache.mtimeMs === stat.mtimeMs) {
      return modelCache.file
    }

    const parsed = QualityCalibrationModel.ModelFile.parse(
      JSON.parse(await fs.readFile(resolved, "utf8")),
    )
    modelCache = { file: parsed, mtimeMs: stat.mtimeMs, path: resolved }
    return parsed
  }

  async function candidateFileForItem(item: ProbabilisticRollout.ReplayItem) {
    const model = await loadModelFile().catch((err) => {
      log.warn("quality shadow model load failed", { err })
      return
    })
    if (model) {
      return QualityCalibrationModel.predict([item], model)
    }

    const activeModel = await QualityModelRegistry.resolveActiveModel().catch((err) => {
      log.warn("quality shadow active model resolve failed", { err })
      return
    })
    if (activeModel) {
      return QualityCalibrationModel.predict([item], activeModel)
    }

    return loadPredictionFile().catch((err) => {
      log.warn("quality shadow prediction load failed", { err })
      return
    })
  }

  export async function captureSessionRisk(input: { session: Session.Info; assessment: Risk.Assessment }) {
    if (!Flag.AX_CODE_EXPERIMENTAL_QUALITY_SHADOW) return

    const item = replayItem(input.session, input.assessment)
    const candidateFile = await candidateFileForItem(item)
    if (!candidateFile) return

    const shadow = ProbabilisticRollout.buildShadowFile([item], candidateFile)
    const record = shadow.records[0]
    if (!record) return
    await QualityShadowStore.upsert(record)
  }

  export async function captureDebugAnalyze(input: {
    session: Session.Info
    callID: string
    error: string
    stackTrace?: string
    metadata?: Record<string, unknown>
  }) {
    if (!Flag.AX_CODE_EXPERIMENTAL_QUALITY_SHADOW) return

    const item = debugReplayItem(input)
    const candidateFile = await candidateFileForItem(item)
    if (!candidateFile) return

    const shadow = ProbabilisticRollout.buildShadowFile([item], candidateFile)
    const record = shadow.records[0]
    if (!record) return
    await QualityShadowStore.upsert(record)
  }
}
