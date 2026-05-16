export interface Adaptor {
  configure(config: unknown): unknown
  create(config?: unknown): Promise<unknown>
  remove(config?: unknown): Promise<void>
  fetch(config: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}
