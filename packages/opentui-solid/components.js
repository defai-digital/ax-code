// src/elements/catalogue.ts
import {
  ASCIIFontRenderable,
  BoxRenderable,
  CodeRenderable,
  DiffRenderable,
  InputRenderable,
  LineNumberRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextareaRenderable,
  TextAttributes,
  TextNodeRenderable,
  TextRenderable
} from "@ax-code/opentui-core";

class SpanRenderable extends TextNodeRenderable {
  _ctx;
  constructor(_ctx, options) {
    super(options);
    this._ctx = _ctx;
  }
}
class TextModifierRenderable extends SpanRenderable {
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
}

class BoldSpanRenderable extends TextModifierRenderable {
  constructor(options) {
    super(options, "b");
  }
}

class ItalicSpanRenderable extends TextModifierRenderable {
  constructor(options) {
    super(options, "i");
  }
}

class UnderlineSpanRenderable extends TextModifierRenderable {
  constructor(options) {
    super(options, "u");
  }
}

class LineBreakRenderable extends SpanRenderable {
  constructor(_ctx, options) {
    super(null, options);
    this.add();
  }
  add() {
    return super.add(`
`);
  }
}

class LinkRenderable extends SpanRenderable {
  constructor(_ctx, options) {
    const linkOptions = {
      ...options,
      link: { url: options.href }
    };
    super(null, linkOptions);
  }
}
var baseComponents = {
  box: BoxRenderable,
  text: TextRenderable,
  input: InputRenderable,
  select: SelectRenderable,
  textarea: TextareaRenderable,
  ascii_font: ASCIIFontRenderable,
  tab_select: TabSelectRenderable,
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
  getComponentCatalogue,
  extend
};

//# debugId=4D3EF7806518248664756E2164756E21
