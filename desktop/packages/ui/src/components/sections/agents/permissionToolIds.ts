const EDIT_COVERED_TOOL_IDS = new Set(["write", "patch", "multiedit"])

export const normalizePermissionToolIds = (ids: readonly unknown[]): string[] => {
  const normalized: string[] = []

  for (const id of ids) {
    if (typeof id !== "string") {
      continue
    }

    const trimmed = id.trim()
    if (!trimmed || trimmed === "*" || trimmed === "invalid" || EDIT_COVERED_TOOL_IDS.has(trimmed)) {
      continue
    }

    normalized.push(trimmed)
  }

  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b))
}
