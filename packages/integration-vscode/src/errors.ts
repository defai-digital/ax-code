export class ServerError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
  ) {
    super(`Server error ${status}: ${bodyText.slice(0, 300) || "(no body)"}`)
    this.name = "ServerError"
  }
}
