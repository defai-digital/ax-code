import { BaseRenderable } from "../core/renderable.js"
import { stringToStyledText, StyledText } from "../lib/styled-text.js"
import { type TextChunk } from "../core/text-buffer.js"
import { RGBA } from "../lib/rgba.js"
import { type RenderContext } from "../core/types.js"
import { RootTextNodeRenderable, TextNodeRenderable } from "./TextNode.js"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js"

export interface TextOptions extends TextBufferOptions {
  content?: StyledText | string
}

export class TextRenderable extends TextBufferRenderable {
  private _text: StyledText

  // TODO: The TextRenderable is currently juggling both a StyledText and a RootTextNodeRenderable.
  // We should refactor this to only use the RootTextNodeRenderable here and have a separate StyledTextRenderable with `content`.
  private _hasManualStyledText: boolean = false

  protected rootTextNode: RootTextNodeRenderable

  protected _contentDefaultOptions = {
    content: "",
  } satisfies Partial<TextOptions>

  constructor(ctx: RenderContext, options: TextOptions) {
    super(ctx, options)

    const content = options.content ?? this._contentDefaultOptions.content
    const styledText = typeof content === "string" ? stringToStyledText(content) : content
    this._text = styledText
    this._hasManualStyledText = options.content !== undefined && content !== ""

    this.rootTextNode = new RootTextNodeRenderable(
      ctx,
      {
        id: `${this.id}-root`,
        fg: this._defaultFg,
        bg: this._defaultBg,
        attributes: this._defaultAttributes,
      },
      this,
    )

    this.updateTextBuffer(styledText)
  }

  private updateTextBuffer(styledText: StyledText): void {
    this.textBuffer.setStyledText(styledText)
    this.clearChunks(styledText)
  }

  private clearChunks(styledText: StyledText): void {
    // Clearing chunks that were already writtend to the text buffer,
    // to not retain references to the text data in js
    // TODO: This is causing issues in the solid renderer
    // styledText.chunks.forEach((chunk) => {
    //   // @ts-ignore
    //   chunk.text = undefined
    // })
  }

  get content(): StyledText {
    return this._text
  }

  get chunks(): TextChunk[] {
    return this._text.chunks
  }

  get textNode(): RootTextNodeRenderable {
    return this.rootTextNode
  }

  set content(value: StyledText | string) {
    const styledText = typeof value === "string" ? stringToStyledText(value) : value
    if (this._text !== styledText) {
      if (typeof value === "string" && this.isEquivalentStringContent(styledText)) {
        return
      }
      // Only an actual write switches to manual mode; a no-op self-assignment
      // must not orphan children added later through the node tree.
      this._hasManualStyledText = true
      this._text = styledText
      this.updateTextBuffer(styledText)
      this.updateTextInfo()
    }
  }

  private isEquivalentStringContent(styledText: StyledText): boolean {
    if (this._hasManualStyledText) {
      return this.chunksValueEqual(this._text.chunks, styledText.chunks)
    }

    // Node-driven mode: the node tree, not the stale _text snapshot, is the
    // source of truth for what is (or is about to be) rendered.
    const wasDirty = this.rootTextNode.isDirty
    const nodeChunks = this.rootTextNode.gatherWithInheritedStyle({
      fg: this._defaultFg,
      bg: this._defaultBg,
      attributes: this._defaultAttributes,
      link: undefined,
    })
    if (!this.chunksValueEqual(nodeChunks, styledText.chunks)) return false

    if (wasDirty) {
      // Gathering consumed the dirty flag; apply the equal content without
      // leaving node-driven mode so later children still sync.
      this._text = styledText
      this.updateTextBuffer(styledText)
      this.updateTextInfo()
    }
    return true
  }

  private chunksValueEqual(a: TextChunk[], b: TextChunk[]): boolean {
    const left = a.filter((chunk) => chunk.text !== "")
    const right = b.filter((chunk) => chunk.text !== "")
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i++) {
      const x = left[i]
      const y = right[i]
      if (x.text !== y.text) return false
      if ((x.attributes ?? 0) !== (y.attributes ?? 0)) return false
      if (x.link?.url !== y.link?.url) return false
      if (x.contentStart !== y.contentStart || x.contentEnd !== y.contentEnd) return false
      // An unset channel renders with the buffer default, so normalize before
      // comparing; parseColor allocates fresh RGBA instances for equal colors.
      if (!(x.fg ?? this._defaultFg).equals(y.fg ?? this._defaultFg)) return false
      if (!(x.bg ?? this._defaultBg).equals(y.bg ?? this._defaultBg)) return false
    }
    return true
  }

  private updateTextFromNodes(): void {
    if (this.rootTextNode.isDirty && !this._hasManualStyledText) {
      const chunks = this.rootTextNode.gatherWithInheritedStyle({
        fg: this._defaultFg,
        bg: this._defaultBg,
        attributes: this._defaultAttributes,
        link: undefined,
      })
      this.textBuffer.setStyledText(new StyledText(chunks))
      this.refreshLocalSelection()
      this.yogaNode.markDirty()
    }
  }

  public add(obj: TextNodeRenderable | StyledText | string, index?: number): number {
    return this.rootTextNode.add(obj, index)
  }

  public remove(id: string): void {
    this.rootTextNode.remove(id)
  }

  public insertBefore(obj: BaseRenderable | any, anchor?: BaseRenderable): number {
    this.rootTextNode.insertBefore(obj, anchor)
    return this.rootTextNode.children.indexOf(obj)
  }

  public getTextChildren(): BaseRenderable[] {
    return this.rootTextNode.getChildren()
  }

  public clear(): void {
    this.rootTextNode.clear()
    // Children added after clear() must sync again on the next lifecycle pass.
    this._hasManualStyledText = false

    const emptyStyledText = stringToStyledText("")
    this._text = emptyStyledText
    this.updateTextBuffer(emptyStyledText)
    this.updateTextInfo()

    this.requestRender()
  }

  public onLifecyclePass = () => {
    this.updateTextFromNodes()
  }

  protected onFgChanged(newColor: RGBA): void {
    this.rootTextNode.fg = newColor
  }

  protected onBgChanged(newColor: RGBA): void {
    this.rootTextNode.bg = newColor
  }

  protected onAttributesChanged(newAttributes: number): void {
    this.rootTextNode.attributes = newAttributes
  }

  destroy(): void {
    this.rootTextNode.clear()
    super.destroy()
  }
}
