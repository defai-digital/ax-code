import React from "react"
import { lazyWithChunkRecovery } from "@/lib/chunkLoadRecovery"
import type { DiffViewMode } from "../types"

export interface ToolDiffPreviewProps {
  diff: string
  diffViewMode: DiffViewMode
}

const ToolDiffPreview = lazyWithChunkRecovery(() =>
  import("./ToolDiffPreview").then((module) => ({ default: module.ToolDiffPreview })),
)

const PlainDiffFallback: React.FC<{ diff: string }> = ({ diff }) => (
  <pre
    className="m-0 overflow-auto whitespace-pre-wrap break-words rounded-lg p-2 typography-code"
    style={{
      backgroundColor: "var(--syntax-base-background)",
      color: "var(--syntax-base-foreground)",
    }}
  >
    {diff}
  </pre>
)

export const LazyToolDiffPreview: React.FC<ToolDiffPreviewProps> = (props) => (
  <React.Suspense fallback={<PlainDiffFallback diff={props.diff} />}>
    <ToolDiffPreview {...props} />
  </React.Suspense>
)
