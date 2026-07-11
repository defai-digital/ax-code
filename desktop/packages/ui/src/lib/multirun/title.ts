export type ParsedMultiRunTitle = {
  groupSlug: string
  runGroup?: string
  providerID: string
  modelID: string
  index?: number
  fusion: boolean
}

const GROUP_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/
const RUN_GROUP_PATTERN = /^g[1-9]\d*$/

// modelID can itself contain "/" (e.g. OpenRouter ids like
// "anthropic/claude-3.5-sonnet"). Since "/" is the title delimiter, encode the
// model segment when building a title and decode it when parsing so slashed
// model ids round-trip instead of exploding the segment count. Plain ids have
// nothing to encode, so legacy titles are unaffected.
const encodeMultiRunModelId = (modelID: string): string => encodeURIComponent(modelID)
const decodeMultiRunModelId = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

const parseSuffix = (
  groupSlug: string,
  runGroup: string | undefined,
  providerID: string,
  modelSegment: string,
  suffix: string | undefined,
): ParsedMultiRunTitle | null => {
  if (!GROUP_SLUG_PATTERN.test(groupSlug)) return null
  if (runGroup !== undefined && !RUN_GROUP_PATTERN.test(runGroup)) return null
  const modelID = decodeMultiRunModelId(modelSegment)
  if (modelID === null) return null
  if (!providerID?.trim() || !modelID?.trim()) return null
  if (providerID !== providerID.trim() || modelID !== modelID.trim()) return null

  if (suffix === undefined) {
    return { groupSlug, runGroup, providerID, modelID, fusion: false }
  }

  if (suffix === "fusion") {
    return { groupSlug, runGroup, providerID, modelID, fusion: true }
  }

  if (!/^\d+$/.test(suffix)) return null
  const index = Number.parseInt(suffix, 10)
  if (!Number.isSafeInteger(index) || index <= 0) return null

  return { groupSlug, runGroup, providerID, modelID, index, fusion: false }
}

export const parseMultiRunSessionTitle = (title?: string | null): ParsedMultiRunTitle | null => {
  if (!title) return null
  const segments = title.split("/")
  if (segments.length < 3 || segments.length > 5) return null

  const [groupSlug] = segments

  if (segments.length === 3) {
    return parseSuffix(groupSlug, undefined, segments[1], segments[2], undefined)
  }

  if (segments.length === 4) {
    const [, second, third, fourth] = segments
    if (RUN_GROUP_PATTERN.test(second)) {
      return parseSuffix(groupSlug, second, third, fourth, undefined)
    }
    return parseSuffix(groupSlug, undefined, second, third, fourth)
  }

  const [, runGroup, providerID, modelID, suffix] = segments
  if (runGroup === "") {
    return parseSuffix(groupSlug, undefined, providerID, modelID, suffix)
  }
  return parseSuffix(groupSlug, runGroup, providerID, modelID, suffix)
}

export const getMultiRunSessionTitle = (parts: {
  groupSlug: string
  runGroup?: string
  providerID: string
  modelID: string
  index?: number
}): string => {
  const segments = [parts.groupSlug]
  if (parts.runGroup) segments.push(parts.runGroup)
  segments.push(parts.providerID, encodeMultiRunModelId(parts.modelID))
  if (parts.index !== undefined) segments.push(String(parts.index))
  return segments.join("/")
}

export const isMultiRunSessionTitle = (title?: string | null): boolean => {
  return parseMultiRunSessionTitle(title) !== null
}

export const getFusionSessionTitle = (
  groupSlug: string,
  providerID: string,
  modelID: string,
  runGroup?: string,
): string => {
  const segments = [groupSlug]
  if (runGroup) segments.push(runGroup)
  segments.push(providerID, encodeMultiRunModelId(modelID), "fusion")
  return segments.join("/")
}
