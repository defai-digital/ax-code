import { describe, expect, test } from "vitest"
import { readFileSync } from "fs"
import path from "path"

// Table-driven contract for the public subpath exports: every entry in
// package.json "exports" must resolve and expose its expected symbols.
// Imports go through the package's own name so the exports map itself is
// what gets exercised (Node self-reference resolution).

type Subpath = {
  name: string
  load: () => Promise<unknown>
  symbols: string[]
}

const SUBPATHS: Subpath[] = [
  {
    name: ".",
    load: () => import("@ax-code/ax-code-reason"),
    symbols: ["DebugEngine", "Incremental", "DiagnosticCorrelation", "prewarmAffectedFiles", "configureCodeReasonHost"],
  },
  {
    name: "./host",
    load: () => import("@ax-code/ax-code-reason/host"),
    symbols: ["configureCodeReasonHost", "codeReasonHost", "codeReasonHostMaybe"],
  },
  {
    name: "./id",
    load: () => import("@ax-code/ax-code-reason/id"),
    symbols: ["RefactorPlanID", "EmbeddingCacheID", "DebugPatternID", "CodeNodeID", "defineBrandedIdentifier"],
  },
  {
    name: "./query",
    load: () => import("@ax-code/ax-code-reason/query"),
    symbols: ["DebugEngineQuery"],
  },
  {
    name: "./runtime-debug",
    load: () => import("@ax-code/ax-code-reason/runtime-debug"),
    symbols: [
      "DebugCaseSchema",
      "DebugCaseRollupSchema",
      "DebugEvidenceSchema",
      "DebugHypothesisSchema",
      "DebugInstrumentationPlanSchema",
      "computeDebugCaseId",
      "computeDebugEvidenceId",
      "computeDebugHypothesisId",
      "computeDebugInstrumentationPlanId",
      "DEBUG_ID_PATTERN",
    ],
  },
  {
    name: "./analyze-bug",
    load: () => import("@ax-code/ax-code-reason/analyze-bug"),
    symbols: [
      "analyzeBugImpl",
      "parseTypeScriptStack",
      "parsePythonStack",
      "parseStackTrace",
      "detectStackFormat",
      "resolveFrame",
      "validateHypothesisCitations",
    ],
  },
  {
    name: "./analyze-impact",
    load: () => import("@ax-code/ax-code-reason/analyze-impact"),
    symbols: ["analyzeImpactImpl", "extractFilesFromDiff"],
  },
  {
    name: "./detect-duplicates",
    load: () => import("@ax-code/ax-code-reason/detect-duplicates"),
    symbols: ["detectDuplicatesImpl", "normalizeSignature"],
  },
  {
    name: "./diagnostic-correlation",
    load: () => import("@ax-code/ax-code-reason/diagnostic-correlation"),
    symbols: ["DiagnosticCorrelation"],
  },
  {
    name: "./language-scan",
    load: () => import("@ax-code/ax-code-reason/language-scan"),
    symbols: ["parseClippyOutput", "parseRuffOutput", "parseMypyOutput", "detectLanguage"],
  },
  {
    name: "./native-scan",
    load: () => import("@ax-code/ax-code-reason/native-scan"),
    symbols: ["parseNativeScanResult", "nativeScanFiles", "nativeReadFilesBatch"],
  },
  {
    name: "./plan-refactor",
    load: () => import("@ax-code/ax-code-reason/plan-refactor"),
    symbols: ["planRefactorImpl", "classifyIntent"],
  },
  {
    name: "./prewarm-lsp",
    load: () => import("@ax-code/ax-code-reason/prewarm-lsp"),
    symbols: ["prewarmAffectedFiles"],
  },
  {
    name: "./scanner-utils",
    load: () => import("@ax-code/ax-code-reason/scanner-utils"),
    symbols: ["isTestFile", "sortScannerFindings", "collectScannerFiles", "resolveScannerDefaults"],
  },
  {
    name: "./shadow-worktree",
    load: () => import("@ax-code/ax-code-reason/shadow-worktree"),
    symbols: ["ShadowWorktree"],
  },
  {
    name: "./verification-runner",
    load: () => import("@ax-code/ax-code-reason/verification-runner"),
    symbols: ["resolveCommands", "runCommand", "runCheck", "runTests", "RUN_COMMAND_TIMEOUT_MS", "parsePackageScripts"],
  },
  {
    name: "./verify-after-fix",
    load: () => import("@ax-code/ax-code-reason/verify-after-fix"),
    symbols: [
      "classifyEnvelope",
      "classifyEnvelopeSet",
      "applyVerificationToHypothesis",
      "applyVerificationSetToHypothesis",
      "resolveCaseStatus",
    ],
  },
  {
    name: "./quality/digest",
    load: () => import("@ax-code/ax-code-reason/quality/digest"),
    symbols: ["sha256Hex", "sha256JsonHex"],
  },
  {
    name: "./quality/finding",
    load: () => import("@ax-code/ax-code-reason/quality/finding"),
    symbols: ["FindingSchema", "computeFindingId", "FINDING_ID_PATTERN", "RULE_ID_PATTERN"],
  },
  {
    name: "./quality/finding-registry",
    load: () => import("@ax-code/ax-code-reason/quality/finding-registry"),
    symbols: ["Severity", "Category", "Workflow", "EvidenceRefKind", "ArtifactRefKind", "SEVERITY_RANK"],
  },
  {
    name: "./quality/freshness",
    load: () => import("@ax-code/ax-code-reason/quality/freshness"),
    symbols: ["SourceStateSchema", "classifyEnvelopeFreshness", "enforceCitationFreshness"],
  },
  {
    name: "./quality/verification-envelope",
    load: () => import("@ax-code/ax-code-reason/quality/verification-envelope"),
    symbols: [
      "VerificationEnvelopeSchema",
      "computeEnvelopeId",
      "verificationEnvelopesFromPayload",
      "ENVELOPE_ID_PATTERN",
    ],
  },
  {
    name: "./log",
    load: () => import("@ax-code/ax-code-reason/log"),
    symbols: ["setLogSink", "createLogger"],
  },
]

describe("public subpath exports", () => {
  test("the table covers every subpath declared in package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")) as {
      exports: Record<string, string>
    }
    expect(SUBPATHS.map((s) => s.name).sort()).toEqual(Object.keys(pkg.exports).sort())
  })

  for (const subpath of SUBPATHS) {
    test(`@ax-code/ax-code-reason${subpath.name === "." ? "" : ` ${subpath.name}`} exposes its public symbols`, async () => {
      const mod = (await subpath.load()) as Record<string, unknown>
      for (const symbol of subpath.symbols) {
        expect(mod, `missing symbol "${symbol}" from subpath "${subpath.name}"`).toHaveProperty(symbol)
      }
    })
  }
})
