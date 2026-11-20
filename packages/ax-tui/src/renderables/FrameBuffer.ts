import { type RenderableOptions, Renderable } from "../core/renderable.js"
import { OptimizedBuffer } from "../core/buffer.js"
import type { RenderContext } from "../core/types.js"

export interface FrameBufferOptions extends RenderableOptions<FrameBufferRenderable> {
  width: number
  height: number
  respectAlpha?: boolean
}

export class FrameBufferRenderable extends Renderable {
  public frameBuffer: OptimizedBuffer
  protected respectAlpha: boolean

  constructor(ctx: RenderContext, options: FrameBufferOptions) {
    // This renderable owns its frame buffer explicitly; the base class must not
    // allocate a second one for buffered:true (it would leak and self-blit).
    super(ctx, { ...options, buffered: false })
    this.respectAlpha = options.respectAlpha || false
    try {
      this.frameBuffer = OptimizedBuffer.create(options.width, options.height, this._ctx.widthMethod, {
        respectAlpha: this.respectAlpha,
        id: options.id || `framebufferrenderable-${this.id}`,
      })
    } catch (err) {
      this.destroy()
      throw err
    }
  }

  protected onResize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid resize dimensions for FrameBufferRenderable ${this.id}: ${width}x${height}`)
    }

    this.frameBuffer.resize(width, height)
    super.onResize(width, height)
    this.requestRender()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed) return
    buffer.drawFrameBuffer(this.x, this.y, this.frameBuffer)
  }

  protected destroySelf(): void {
    // TODO: framebuffer collides with buffered Renderable, which holds a framebuffer
    // and destroys it if it exists already. Maybe instead of extending FrameBufferRenderable,
    // subclasses can use the buffered option on the base renderable instead,
    // then this would become something that takes in an external framebuffer to bring it into layout.
    this.frameBuffer?.destroy()
    super.destroySelf()
  }
}
