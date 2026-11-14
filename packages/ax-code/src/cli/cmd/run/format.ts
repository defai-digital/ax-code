// `--format json` is a newline-delimited JSON (NDJSON) event stream — one
// JSON object per line, not a single JSON document — kept as-is for backward
// compatibility. `jsonl` and `ndjson` are explicit aliases for the same
// stream (#419).
export function isRunEventStreamFormat(format: string | undefined): boolean {
  return format === "json" || format === "jsonl" || format === "ndjson"
}
