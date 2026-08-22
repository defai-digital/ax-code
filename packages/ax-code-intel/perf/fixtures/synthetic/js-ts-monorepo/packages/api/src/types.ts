export interface ApiRequest {
  method: string
  path: string
  body?: unknown
}

export interface ApiResponse {
  status: number
  body: string
}
