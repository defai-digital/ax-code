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
  /** the untouched backend payload, for debugging and forward-compat */
  raw?: unknown
}
