export interface DirectoryLoadToken {
  directory: string
  requestId: number
}

export class LatestDirectoryLoadTracker {
  private nextRequestId = 0
  private activeRequestIds = new Map<string, number>()

  begin(directory: string): DirectoryLoadToken {
    const requestId = this.nextRequestId + 1
    this.nextRequestId = requestId
    this.activeRequestIds.set(directory, requestId)
    return { directory, requestId }
  }

  isCurrent(token: DirectoryLoadToken): boolean {
    return this.activeRequestIds.get(token.directory) === token.requestId
  }

  complete(token: DirectoryLoadToken): boolean {
    if (!this.isCurrent(token)) {
      return false
    }

    this.activeRequestIds.delete(token.directory)
    return true
  }

  reset(): void {
    this.activeRequestIds = new Map()
  }
}
