// solid/source/src/elements/catalogue.ts
import {
  BoxRenderable,
  CodeRenderable,
  DiffRenderable,
  InputRenderable,
  ImageRenderable,
  LineNumberRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  TextareaRenderable,
  TextAttributes,
  TextNodeRenderable,
  TextRenderable
} from "@defai-digital/ax-tui";
var SpanRenderable = class extends TextNodeRenderable {
  constructor(_ctx, options) {
    super(options);
    this._ctx = _ctx;
  }
  _ctx;
};
var TextModifierRenderable = class extends SpanRenderable {
  constructor(options, modifier) {
    super(null, options);
    if (modifier === "b" || modifier === "strong") {
      this.attributes = (this.attributes || 0) | TextAttributes.BOLD;
    } else if (modifier === "i" || modifier === "em") {
      this.attributes = (this.attributes || 0) | TextAttributes.ITALIC;
    } else if (modifier === "u") {
      this.attributes = (this.attributes || 0) | TextAttributes.UNDERLINE;
    }
  }
};
var BoldSpanRenderable = class extends TextModifierRenderable {
  constructor(options) {
    super(options, "b");
  }
};
var ItalicSpanRenderable = class extends TextModifierRenderable {
  constructor(options) {
    super(options, "i");
  }
};
var UnderlineSpanRenderable = class extends TextModifierRenderable {
  constructor(options) {
    super(options, "u");
  }
};
var LineBreakRenderable = class extends SpanRenderable {
  constructor(_ctx, options) {
    super(null, options);
    this.add();
  }
  add() {
    return super.add("\n");
  }
};
var LinkRenderable = class extends SpanRenderable {
  constructor(_ctx, options) {
    const linkOptions = {
      ...options,
      link: { url: options.href }
    };
    super(null, linkOptions);
  }
};
var baseComponents = {
  box: BoxRenderable,
  text: TextRenderable,
  input: InputRenderable,
  image: ImageRenderable,
  textarea: TextareaRenderable,
  scrollbox: ScrollBoxRenderable,
  code: CodeRenderable,
  diff: DiffRenderable,
  line_number: LineNumberRenderable,
  markdown: MarkdownRenderable,
  span: SpanRenderable,
  strong: BoldSpanRenderable,
  b: BoldSpanRenderable,
  em: ItalicSpanRenderable,
  i: ItalicSpanRenderable,
  u: UnderlineSpanRenderable,
  br: LineBreakRenderable,
  a: LinkRenderable
};
var componentCatalogue = { ...baseComponents };
function extend(objects) {
  Object.assign(componentCatalogue, objects);
}
function getComponentCatalogue() {
  return componentCatalogue;
}
export {
  extend,
  getComponentCatalogue
};
