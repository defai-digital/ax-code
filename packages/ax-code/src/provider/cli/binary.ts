type CliBinaryCandidate = {
  path: string
  version?: string
}

function parseCliVersion(value: string) {
  const match = value.match(/\b(\d+)\.(\d+)\.(\d+)\b/)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const
}

function compareCliVersions(left: string | undefined, right: string | undefined) {
  const leftParts = left ? parseCliVersion(left) : undefined
  const rightParts = right ? parseCliVersion(right) : undefined
  if (!leftParts || !rightParts) return 0
  for (let index = 0; index < leftParts.length; index++) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

export function selectPreferredCodexBinary(candidates: readonly CliBinaryCandidate[]) {
  let selected = candidates[0]
  for (const candidate of candidates.slice(1)) {
    if (!selected || compareCliVersions(candidate.version, selected.version) > 0) selected = candidate
  }
  return selected?.path
}
