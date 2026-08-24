export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PixelImage {
  /** base64-encoded image bytes */
  data: string
  mimeType: string
  width?: number
  height?: number
}

export interface ComputerElement {
  id: string
  role?: string
  name?: string
  value?: string
  bounds?: Bounds
  enabled?: boolean
  focused?: boolean
}

export interface AppInfo {
  name: string
  pid?: number
  bundleId?: string
}

export interface WindowInfo {
  id: string
  title: string
  bounds: Bounds
  app?: AppInfo
}

export interface ComputerObservation {
  platform: string
  provider: string
  /** epoch milliseconds */
  timestamp: number
  app?: AppInfo
  window?: WindowInfo
  screenshot?: PixelImage
  elements: ComputerElement[]
  /** rendered accessibility tree, when the backend exposes one as text */
  a11yText?: string
  /**
   * Passive observe only: opaque stream revision token. Absent on legacy
   * (targetable) observations.
   */
  revision?: string
  /**
   * Passive observe only: true when the canonical masked frame content did
   * not change since `sinceRevision`. Unchanged responses carry no
   * screenshot and empty elements.
   */
  unchanged?: boolean
  /**
   * Passive observe only: true when the supplied revision was unknown or
   * evicted; the response then holds the latest full frame (an unknown
   * revision is never silently treated as unchanged).
   */
  gap?: boolean
  /**
   * Passive observe only: content hash of the canonical masked frame
   * ("sha256:<64 lowercase hex>"). When the client's `have` list contains
   * the current frameHash, the provider may omit the screenshot payload
   * (dedup).
   */
  frameHash?: string
  /** the untouched backend payload, for debugging and forward-compat */
  raw?: unknown
}
