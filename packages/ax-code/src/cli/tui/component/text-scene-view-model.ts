import { isMahjongStyle, mahjongRows, MAHJONG_BACKGROUND, type MahjongStyle } from "./mahjong-view-model"
import { benchRows, benchBackground, isBenchStyle, type BenchStyle } from "./bench-view-model"
import { fujiRows, fujiBackground, isFujiStyle, type FujiStyle, type FujiRun } from "./fuji-view-model"
import { cityRows, cityBackground, isCityStyle, type CityStyle } from "./city-view-model"
import { festivalRows, festivalBackground, isFestivalStyle, type FestivalStyle } from "./festival-view-model"
import { snowRows, snowBackground, isSnowStyle, type SnowStyle } from "./snow-view-model"
import { volcanoRows, volcanoBackground, isVolcanoStyle, type VolcanoStyle } from "./volcano-view-model"
export type TextSceneStyle =
  | BenchStyle
  | FujiStyle
  | MahjongStyle
  | CityStyle
  | FestivalStyle
  | SnowStyle
  | VolcanoStyle
export type SceneRun = FujiRun
export function isTextSceneStyle(style: string | undefined): style is TextSceneStyle {
  return (
    isBenchStyle(style) ||
    isFujiStyle(style) ||
    isMahjongStyle(style) ||
    isCityStyle(style) ||
    isFestivalStyle(style) ||
    isSnowStyle(style) ||
    isVolcanoStyle(style)
  )
}
export function textSceneBackground(style: TextSceneStyle) {
  if (isMahjongStyle(style)) return MAHJONG_BACKGROUND
  if (isCityStyle(style)) return cityBackground(style)
  if (isFestivalStyle(style)) return festivalBackground(style)
  if (isSnowStyle(style)) return snowBackground(style)
  if (isVolcanoStyle(style)) return volcanoBackground(style)
  return isFujiStyle(style) ? fujiBackground(style) : benchBackground(style)
}
export function textSceneRows(width: number, height: number, style: TextSceneStyle, elapsedMs: number): SceneRun[][] {
  if (isMahjongStyle(style)) return mahjongRows(width, height, style, elapsedMs)
  if (isCityStyle(style)) return cityRows(width, height, style, elapsedMs)
  if (isFestivalStyle(style)) return festivalRows(width, height, style, elapsedMs)
  if (isSnowStyle(style)) return snowRows(width, height, style, elapsedMs)
  if (isVolcanoStyle(style)) return volcanoRows(width, height, style, elapsedMs)
  return isFujiStyle(style) ? fujiRows(width, height, style, elapsedMs) : benchRows(width, height, style, elapsedMs)
}
