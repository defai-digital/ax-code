export interface MultiRunModelSelection {
  providerID: string
  modelID: string
  displayName?: string
  variant?: string
}

export interface MultiRunFileAttachment {
  mime: string
  filename: string
  url: string
}

export interface MultiRunLocalFileAttachment {
  id: string
  filename: string
  mimeType: string
  size: number
  dataUrl: string
}

export const toMultiRunFileAttachment = (file: MultiRunLocalFileAttachment): MultiRunFileAttachment => ({
  mime: file.mimeType,
  filename: file.filename,
  url: file.dataUrl,
})

export interface MultiRunGroup {
  prompt: string
  models: MultiRunModelSelection[]
}

export interface CreateMultiRunParams {
  name: string
  groups: MultiRunGroup[]
  agent?: string
  worktreeBaseBranch?: string
  isolateRuns?: boolean
  files?: MultiRunFileAttachment[]
  setupCommands?: string[]
}

export interface CreateMultiRunResult {
  groupSlug: string
  sessionIds: string[]
  firstSessionId: string | null
}
