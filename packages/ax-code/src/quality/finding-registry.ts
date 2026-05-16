// Single source of truth for Finding enum members. Adding a member here is the
// only sanctioned way to extend the v1 schema; consumer code that branches on
// these values must be updated in the same change. Structural changes to the
// Finding shape (new fields, removed fields, semantic shifts) are NOT additive
// and ship as schemaVersion 2 with parallel emit.

export const Severity = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const
export type Severity = (typeof Severity)[number]

export const Category = [
  "bug",
  "security",
  "regression_risk",
  "behavior_change",
  "missing_verification",
  "migration_safety",
] as const
export type Category = (typeof Category)[number]

export const Workflow = ["review", "debug", "qa"] as const
export type Workflow = (typeof Workflow)[number]

export const EvidenceRefKind = ["verification", "log", "graph", "diff"] as const
export type EvidenceRefKind = (typeof EvidenceRefKind)[number]

export const ArtifactRefKind = ["finding", "log", "diff", "snapshot"] as const
export type ArtifactRefKind = (typeof ArtifactRefKind)[number]
