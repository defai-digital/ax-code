import { isMahjongStyle, mahjongRows, MAHJONG_BACKGROUND, type MahjongStyle } from "./mahjong-view-model"
import { benchRows, benchBackground, isBenchStyle, type BenchStyle } from "./bench-view-model"
import { fujiRows, fujiBackground, isFujiStyle, type FujiStyle, type FujiRun } from "./fuji-view-model"
export type TextSceneStyle = BenchStyle | FujiStyle | MahjongStyle
export type SceneRun = FujiRun
export function isTextSceneStyle(style: string | undefined): style is TextSceneStyle {
  return isBenchStyle(style) || isFujiStyle(style) || isMahjongStyle(style)
}
export function textSceneBackground(style: TextSceneStyle) {
  if (isMahjongStyle(style)) return MAHJONG_BACKGROUND
  return isFujiStyle(style) ? fujiBackground(style) : benchBackground(style)
}
export function textSceneRows(width: number, height: number, style: TextSceneStyle, elapsedMs: number): SceneRun[][] {
  if (isMahjongStyle(style)) return mahjongRows(width, height, style, elapsedMs)
  return isFujiStyle(style) ? fujiRows(width, height, style, elapsedMs) : benchRows(width, height, style, elapsedMs)
}
