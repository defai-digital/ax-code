import { isMahjongStyle, mahjongRows, MAHJONG_BACKGROUND, type MahjongStyle } from "./mahjong-view-model"
import { benchRows, benchBackground, isBenchStyle, type BenchStyle } from "./bench-view-model"
import { fujiRows, fujiBackground, isFujiStyle, type FujiStyle, type FujiRun } from "./fuji-view-model"
import { cityRows, cityBackground, isCityStyle, type CityStyle } from "./city-view-model"
import { festivalRows, festivalBackground, isFestivalStyle, type FestivalStyle } from "./festival-view-model"
import { snowRows, snowBackground, isSnowStyle, type SnowStyle } from "./snow-view-model"
import { volcanoRows, volcanoBackground, isVolcanoStyle, type VolcanoStyle } from "./volcano-view-model"
import { balloonsRows, balloonsBackground, isBalloonsStyle, type BalloonsStyle } from "./balloons-view-model"
import { bigbenRows, bigbenBackground, isBigbenStyle, type BigbenStyle } from "./bigben-view-model"
import { borobudurRows, borobudurBackground, isBorobudurStyle, type BorobudurStyle } from "./borobudur-view-model"
import {
  brandenburgRows,
  brandenburgBackground,
  isBrandenburgStyle,
  type BrandenburgStyle,
} from "./brandenburg-view-model"
import { colosseumRows, colosseumBackground, isColosseumStyle, type ColosseumStyle } from "./colosseum-view-model"
import { corcovadoRows, corcovadoBackground, isCorcovadoStyle, type CorcovadoStyle } from "./corcovado-view-model"
import { domesRows, domesBackground, isDomesStyle, type DomesStyle } from "./domes-view-model"
import { eiffelRows, eiffelBackground, isEiffelStyle, type EiffelStyle } from "./eiffel-view-model"
import { greatwallRows, greatwallBackground, isGreatwallStyle, type GreatwallStyle } from "./greatwall-view-model"
import { mekongRows, mekongBackground, isMekongStyle, type MekongStyle } from "./mekong-view-model"
import { sagradaRows, sagradaBackground, isSagradaStyle, type SagradaStyle } from "./sagrada-view-model"
import { taegeukRows, taegeukBackground, isTaegeukStyle, type TaegeukStyle } from "./taegeuk-view-model"
import { taipei101Rows, taipei101Background, isTaipei101Style, type Taipei101Style } from "./taipei101-view-model"
import { toriiRows, toriiBackground, isToriiStyle, type ToriiStyle } from "./torii-view-model"
import { spaceRows, spaceBackground, isSpaceStyle, type SpaceStyle } from "./space-view-model"
import { dungeonRows, dungeonBackground, isDungeonStyle, type DungeonStyle } from "./dungeon-view-model"
import { castleRows, castleBackground, isCastleStyle, type CastleStyle } from "./castle-view-model"
import { islandsRows, islandsBackground, isIslandsStyle, type IslandsStyle } from "./islands-view-model"
import { jungleRows, jungleBackground, isJungleStyle, type JungleStyle } from "./jungle-view-model"
import { reefRows, reefBackground, isReefStyle, type ReefStyle } from "./reef-view-model"
import { pyramidsRows, pyramidsBackground, isPyramidsStyle, type PyramidsStyle } from "./pyramids-view-model"
import { auroraRows, auroraBackground, isAuroraStyle, type AuroraStyle } from "./aurora-view-model"
import { lighthouseRows, lighthouseBackground, isLighthouseStyle, type LighthouseStyle } from "./lighthouse-view-model"
import { fallsRows, fallsBackground, isFallsStyle, type FallsStyle } from "./falls-view-model"
import { steppeRows, steppeBackground, isSteppeStyle, type SteppeStyle } from "./steppe-view-model"
import { canyonRows, canyonBackground, isCanyonStyle, type CanyonStyle } from "./canyon-view-model"
import { singaporeRows, singaporeBackground, isSingaporeStyle, type SingaporeStyle } from "./singapore-view-model"
export type TextSceneStyle =
  | BenchStyle
  | FujiStyle
  | MahjongStyle
  | CityStyle
  | FestivalStyle
  | SnowStyle
  | VolcanoStyle
  | BalloonsStyle
  | BigbenStyle
  | BorobudurStyle
  | BrandenburgStyle
  | ColosseumStyle
  | CorcovadoStyle
  | DomesStyle
  | EiffelStyle
  | GreatwallStyle
  | MekongStyle
  | SagradaStyle
  | TaegeukStyle
  | Taipei101Style
  | ToriiStyle
  | SpaceStyle
  | DungeonStyle
  | CastleStyle
  | IslandsStyle
  | JungleStyle
  | ReefStyle
  | PyramidsStyle
  | AuroraStyle
  | LighthouseStyle
  | FallsStyle
  | SteppeStyle
  | CanyonStyle
  | SingaporeStyle
export type SceneRun = FujiRun
export function isTextSceneStyle(style: string | undefined): style is TextSceneStyle {
  return (
    isBenchStyle(style) ||
    isFujiStyle(style) ||
    isMahjongStyle(style) ||
    isCityStyle(style) ||
    isFestivalStyle(style) ||
    isSnowStyle(style) ||
    isVolcanoStyle(style) ||
    isBalloonsStyle(style) ||
    isBigbenStyle(style) ||
    isBorobudurStyle(style) ||
    isBrandenburgStyle(style) ||
    isColosseumStyle(style) ||
    isCorcovadoStyle(style) ||
    isDomesStyle(style) ||
    isEiffelStyle(style) ||
    isGreatwallStyle(style) ||
    isMekongStyle(style) ||
    isSagradaStyle(style) ||
    isTaegeukStyle(style) ||
    isTaipei101Style(style) ||
    isToriiStyle(style) ||
    isSpaceStyle(style) ||
    isDungeonStyle(style) ||
    isCastleStyle(style) ||
    isIslandsStyle(style) ||
    isJungleStyle(style) ||
    isReefStyle(style) ||
    isPyramidsStyle(style) ||
    isAuroraStyle(style) ||
    isLighthouseStyle(style) ||
    isFallsStyle(style) ||
    isSteppeStyle(style) ||
    isCanyonStyle(style) ||
    isSingaporeStyle(style)
  )
}
export function textSceneBackground(style: TextSceneStyle) {
  if (isMahjongStyle(style)) return MAHJONG_BACKGROUND
  if (isCityStyle(style)) return cityBackground(style)
  if (isFestivalStyle(style)) return festivalBackground(style)
  if (isSnowStyle(style)) return snowBackground(style)
  if (isVolcanoStyle(style)) return volcanoBackground(style)
  if (isBalloonsStyle(style)) return balloonsBackground(style)
  if (isBigbenStyle(style)) return bigbenBackground(style)
  if (isBorobudurStyle(style)) return borobudurBackground(style)
  if (isBrandenburgStyle(style)) return brandenburgBackground(style)
  if (isColosseumStyle(style)) return colosseumBackground(style)
  if (isCorcovadoStyle(style)) return corcovadoBackground(style)
  if (isDomesStyle(style)) return domesBackground(style)
  if (isEiffelStyle(style)) return eiffelBackground(style)
  if (isGreatwallStyle(style)) return greatwallBackground(style)
  if (isMekongStyle(style)) return mekongBackground(style)
  if (isSagradaStyle(style)) return sagradaBackground(style)
  if (isTaegeukStyle(style)) return taegeukBackground(style)
  if (isTaipei101Style(style)) return taipei101Background(style)
  if (isToriiStyle(style)) return toriiBackground(style)
  if (isSpaceStyle(style)) return spaceBackground(style)
  if (isDungeonStyle(style)) return dungeonBackground(style)
  if (isCastleStyle(style)) return castleBackground(style)
  if (isIslandsStyle(style)) return islandsBackground(style)
  if (isJungleStyle(style)) return jungleBackground(style)
  if (isReefStyle(style)) return reefBackground(style)
  if (isPyramidsStyle(style)) return pyramidsBackground(style)
  if (isAuroraStyle(style)) return auroraBackground(style)
  if (isLighthouseStyle(style)) return lighthouseBackground(style)
  if (isFallsStyle(style)) return fallsBackground(style)
  if (isSteppeStyle(style)) return steppeBackground(style)
  if (isCanyonStyle(style)) return canyonBackground(style)
  if (isSingaporeStyle(style)) return singaporeBackground(style)
  return isFujiStyle(style) ? fujiBackground(style) : benchBackground(style)
}
export function textSceneRows(width: number, height: number, style: TextSceneStyle, elapsedMs: number): SceneRun[][] {
  if (isMahjongStyle(style)) return mahjongRows(width, height, style, elapsedMs)
  if (isCityStyle(style)) return cityRows(width, height, style, elapsedMs)
  if (isFestivalStyle(style)) return festivalRows(width, height, style, elapsedMs)
  if (isSnowStyle(style)) return snowRows(width, height, style, elapsedMs)
  if (isVolcanoStyle(style)) return volcanoRows(width, height, style, elapsedMs)
  if (isBalloonsStyle(style)) return balloonsRows(width, height, style, elapsedMs)
  if (isBigbenStyle(style)) return bigbenRows(width, height, style, elapsedMs)
  if (isBorobudurStyle(style)) return borobudurRows(width, height, style, elapsedMs)
  if (isBrandenburgStyle(style)) return brandenburgRows(width, height, style, elapsedMs)
  if (isColosseumStyle(style)) return colosseumRows(width, height, style, elapsedMs)
  if (isCorcovadoStyle(style)) return corcovadoRows(width, height, style, elapsedMs)
  if (isDomesStyle(style)) return domesRows(width, height, style, elapsedMs)
  if (isEiffelStyle(style)) return eiffelRows(width, height, style, elapsedMs)
  if (isGreatwallStyle(style)) return greatwallRows(width, height, style, elapsedMs)
  if (isMekongStyle(style)) return mekongRows(width, height, style, elapsedMs)
  if (isSagradaStyle(style)) return sagradaRows(width, height, style, elapsedMs)
  if (isTaegeukStyle(style)) return taegeukRows(width, height, style, elapsedMs)
  if (isTaipei101Style(style)) return taipei101Rows(width, height, style, elapsedMs)
  if (isToriiStyle(style)) return toriiRows(width, height, style, elapsedMs)
  if (isSpaceStyle(style)) return spaceRows(width, height, style, elapsedMs)
  if (isDungeonStyle(style)) return dungeonRows(width, height, style, elapsedMs)
  if (isCastleStyle(style)) return castleRows(width, height, style, elapsedMs)
  if (isIslandsStyle(style)) return islandsRows(width, height, style, elapsedMs)
  if (isJungleStyle(style)) return jungleRows(width, height, style, elapsedMs)
  if (isReefStyle(style)) return reefRows(width, height, style, elapsedMs)
  if (isPyramidsStyle(style)) return pyramidsRows(width, height, style, elapsedMs)
  if (isAuroraStyle(style)) return auroraRows(width, height, style, elapsedMs)
  if (isLighthouseStyle(style)) return lighthouseRows(width, height, style, elapsedMs)
  if (isFallsStyle(style)) return fallsRows(width, height, style, elapsedMs)
  if (isSteppeStyle(style)) return steppeRows(width, height, style, elapsedMs)
  if (isCanyonStyle(style)) return canyonRows(width, height, style, elapsedMs)
  if (isSingaporeStyle(style)) return singaporeRows(width, height, style, elapsedMs)
  return isFujiStyle(style) ? fujiRows(width, height, style, elapsedMs) : benchRows(width, height, style, elapsedMs)
}
