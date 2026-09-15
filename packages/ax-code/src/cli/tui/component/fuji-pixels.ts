import { renderTextScenePixels } from "./text-scene-pixels"
import type { FujiStyle } from "./fuji-view-model"

export function renderFujiPixels(width: number, height: number, style: FujiStyle, elapsedMs: number): Buffer {
  return renderTextScenePixels(width, height, style, elapsedMs)
}
