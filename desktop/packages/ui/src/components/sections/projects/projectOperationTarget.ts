export type ProjectOperationTarget = {
  id: string
  path: string
}

export const isCurrentProjectOperationTarget = (
  started: ProjectOperationTarget | null,
  current: ProjectOperationTarget | null,
): boolean => {
  return Boolean(started && current && started.id === current.id && started.path === current.path)
}

export class ProjectOperationSequence {
  private nextToken = 0
  private activeToken = 0

  begin(): number {
    const token = this.nextToken + 1
    this.nextToken = token
    this.activeToken = token
    return token
  }

  isCurrent(token: number): boolean {
    return token > 0 && this.activeToken === token
  }

  complete(token: number): boolean {
    if (!this.isCurrent(token)) {
      return false
    }

    this.activeToken = 0
    return true
  }
}
