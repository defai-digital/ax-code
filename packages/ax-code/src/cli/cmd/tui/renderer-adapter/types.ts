export type TuiRendererName = "opentui" | "native"

export type TuiKeyEvent = {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  super?: boolean
}

export type TuiMouseEvent = {
  x: number
  y: number
  button?: number
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

export type TuiColor = {
  r: number
  g: number
  b: number
  a?: number
}

export type TuiTextRun = {
  text: string
  foreground?: TuiColor
  background?: TuiColor
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export type TuiViewport = {
  width: number
  height: number
}

export type TuiFocusOwner = "app" | "prompt" | "dialog" | "permission" | "console"

