export class BehaviorAutosaveSequence {
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

  cancel(token: number): void {
    if (this.isCurrent(token)) {
      this.activeToken = 0
    }
  }

  cancelActive(): void {
    this.activeToken = 0
  }
}
