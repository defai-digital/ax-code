export type SessionHeaderContextLabelInput = {
  totalTokens?: number
  contextLimit?: number | null
  outputTokens?: number
  createdAt?: number
  completedAt?: number
}

export type SessionHeaderWorkspaceLabelInput = {
  sessionDirectory?: string
  localDirectory: string
  workspaceName?: string
}

export type SessionHeaderLayoutInput = {
  terminalWidth: number
  sidebarBreakpoint?: number
  sidebarWidth?: number
  minContentWidth?: number
}

export function sessionHeaderContextLabel(input: SessionHeaderContextLabelInput): string | undefined {
  if (input.totalTokens === undefined) return

  let result = input.totalTokens.toLocaleString()
  if (input.contextLimit && input.contextLimit > 0) {
    result += "  " + Math.round((input.totalTokens / input.contextLimit) * 100) + "%"
  }

  if (
    input.completedAt !== undefined &&
    input.createdAt !== undefined &&
    input.outputTokens !== undefined &&
    input.outputTokens > 0
  ) {
    const durationSecs = (input.completedAt - input.createdAt) / 1000
    if (durationSecs > 0) result += "  " + Math.round(input.outputTokens / durationSecs) + " tok/s"
  }

  return result
}

export function sessionHeaderWorkspaceLabel(input: SessionHeaderWorkspaceLabelInput): string {
  if (!input.sessionDirectory || input.sessionDirectory === input.localDirectory) return "Workspace local"
  if (!input.workspaceName) return `Workspace ${input.sessionDirectory}`
  return `Workspace ${input.workspaceName}`
}

export function sessionHeaderLayout(input: SessionHeaderLayoutInput) {
  const sidebarWidth = input.terminalWidth > (input.sidebarBreakpoint ?? 120) ? (input.sidebarWidth ?? 42) : 0
  return {
    sidebarWidth,
    narrow: input.terminalWidth - sidebarWidth < (input.minContentWidth ?? 100),
  }
}
