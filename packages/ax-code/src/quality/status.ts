export type QualityStatus = "pass" | "warn" | "fail"

export function statusSeverity(status: QualityStatus) {
  return status === "fail" ? 2 : status === "warn" ? 1 : 0
}

export function summarizeOverallStatus(items: readonly { status: QualityStatus }[]) {
  const highest = items.reduce((max, item) => Math.max(max, statusSeverity(item.status)), 0)
  return highest === 2 ? "fail" : highest === 1 ? "warn" : "pass"
}
