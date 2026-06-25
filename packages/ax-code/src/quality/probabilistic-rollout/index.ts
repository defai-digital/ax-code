import {
  ProbabilisticRolloutSchema as Schema,
  ProbabilisticRolloutReadiness as Readiness,
} from "./helpers"

export namespace ProbabilisticRollout {
  // Schema re-exports
  export const Workflow = Schema.Workflow
  export type Workflow = z.output<typeof Workflow>

  export const ArtifactKind = Schema.ArtifactKind
  export type ArtifactKind = z.output<typeof ArtifactKind>

  export const LabelSource = Schema.LabelSource
  export type LabelSource = z.output<typeof LabelSource>

  export const ReviewRunOutcome = Schema.ReviewRunOutcome
  export const ReviewFindingOutcome = Schema.ReviewFindingOutcome
  export const DebugOutcome = Schema.DebugOutcome
  export const QARunOutcome = Schema.QARunOutcome
  export const QAFailureOutcome = Schema.QAFailureOutcome
  export const ReviewRunLabel = Schema.ReviewRunLabel
  export const ReviewFindingLabel = Schema.ReviewFindingLabel
  export const DebugCaseLabel = Schema.DebugCaseLabel
  export const DebugHypothesisLabel = Schema.DebugHypothesisLabel
  export const QARunLabel = Schema.QARunLabel
  export const QAFailureLabel = Schema.QAFailureLabel

  export const Label = Schema.Label
  export type Label = z.output<typeof Label>

  export const LabelFile = Schema.LabelFile
  export type LabelFile = z.output<typeof LabelFile>

  export const ToolSummary = Schema.ToolSummary
  export type ToolSummary = z.output<typeof ToolSummary>

  export const ReplayItem = Schema.ReplayItem
  export type ReplayItem = z.output<typeof ReplayItem>

  export const ReplayExport = Schema.ReplayExport
  export type ReplayExport = z.output<typeof ReplayExport>

  export const ReplayReadinessGate = Schema.ReplayReadinessGate
  export type ReplayReadinessGate = z.output<typeof ReplayReadinessGate>

  export const ReplayReadinessSummary = Schema.ReplayReadinessSummary
  export type ReplayReadinessSummary = z.output<typeof ReplayReadinessSummary>

  export const ReplayReadinessFile = Schema.ReplayReadinessFile
  export type ReplayReadinessFile = z.output<typeof ReplayReadinessFile>

  export const UserFacingReadinessState = Schema.UserFacingReadinessState
  export type UserFacingReadinessState = z.output<typeof UserFacingReadinessState>

  export const CalibrationRecord = Schema.CalibrationRecord
  export type CalibrationRecord = z.output<typeof CalibrationRecord>

  export const CalibrationSummary = Schema.CalibrationSummary
  export type CalibrationSummary = z.output<typeof CalibrationSummary>

  export const Prediction = Schema.Prediction
  export type Prediction = z.output<typeof Prediction>

  export const PredictionFile = Schema.PredictionFile
  export type PredictionFile = z.output<typeof PredictionFile>

  export const MetricComparison = Schema.MetricComparison
  export type MetricComparison = z.output<typeof MetricComparison>

  export const ComparisonGate = Schema.ComparisonGate
  export type ComparisonGate = z.output<typeof ComparisonGate>

  export const CalibrationComparison = Schema.CalibrationComparison
  export type CalibrationComparison = z.output<typeof CalibrationComparison>

  export const ShadowDecision = Schema.ShadowDecision
  export type ShadowDecision = z.output<typeof ShadowDecision>

  export const ShadowRecord = Schema.ShadowRecord
  export type ShadowRecord = z.output<typeof ShadowRecord>

  export const ShadowFile = Schema.ShadowFile
  export type ShadowFile = z.output<typeof ShadowFile>

  export const ShadowSummary = Schema.ShadowSummary
  export type ShadowSummary = z.output<typeof ShadowSummary>

  export type UserFacingReadinessKind = Schema.UserFacingReadinessKind

  // Readiness re-exports
  export const BLOCKING_GATE_NAMES = Readiness.BLOCKING_GATE_NAMES
  export const readinessState = Readiness.readinessState
  export const readinessStateLabel = Readiness.readinessStateLabel
  export const readinessStateKind = Readiness.readinessStateKind
  export const readinessCounts = Readiness.readinessCounts
  export const readinessResolvedLabelsSummary = Readiness.readinessResolvedLabelsSummary
  export const readinessDetailLabel = Readiness.readinessDetailLabel
  export const readinessNextActionLabel = Readiness.readinessNextActionLabel
  export const renderReplayReadinessReport = Readiness.renderReplayReadinessReport
  export const targetedTestRecommendations = Readiness.targetedTestRecommendations

  // Function exports
  export const exportReplay = _exportReplay
  export const summarizeReplayReadiness = _summarizeReplayReadiness
  export const calibrationRecords = _calibrationRecords
  export const summarizeCalibration = _summarizeCalibration
  export const renderCalibrationReport = _renderCalibrationReport
  export const compareCalibrationSummaries = _compareCalibrationSummaries
  export const renderCalibrationComparisonReport = _renderCalibrationComparisonReport
  export const buildShadowFile = _buildShadowFile
  export const summarizeShadowFile = _summarizeShadowFile
  export const renderShadowReport = _renderShadowReport
}

// Import with aliases to avoid name collisions with namespace members
import { exportReplay as _exportReplay, summarizeReplayReadiness as _summarizeReplayReadiness } from "./replay"
import {
  calibrationRecords as _calibrationRecords,
  summarizeCalibration as _summarizeCalibration,
  renderCalibrationReport as _renderCalibrationReport,
  compareCalibrationSummaries as _compareCalibrationSummaries,
  renderCalibrationComparisonReport as _renderCalibrationComparisonReport,
} from "./calibration"
import {
  buildShadowFile as _buildShadowFile,
  summarizeShadowFile as _summarizeShadowFile,
  renderShadowReport as _renderShadowReport,
} from "./shadow"
import type z from "zod"
