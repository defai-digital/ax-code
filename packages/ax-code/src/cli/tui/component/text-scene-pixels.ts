import { isMahjongStyle } from "./mahjong-view-model"
import { isFujiStyle } from "./fuji-view-model"
import { isBenchStyle } from "./bench-view-model"
import { isCityStyle } from "./city-view-model"
import { isFestivalStyle } from "./festival-view-model"
import { isSnowStyle } from "./snow-view-model"
import { isVolcanoStyle } from "./volcano-view-model"
import { isBalloonsStyle } from "./balloons-view-model"
import { isBigbenStyle } from "./bigben-view-model"
import { isBorobudurStyle } from "./borobudur-view-model"
import { isBrandenburgStyle } from "./brandenburg-view-model"
import { isColosseumStyle } from "./colosseum-view-model"
import { isCorcovadoStyle } from "./corcovado-view-model"
import { isDomesStyle } from "./domes-view-model"
import { isEiffelStyle } from "./eiffel-view-model"
import { isGreatwallStyle } from "./greatwall-view-model"
import { isMekongStyle } from "./mekong-view-model"
import { isSagradaStyle } from "./sagrada-view-model"
import { isTaegeukStyle } from "./taegeuk-view-model"
import { isTaipei101Style } from "./taipei101-view-model"
import { isToriiStyle } from "./torii-view-model"
import { isSpaceStyle } from "./space-view-model"
import { isDungeonStyle } from "./dungeon-view-model"
import { isCastleStyle } from "./castle-view-model"
import { isIslandsStyle } from "./islands-view-model"
import { isJungleStyle } from "./jungle-view-model"
import { isReefStyle } from "./reef-view-model"
import { isPyramidsStyle } from "./pyramids-view-model"
import { isAuroraStyle } from "./aurora-view-model"
import { isLighthouseStyle } from "./lighthouse-view-model"
import { isFallsStyle } from "./falls-view-model"
import { isSteppeStyle } from "./steppe-view-model"
import { isCanyonStyle } from "./canyon-view-model"
import { renderFujiPixels } from "./fuji-pixels"
import { renderMahjongPixels } from "./mahjong-pixels"
import { renderBenchPixels } from "./bench-pixels"
import { renderCityPixels } from "./city-pixels"
import { renderFestivalPixels } from "./festival-pixels"
import { renderSnowPixels } from "./snow-pixels"
import { renderVolcanoPixels } from "./volcano-pixels"
import { renderBalloonsPixels } from "./balloons-pixels"
import { renderBigbenPixels } from "./bigben-pixels"
import { renderBorobudurPixels } from "./borobudur-pixels"
import { renderBrandenburgPixels } from "./brandenburg-pixels"
import { renderColosseumPixels } from "./colosseum-pixels"
import { renderCorcovadoPixels } from "./corcovado-pixels"
import { renderDomesPixels } from "./domes-pixels"
import { renderEiffelPixels } from "./eiffel-pixels"
import { renderGreatwallPixels } from "./greatwall-pixels"
import { renderMekongPixels } from "./mekong-pixels"
import { renderSagradaPixels } from "./sagrada-pixels"
import { renderTaegeukPixels } from "./taegeuk-pixels"
import { renderTaipei101Pixels } from "./taipei101-pixels"
import { renderToriiPixels } from "./torii-pixels"
import { renderSpacePixels } from "./space-pixels"
import { renderDungeonPixels } from "./dungeon-pixels"
import { renderCastlePixels } from "./castle-pixels"
import { renderIslandsPixels } from "./islands-pixels"
import { renderJunglePixels } from "./jungle-pixels"
import { renderReefPixels } from "./reef-pixels"
import { renderPyramidsPixels } from "./pyramids-pixels"
import { renderAuroraPixels } from "./aurora-pixels"
import { renderLighthousePixels } from "./lighthouse-pixels"
import { renderFallsPixels } from "./falls-pixels"
import { renderSteppePixels } from "./steppe-pixels"
import { renderCanyonPixels } from "./canyon-pixels"
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
  if (isBalloonsStyle(style)) return renderBalloonsPixels(width, height, style, elapsedMs)
  if (isBigbenStyle(style)) return renderBigbenPixels(width, height, style, elapsedMs)
  if (isBorobudurStyle(style)) return renderBorobudurPixels(width, height, style, elapsedMs)
  if (isBrandenburgStyle(style)) return renderBrandenburgPixels(width, height, style, elapsedMs)
  if (isColosseumStyle(style)) return renderColosseumPixels(width, height, style, elapsedMs)
  if (isCorcovadoStyle(style)) return renderCorcovadoPixels(width, height, style, elapsedMs)
  if (isDomesStyle(style)) return renderDomesPixels(width, height, style, elapsedMs)
  if (isEiffelStyle(style)) return renderEiffelPixels(width, height, style, elapsedMs)
  if (isGreatwallStyle(style)) return renderGreatwallPixels(width, height, style, elapsedMs)
  if (isMekongStyle(style)) return renderMekongPixels(width, height, style, elapsedMs)
  if (isSagradaStyle(style)) return renderSagradaPixels(width, height, style, elapsedMs)
  if (isTaegeukStyle(style)) return renderTaegeukPixels(width, height, style, elapsedMs)
  if (isTaipei101Style(style)) return renderTaipei101Pixels(width, height, style, elapsedMs)
  if (isToriiStyle(style)) return renderToriiPixels(width, height, style, elapsedMs)
  if (isSpaceStyle(style)) return renderSpacePixels(width, height, style, elapsedMs)
  if (isDungeonStyle(style)) return renderDungeonPixels(width, height, style, elapsedMs)
  if (isCastleStyle(style)) return renderCastlePixels(width, height, style, elapsedMs)
  if (isIslandsStyle(style)) return renderIslandsPixels(width, height, style, elapsedMs)
  if (isJungleStyle(style)) return renderJunglePixels(width, height, style, elapsedMs)
  if (isReefStyle(style)) return renderReefPixels(width, height, style, elapsedMs)
  if (isPyramidsStyle(style)) return renderPyramidsPixels(width, height, style, elapsedMs)
  if (isAuroraStyle(style)) return renderAuroraPixels(width, height, style, elapsedMs)
  if (isLighthouseStyle(style)) return renderLighthousePixels(width, height, style, elapsedMs)
  if (isFallsStyle(style)) return renderFallsPixels(width, height, style, elapsedMs)
  if (isSteppeStyle(style)) return renderSteppePixels(width, height, style, elapsedMs)
  if (isCanyonStyle(style)) return renderCanyonPixels(width, height, style, elapsedMs)
  return style satisfies never
}
