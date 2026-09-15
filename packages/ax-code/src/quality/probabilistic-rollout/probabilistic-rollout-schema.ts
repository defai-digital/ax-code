import z from "zod"

export const Workflow = z.enum(["review", "debug", "qa"])
export type Workflow = z.output<typeof Workflow>

export const ArtifactKind = z.enum([
  "review_run",
  "review_finding",
  "debug_case",
  "debug_hypothesis",
  "qa_run",
  "qa_failure",
])
export type ArtifactKind = z.output<typeof ArtifactKind>

export const LabelSource = z.enum(["human", "system", "imported"])
export type LabelSource = z.output<typeof LabelSource>

export const ReviewRunOutcome = z.enum(["clean", "findings_accepted", "findings_dismissed", "unresolved"])
export const ReviewFindingOutcome = z.enum(["accepted", "dismissed", "superseded", "unresolved"])
export const DebugOutcome = z.enum(["validated", "rejected", "superseded", "unresolved"])
export const QARunOutcome = z.enum(["passed", "failed", "flaky", "unresolved"])
export const QAFailureOutcome = z.enum(["reproduced", "resolved", "not_reproduced", "unresolved"])

const LabelBase = z.object({
  labelID: z.string(),
  artifactID: z.string(),
  workflow: Workflow,
  projectID: z.string(),
  sessionID: z.string().optional(),
  labeledAt: z.string(),
  labelSource: LabelSource,
  labelVersion: z.number().int().positive().default(1),
  outcomeReason: z.string().optional(),
})

export const ReviewRunLabel = LabelBase.extend({
  artifactKind: z.literal("review_run"),
  workflow: z.literal("review"),
  outcome: ReviewRunOutcome,
})

export const ReviewFindingLabel = LabelBase.extend({
  artifactKind: z.literal("review_finding"),
  workflow: z.literal("review"),
  outcome: ReviewFindingOutcome,
})

export const DebugCaseLabel = LabelBase.extend({
  artifactKind: z.literal("debug_case"),
  workflow: z.literal("debug"),
  outcome: DebugOutcome,
})

export const DebugHypothesisLabel = LabelBase.extend({
  artifactKind: z.literal("debug_hypothesis"),
  workflow: z.literal("debug"),
  outcome: DebugOutcome,
})

export const QARunLabel = LabelBase.extend({
  artifactKind: z.literal("qa_run"),
  workflow: z.literal("qa"),
  outcome: QARunOutcome,
})

export const QAFailureLabel = LabelBase.extend({
  artifactKind: z.literal("qa_failure"),
  workflow: z.literal("qa"),
  outcome: QAFailureOutcome,
})

export const Label = z.discriminatedUnion("artifactKind", [
  ReviewRunLabel,
  ReviewFindingLabel,
  DebugCaseLabel,
  DebugHypothesisLabel,
  QARunLabel,
  QAFailureLabel,
])
export type Label = z.output<typeof Label>

export const LabelFile = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-label-file"),
  labels: Label.array(),
})
export type LabelFile = z.output<typeof LabelFile>

export const ToolSummary = z.object({
  tool: z.string(),
  callID: z.string(),
  status: z.enum(["completed", "error"]),
  timeCreated: z.number(),
  durationMs: z.number(),
  findingCount: z.number().int().nonnegative().optional(),
  riskLabel: z.string().optional(),
  riskScore: z.number().optional(),
  confidence: z.number().optional(),
  truncated: z.boolean().optional(),
  error: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
})
export type ToolSummary = z.output<typeof ToolSummary>

export const ReplayItem = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-replay-item"),
  workflow: Workflow,
  artifactKind: ArtifactKind,
  artifactID: z.string(),
  sessionID: z.string(),
  projectID: z.string(),
  title: z.string(),
  createdAt: z.string(),
  baseline: z.object({
    source: z.string(),
    confidence: z.number().nullable(),
    score: z.number().nullable().optional(),
    readiness: z.string().nullable().optional(),
    rank: z.number().int().nullable().optional(),
  }),
  context: z.object({
    directory: z.string(),
    graphCommitSha: z.string().nullable(),
    touchedFiles: z.string().array(),
    diffSummary: z.object({
      files: z.number().int().nonnegative(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
    }),
    eventCount: z.number().int().nonnegative(),
    toolCount: z.number().int().nonnegative(),
  }),
  evidence: z.object({
    toolSummaries: ToolSummary.array(),
    summary: z.record(z.string(), z.unknown()).optional(),
    finding: z.record(z.string(), z.unknown()).optional(),
  }),
})
export type ReplayItem = z.output<typeof ReplayItem>

export const ReplayExport = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-replay-export"),
  workflow: Workflow,
  sessionID: z.string(),
  exportedAt: z.string(),
  items: ReplayItem.array(),
})
export type ReplayExport = z.output<typeof ReplayExport>

export const ReplayReadinessGate = z.object({
  name: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string(),
})
export type ReplayReadinessGate = z.output<typeof ReplayReadinessGate>

export const ReplayReadinessSummary = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-replay-readiness-summary"),
  workflow: Workflow,
  sessionID: z.string(),
  projectID: z.string(),
  exportedAt: z.string(),
  totalItems: z.number().int().nonnegative(),
  anchorItems: z.number().int().nonnegative(),
  evidenceItems: z.number().int().nonnegative(),
  toolSummaryCount: z.number().int().nonnegative(),
  labeledItems: z.number().int().nonnegative(),
  resolvedLabeledItems: z.number().int().nonnegative(),
  unresolvedLabeledItems: z.number().int().nonnegative(),
  missingLabels: z.number().int().nonnegative(),
  readyForBenchmark: z.boolean(),
  overallStatus: z.enum(["pass", "warn", "fail"]),
  nextAction: z.string().nullable(),
  gates: ReplayReadinessGate.array(),
})
export type ReplayReadinessSummary = z.output<typeof ReplayReadinessSummary>

export const ReplayReadinessFile = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-replay-readiness-file"),
  workflow: Workflow,
  generatedAt: z.string(),
  summaries: ReplayReadinessSummary.array(),
})
export type ReplayReadinessFile = z.output<typeof ReplayReadinessFile>

export const UserFacingReadinessState = z.enum(["blocked", "needs_labels", "not_ready", "ready"])
export type UserFacingReadinessState = z.output<typeof UserFacingReadinessState>
export type UserFacingReadinessKind = "low" | "medium" | "high"

export const CalibrationRecord = z.object({
  artifactID: z.string(),
  sessionID: z.string(),
  workflow: Workflow,
  artifactKind: ArtifactKind,
  source: z.string(),
  confidence: z.number(),
  score: z.number().nullable().optional(),
  readiness: z.string().nullable().optional(),
  actualPositive: z.boolean(),
  predictedPositive: z.boolean(),
  abstained: z.boolean(),
  outcome: z.string(),
})
export type CalibrationRecord = z.output<typeof CalibrationRecord>

export const CalibrationSummary = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-calibration-summary"),
  source: z.string(),
  threshold: z.number(),
  abstainBelow: z.number().nullable(),
  totalItems: z.number().int().nonnegative(),
  scoredItems: z.number().int().nonnegative(),
  missingPredictionItems: z.number().int().nonnegative(),
  labeledItems: z.number().int().nonnegative(),
  consideredItems: z.number().int().nonnegative(),
  abstainedItems: z.number().int().nonnegative(),
  positives: z.number().int().nonnegative(),
  negatives: z.number().int().nonnegative(),
  precision: z.number().nullable(),
  recall: z.number().nullable(),
  falsePositiveRate: z.number().nullable(),
  falseNegativeRate: z.number().nullable(),
  precisionAt1: z.number().nullable(),
  precisionAt3: z.number().nullable(),
  calibrationError: z.number().nullable(),
  bins: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      count: z.number().int().nonnegative(),
      avgConfidence: z.number().nullable(),
      empiricalRate: z.number().nullable(),
    }),
  ),
})
export type CalibrationSummary = z.output<typeof CalibrationSummary>

export const Prediction = z.object({
  artifactID: z.string(),
  sessionID: z.string().optional(),
  workflow: Workflow.optional(),
  artifactKind: ArtifactKind.optional(),
  source: z.string(),
  confidence: z.number().nullable(),
  score: z.number().nullable().optional(),
  readiness: z.string().nullable().optional(),
  rank: z.number().int().nullable().optional(),
})
export type Prediction = z.output<typeof Prediction>

export const PredictionFile = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-prediction-file"),
  source: z.string(),
  generatedAt: z.string(),
  predictions: Prediction.array(),
})
export type PredictionFile = z.output<typeof PredictionFile>

export const MetricComparison = z.object({
  baseline: z.number().nullable(),
  candidate: z.number().nullable(),
  delta: z.number().nullable(),
  direction: z.enum(["higher_is_better", "lower_is_better"]),
  improvement: z.boolean(),
  regression: z.boolean(),
})
export type MetricComparison = z.output<typeof MetricComparison>

export const ComparisonGate = z.object({
  name: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string(),
})
export type ComparisonGate = z.output<typeof ComparisonGate>

export const CalibrationComparison = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-calibration-comparison"),
  baselineSource: z.string(),
  candidateSource: z.string(),
  overallStatus: z.enum(["pass", "warn", "fail"]),
  dataset: z.object({
    baselineTotalItems: z.number().int().nonnegative(),
    candidateTotalItems: z.number().int().nonnegative(),
    baselineScoredItems: z.number().int().nonnegative(),
    candidateScoredItems: z.number().int().nonnegative(),
    baselineLabeledItems: z.number().int().nonnegative(),
    candidateLabeledItems: z.number().int().nonnegative(),
    baselineMissingPredictionItems: z.number().int().nonnegative(),
    candidateMissingPredictionItems: z.number().int().nonnegative(),
  }),
  metrics: z.object({
    precision: MetricComparison,
    recall: MetricComparison,
    falsePositiveRate: MetricComparison,
    falseNegativeRate: MetricComparison,
    precisionAt1: MetricComparison,
    precisionAt3: MetricComparison,
    calibrationError: MetricComparison,
  }),
  gates: ComparisonGate.array(),
})
export type CalibrationComparison = z.output<typeof CalibrationComparison>

export const ShadowDecision = z.object({
  source: z.string(),
  available: z.boolean(),
  confidence: z.number().nullable(),
  score: z.number().nullable().optional(),
  readiness: z.string().nullable().optional(),
  rank: z.number().int().nullable().optional(),
  threshold: z.number(),
  abstainBelow: z.number().nullable(),
  predictedPositive: z.boolean().nullable(),
  abstained: z.boolean(),
})
export type ShadowDecision = z.output<typeof ShadowDecision>

export const ShadowRecord = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-shadow-record"),
  artifactID: z.string(),
  sessionID: z.string(),
  workflow: Workflow,
  artifactKind: ArtifactKind,
  title: z.string(),
  createdAt: z.string(),
  capturedAt: z.string().optional(),
  baseline: ShadowDecision,
  candidate: ShadowDecision,
  disagreement: z.object({
    candidateMissing: z.boolean(),
    predictionChanged: z.boolean(),
    abstentionChanged: z.boolean(),
    confidenceDelta: z.number().nullable(),
    rankDelta: z.number().int().nullable(),
  }),
})
export type ShadowRecord = z.output<typeof ShadowRecord>

export const ShadowFile = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-shadow-file"),
  baselineSource: z.string(),
  candidateSource: z.string(),
  generatedAt: z.string(),
  records: ShadowRecord.array(),
})
export type ShadowFile = z.output<typeof ShadowFile>

export const ShadowSummary = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-shadow-summary"),
  baselineSource: z.string(),
  candidateSource: z.string(),
  totalItems: z.number().int().nonnegative(),
  comparableItems: z.number().int().nonnegative(),
  missingCandidateItems: z.number().int().nonnegative(),
  predictionChangedItems: z.number().int().nonnegative(),
  abstentionChangedItems: z.number().int().nonnegative(),
  avgConfidenceDelta: z.number().nullable(),
  maxAbsConfidenceDelta: z.number().nullable(),
  candidatePromotions: z.number().int().nonnegative(),
  candidateDemotions: z.number().int().nonnegative(),
})
export type ShadowSummary = z.output<typeof ShadowSummary>
