import { Log } from "@/util/log"

const log = Log.create({ service: "tui.renderable-safety" })

type RenderableLogger = Pick<Log.Logger, "warn">

type MaybeRenderable = {
  id?: string
  isDestroyed?: boolean
  focus?: () => void
  blur?: () => void
  getChildren?: () => MaybeRenderable[]
}

export interface RenderableSafetyOptions {
  name: string
  logger?: RenderableLogger
}

function warn(input: RenderableSafetyOptions, message: string, extra: Record<string, unknown>) {
  ;(input.logger ?? log).warn(message, { safetyName: input.name, ...extra })
}

export function isRenderableAlive<T extends MaybeRenderable | null | undefined>(
  renderable: T,
): renderable is NonNullable<T> {
  return !!renderable && renderable.isDestroyed !== true
}

export function focusRenderable(renderable: MaybeRenderable | null | undefined, input: RenderableSafetyOptions) {
  if (!isRenderableAlive(renderable)) return false
  if (!renderable.focus) return false
  try {
    renderable.focus()
    return true
  } catch (error) {
    warn(input, "tui renderable focus failed", { error, renderableID: renderable.id })
    return false
  }
}

export function blurRenderable(renderable: MaybeRenderable | null | undefined, input: RenderableSafetyOptions) {
  if (!isRenderableAlive(renderable)) return false
  if (!renderable.blur) return false
  try {
    renderable.blur()
    return true
  } catch (error) {
    warn(input, "tui renderable blur failed", { error, renderableID: renderable.id })
    return false
  }
}

export function renderableChildren<TChild extends MaybeRenderable = MaybeRenderable>(
  renderable: MaybeRenderable | null | undefined,
  input: RenderableSafetyOptions,
): TChild[] {
  if (!isRenderableAlive(renderable)) return []
  if (!renderable.getChildren) return []
  try {
    return renderable.getChildren().filter(isRenderableAlive) as TChild[]
  } catch (error) {
    warn(input, "tui renderable children lookup failed", { error, renderableID: renderable.id })
    return []
  }
}

export function findRenderableChild<TChild extends MaybeRenderable = MaybeRenderable>(
  renderable: MaybeRenderable | null | undefined,
  predicate: (child: TChild) => boolean,
  input: RenderableSafetyOptions,
) {
  return renderableChildren<TChild>(renderable, input).find(predicate)
}
