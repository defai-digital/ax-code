import { isMahjongStyle } from "./mahjong-view-model"
import { isFujiStyle } from "./fuji-view-model"
import { isBenchStyle } from "./bench-view-model"
import { isCityStyle } from "./city-view-model"
import { isFestivalStyle } from "./festival-view-model"
import { isSnowStyle } from "./snow-view-model"
import { isVolcanoStyle } from "./volcano-view-model"
import { renderFujiPixels } from "./fuji-pixels"
import { renderMahjongPixels } from "./mahjong-pixels"
import { renderBenchPixels } from "./bench-pixels"
import { renderCityPixels } from "./city-pixels"
import { renderFestivalPixels } from "./festival-pixels"
import { renderSnowPixels } from "./snow-pixels"
import { renderVolcanoPixels } from "./volcano-pixels"
import type { TextSceneStyle } from "./text-scene-view-model"

export function renderTextScenePixels(width: number, height: number, style: TextSceneStyle, elapsedMs: number): Buffer {
  // Each scene paints freeform HD frames from its shared scene model.
  if (isFujiStyle(style)) return renderFujiPixels(width, height, style, elapsedMs)
  if (isMahjongStyle(style)) return renderMahjongPixels(width, height, style, elapsedMs)
  if (isBenchStyle(style)) return renderBenchPixels(width, height, style, elapsedMs)
  if (isCityStyle(style)) return renderCityPixels(width, height, style, elapsedMs)
  if (isFestivalStyle(style)) return renderFestivalPixels(width, height, style, elapsedMs)
  if (isSnowStyle(style)) return renderSnowPixels(width, height, style, elapsedMs)
  if (isVolcanoStyle(style)) return renderVolcanoPixels(width, height, style, elapsedMs)
  return style satisfies never
}
