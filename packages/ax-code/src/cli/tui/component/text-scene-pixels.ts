import { isMahjongStyle } from "./mahjong-view-model"
import { isFujiStyle } from "./fuji-view-model"
import { isBenchStyle } from "./bench-view-model"
import { renderFujiPixels } from "./fuji-pixels"
import { renderMahjongPixels } from "./mahjong-pixels"
import { renderBenchPixels } from "./bench-pixels"
import type { TextSceneStyle } from "./text-scene-view-model"

export function renderTextScenePixels(width: number, height: number, style: TextSceneStyle, elapsedMs: number): Buffer {
  // Each scene paints freeform HD frames from its shared scene model.
  if (isFujiStyle(style)) return renderFujiPixels(width, height, style, elapsedMs)
  if (isMahjongStyle(style)) return renderMahjongPixels(width, height, style, elapsedMs)
  if (isBenchStyle(style)) return renderBenchPixels(width, height, style, elapsedMs)
  return style satisfies never
}
