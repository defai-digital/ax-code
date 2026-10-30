// solid/source/index.ts
import { CliRenderer, createCliRenderer, engine as engine2 } from "@defai-digital/ax-tui";
import { createTestRenderer } from "@defai-digital/ax-tui/testing";

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
var textNodeKeys = ["span", "b", "strong", "i", "em", "u", "a"];
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

// solid/source/src/elements/hooks.ts
import { engine, Timeline } from "@defai-digital/ax-tui";
import { createContext, createSignal, onCleanup, onMount, useContext } from "solid-js/dist/solid.js";
import { getOverlayManager, RenderableEvents } from "@defai-digital/ax-tui";
import { getKeymap } from "@defai-digital/ax-tui";
var RendererContext = createContext();
var useRenderer = () => {
  const renderer = useContext(RendererContext);
  if (!renderer) {
    throw new Error("No renderer found");
  }
  return renderer;
};
var useKeymap = () => {
  const keymap = getKeymap(useRenderer());
  const registrations = /* @__PURE__ */ new Set();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    for (const remove of [...registrations]) remove();
  });
  return {
    register(layer) {
      if (disposed) throw new Error("Keymap owner is disposed");
      const unregister = keymap.register(layer);
      const target = layer.target;
      const remove = () => {
        registrations.delete(remove);
        target?.off(RenderableEvents.DESTROYED, remove);
        unregister();
      };
      registrations.add(remove);
      target?.once(RenderableEvents.DESTROYED, remove);
      return remove;
    },
    getActiveBindings: () => keymap.getActiveBindings(),
    get pendingKeys() {
      return keymap.pendingKeys;
    },
    cancelSequence: () => {
      if (!disposed) keymap.cancelSequence();
    }
  };
};
var useOverlay = () => {
  const manager = getOverlayManager(useRenderer());
  const handles = /* @__PURE__ */ new Set();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    for (const handle of [...handles]) handle.close();
    handles.clear();
  });
  return {
    show(content, options) {
      if (disposed) throw new Error("Overlay owner is disposed");
      const handle = manager.show(content, options);
      const forget = () => {
        handles.delete(scoped);
      };
      const scoped = {
        ...handle,
        close() {
          handles.delete(scoped);
          content.off(RenderableEvents.DESTROYED, forget);
          handle.close();
        }
      };
      if (!content.isDestroyed) {
        handles.add(scoped);
        content.once(RenderableEvents.DESTROYED, forget);
      }
      return scoped;
    }
  };
};
var onResize = (callback) => {
  const renderer = useRenderer();
  onMount(() => {
    renderer.on("resize", callback);
  });
  onCleanup(() => {
    renderer.off("resize", callback);
  });
};
var useTerminalDimensions = () => {
  const renderer = useRenderer();
  const [terminalDimensions, setTerminalDimensions] = createSignal({ width: renderer.width, height: renderer.height });
  const callback = (width, height) => {
    setTerminalDimensions({ width, height });
  };
  onResize(callback);
  return terminalDimensions;
};
var useKeyboard = (callback, options) => {
  const renderer = useRenderer();
  const keyHandler = renderer.keyInput;
  onMount(() => {
    keyHandler.on("keypress", callback);
    if (options?.release) {
      keyHandler.on("keyrelease", callback);
    }
  });
  onCleanup(() => {
    keyHandler.off("keypress", callback);
    if (options?.release) {
      keyHandler.off("keyrelease", callback);
    }
  });
};
var usePaste = (callback) => {
  const renderer = useRenderer();
  const keyHandler = renderer.keyInput;
  onMount(() => {
    keyHandler.on("paste", callback);
  });
  onCleanup(() => {
    keyHandler.off("paste", callback);
  });
};
var useKeyHandler = useKeyboard;
var onFocus = (callback) => {
  const renderer = useRenderer();
  onMount(() => {
    renderer.on("focus", callback);
  });
  onCleanup(() => {
    renderer.off("focus", callback);
  });
};
var onBlur = (callback) => {
  const renderer = useRenderer();
  onMount(() => {
    renderer.on("blur", callback);
  });
  onCleanup(() => {
    renderer.off("blur", callback);
  });
};
var useSelectionHandler = (callback) => {
  const renderer = useRenderer();
  onMount(() => {
    renderer.on("selection", callback);
  });
  onCleanup(() => {
    renderer.off("selection", callback);
  });
};
var useTimeline = (options = {}) => {
  const timeline = new Timeline(options);
  onMount(() => {
    if (options.autoplay !== false) {
      timeline.play();
    }
    engine.register(timeline);
  });
  onCleanup(() => {
    timeline.pause();
    engine.unregister(timeline);
  });
  return timeline;
};

// solid/source/src/elements/extras.ts
import { createEffect, createMemo as createMemo2, createRoot as createRoot2, getOwner, onCleanup as onCleanup2, runWithOwner, splitProps, untrack as untrack2 } from "solid-js/dist/solid.js";

// solid/source/src/reconciler.ts
import {
  BaseRenderable,
  createTextAttributes,
  InputRenderable as InputRenderable2,
  InputRenderableEvents,
  isTextNodeRenderable,
  Renderable,
  RootTextNodeRenderable,
  ScrollBoxRenderable as ScrollBoxRenderable2,
  SelectRenderable,
  SelectRenderableEvents,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextNodeRenderable as TextNodeRenderable2,
  TextRenderable as TextRenderable2
} from "@defai-digital/ax-tui";
import { decodeHTML } from "entities";
import { useContext as useContext2 } from "solid-js/dist/solid.js";

// solid/source/src/renderer/universal.ts
import { createRoot, createRenderEffect, createMemo, createComponent, untrack, mergeProps } from "solid-js/dist/solid.js";
var memo = (fn) => createMemo(() => fn());
function createRenderer({
  createElement: createElement2,
  createTextNode: createTextNode2,
  createSlotNode: createSlotNode2,
  isTextNode,
  replaceText,
  insertNode: insertNode2,
  removeNode,
  setProperty,
  getParentNode,
  getFirstChild,
  getNextSibling
}) {
  function insert2(parent, accessor, marker = void 0, initial = void 0) {
    if (marker !== void 0 && !initial) initial = [];
    if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
    createRenderEffect((current) => insertExpression(parent, accessor(), current, marker), initial);
  }
  function insertExpression(parent, value, current, marker = void 0, unwrapArray = void 0) {
    while (typeof current === "function") current = current();
    if (value === current) return current;
    const t = typeof value, multi = marker !== void 0;
    if (t === "string" || t === "number") {
      if (t === "number") value = value.toString();
      if (multi) {
        let node = current[0];
        if (node && isTextNode(node)) {
          replaceText(node, value);
        } else node = createTextNode2(value);
        current = cleanChildren(parent, current, marker, node);
      } else {
        if (current !== "" && typeof current === "string") {
          replaceText(getFirstChild(parent), current = value);
        } else {
          cleanChildren(parent, current, marker, createTextNode2(value));
          current = value;
        }
      }
    } else if (value == null || t === "boolean") {
      current = cleanChildren(parent, current, marker);
    } else if (t === "function") {
      createRenderEffect(() => {
        let v = value();
        while (typeof v === "function") v = v();
        current = insertExpression(parent, v, current, marker);
      });
      return () => current;
    } else if (Array.isArray(value)) {
      const array = [];
      if (normalizeIncomingArray(array, value, unwrapArray)) {
        createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
        return () => current;
      }
      if (array.length === 0) {
        const replacement = cleanChildren(parent, current, marker);
        if (multi) return current = replacement;
      } else {
        if (Array.isArray(current)) {
          if (current.length === 0) {
            appendNodes(parent, array, marker);
          } else reconcileArrays(parent, current, array);
        } else if (current == null || current === "") {
          appendNodes(parent, array);
        } else {
          reconcileArrays(parent, multi && current || [getFirstChild(parent)], array);
        }
      }
      current = array;
    } else {
      if (Array.isArray(current)) {
        if (multi) return current = cleanChildren(parent, current, marker, value);
        cleanChildren(parent, current, null, value);
      } else if (current == null || current === "" || !getFirstChild(parent)) {
        insertNode2(parent, value);
      } else replaceNode(parent, value, getFirstChild(parent));
      current = value;
    }
    return current;
  }
  function normalizeIncomingArray(normalized, array, unwrap = void 0) {
    let dynamic = false;
    for (let i = 0, len = array.length; i < len; i++) {
      let item = array[i], t;
      if (item == null || item === true || item === false) continue;
      else if (Array.isArray(item)) {
        dynamic = normalizeIncomingArray(normalized, item) || dynamic;
      } else if ((t = typeof item) === "string" || t === "number") {
        normalized.push(createTextNode2(item));
      } else if (t === "function") {
        if (unwrap) {
          while (typeof item === "function") item = item();
          dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item]) || dynamic;
        } else {
          normalized.push(item);
          dynamic = true;
        }
      } else normalized.push(item);
    }
    return dynamic;
  }
  function reconcileArrays(parentNode, a, b) {
    let bLength = b.length, aEnd = a.length, bEnd = bLength, aStart = 0, bStart = 0, after = getNextSibling(a[aEnd - 1]), map = null;
    while (aStart < aEnd || bStart < bEnd) {
      if (a[aStart] === b[bStart]) {
        aStart++;
        bStart++;
        continue;
      }
      while (a[aEnd - 1] === b[bEnd - 1]) {
        aEnd--;
        bEnd--;
      }
      if (aEnd === aStart) {
        const node = bEnd < bLength ? bStart ? getNextSibling(b[bStart - 1]) : b[bEnd - bStart] : after;
        while (bStart < bEnd) insertNode2(parentNode, b[bStart++], node);
      } else if (bEnd === bStart) {
        while (aStart < aEnd) {
          if (!map || !map.has(a[aStart])) removeNode(parentNode, a[aStart]);
          aStart++;
        }
      } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
        const node = getNextSibling(a[--aEnd]);
        insertNode2(parentNode, b[bStart++], getNextSibling(a[aStart++]));
        insertNode2(parentNode, b[--bEnd], node);
        a[aEnd] = b[bEnd];
      } else {
        if (!map) {
          map = /* @__PURE__ */ new Map();
          let i = bStart;
          while (i < bEnd) map.set(b[i], i++);
        }
        const index = map.get(a[aStart]);
        if (index != null) {
          if (bStart < index && index < bEnd) {
            let i = aStart, sequence = 1, t;
            while (++i < aEnd && i < bEnd) {
              if ((t = map.get(a[i])) == null || t !== index + sequence) break;
              sequence++;
            }
            if (sequence > index - bStart) {
              const node = a[aStart];
              while (bStart < index) insertNode2(parentNode, b[bStart++], node);
            } else replaceNode(parentNode, b[bStart++], a[aStart++]);
          } else aStart++;
        } else removeNode(parentNode, a[aStart++]);
      }
    }
  }
  function cleanChildren(parent, current, marker = void 0, replacement = void 0) {
    if (marker === void 0) {
      let removed;
      while (removed = getFirstChild(parent)) removeNode(parent, removed);
      replacement && insertNode2(parent, replacement);
      return replacement ?? "";
    }
    const node = replacement || createSlotNode2();
    if (current.length) {
      let inserted = false;
      for (let i = current.length - 1; i >= 0; i--) {
        const el = current[i];
        if (node !== el) {
          const isParent = getParentNode(el) === parent;
          if (!inserted && !i) isParent ? replaceNode(parent, node, el) : insertNode2(parent, node, marker);
          else isParent && removeNode(parent, el);
        } else inserted = true;
      }
    } else insertNode2(parent, node, marker);
    return [node];
  }
  function appendNodes(parent, array, marker = void 0) {
    for (let i = 0, len = array.length; i < len; i++) insertNode2(parent, array[i], marker);
  }
  function replaceNode(parent, newNode, oldNode) {
    insertNode2(parent, newNode, oldNode);
    removeNode(parent, oldNode);
  }
  function spreadExpression(node, props, prevProps = {}, skipChildren = false) {
    props || (props = {});
    if (!skipChildren) {
      createRenderEffect(() => prevProps.children = insertExpression(node, props.children, prevProps.children));
    }
    createRenderEffect(() => props.ref && props.ref(node));
    createRenderEffect(() => {
      for (const prop in props) {
        if (prop === "children" || prop === "ref") continue;
        const value = props[prop];
        if (value === prevProps[prop]) continue;
        setProperty(node, prop, value, prevProps[prop]);
        prevProps[prop] = value;
      }
      for (const prop in prevProps) {
        if (prop === "children" || prop === "ref") continue;
        if (!(prop in props)) {
          setProperty(node, prop, void 0, prevProps[prop]);
          delete prevProps[prop];
        }
      }
    });
    return prevProps;
  }
  return {
    render(code, element) {
      let disposer;
      createRoot((dispose) => {
        disposer = dispose;
        insert2(element, code());
      });
      return disposer;
    },
    insert: insert2,
    spread(node, accessor, skipChildren) {
      if (typeof accessor === "function") {
        createRenderEffect(
          (current) => spreadExpression(node, accessor(), current, skipChildren)
        );
      } else spreadExpression(node, accessor, void 0, skipChildren);
    },
    createElement: createElement2,
    createTextNode: createTextNode2,
    insertNode: insertNode2,
    setProp(node, name, value, prev) {
      setProperty(node, name, value, prev);
      return value;
    },
    mergeProps,
    effect: createRenderEffect,
    memo,
    createComponent,
    use(fn, element, arg) {
      return untrack(() => fn(element, arg));
    }
  };
}

// solid/source/src/renderer/index.ts
import { mergeProps as mergeProps2 } from "solid-js/dist/solid.js";
function createRenderer2(options) {
  const renderer = createRenderer(options);
  renderer.mergeProps = mergeProps2;
  return renderer;
}

// solid/source/src/utils/id-counter.ts
var idCounter = /* @__PURE__ */ new Map();
function getNextId(elementType) {
  if (!idCounter.has(elementType)) {
    idCounter.set(elementType, 0);
  }
  const value = idCounter.get(elementType) + 1;
  idCounter.set(elementType, value);
  return `${elementType}-${value}`;
}

// solid/source/src/utils/log.ts
var log = (...args) => {
  if (process.env.DEBUG) {
    console.log("[Reconciler]", ...args);
  }
};

// solid/source/src/reconciler.ts
var TextNode = class _TextNode extends TextNodeRenderable2 {
  static fromString(text, options = {}) {
    const node = new _TextNode(options);
    node.add(text);
    return node;
  }
};
var logId = (node) => {
  if (!node) return void 0;
  return node.id;
};
var getNodeChildren = (node) => {
  let children2;
  if (node instanceof TextRenderable2) {
    children2 = node.getTextChildren();
  } else {
    children2 = node.getChildren();
  }
  return children2;
};
function _insertNode(parent, node, anchor) {
  log(
    "Inserting node:",
    logId(node),
    "into parent:",
    logId(parent),
    "with anchor:",
    logId(anchor),
    node instanceof TextNode
  );
  if (node instanceof SlotRenderable) {
    node.parent = parent;
    node = node.getSlotChild(parent);
  }
  if (anchor && anchor instanceof SlotRenderable) {
    anchor = anchor.getSlotChild(parent);
  }
  if (isTextNodeRenderable(node)) {
    if (!(parent instanceof TextRenderable2) && !isTextNodeRenderable(parent)) {
      throw new Error(
        `Orphan text error: "${node.toChunks().map((c) => c.text).join("")}" must have a <text> as a parent: ${parent.id} above ${node.id}`
      );
    }
    if (node === anchor) return;
    node.parent?.remove(node.id);
  }
  if (!(parent instanceof BaseRenderable)) {
    console.error("[INSERT]", "Tried to mount a non base renderable");
    throw new Error("Tried to mount a non base renderable");
  }
  jsxManagedParents.set(node, parent);
  if (!anchor) {
    parent.add(node);
    return;
  }
  const children2 = getNodeChildren(parent);
  const anchorIndex = children2.findIndex((el) => el.id === anchor.id);
  if (anchorIndex === -1) {
    log("[INSERT]", "Could not find anchor", logId(parent), logId(anchor), "[children]", ...children2.map((c) => c.id));
    parent.add(node);
    return;
  }
  if (parent instanceof TextRenderable2) {
    parent.insertBefore(node, anchor);
    return;
  }
  parent.add(node, anchorIndex);
}
function _removeNode(parent, node) {
  log("Removing node:", logId(node), "from parent:", logId(parent));
  let slotParent;
  if (node instanceof SlotRenderable) {
    slotParent = node;
    const slotChild = slotParent.getSlotChildForRemoval(parent);
    if (!slotChild) {
      if (slotParent.parent === parent) {
        slotParent.parent = null;
      }
      return;
    }
    node = slotChild;
  }
  if (jsxManagedParents.get(node) === parent) {
    jsxManagedParents.delete(node);
  }
  parent.remove(node.id);
  slotParent?.didRemoveSlotChild(parent, node);
  process.nextTick(() => {
    if (node instanceof BaseRenderable && !node.parent) {
      node.destroyRecursively();
      return;
    }
  });
}
function _createTextNode(value) {
  log("Creating text node:", value);
  const id = getNextId("text-node");
  if (typeof value === "number") {
    value = value.toString();
  }
  return TextNode.fromString(decodeHTML(value), { id });
}
function createSlotNode() {
  const id = getNextId("slot-node");
  log("Creating slot node", id);
  return new SlotRenderable(id);
}
function _getParentNode(childNode) {
  log("Getting parent of node:", logId(childNode));
  let parent = childNode.parent ?? void 0;
  if (parent instanceof RootTextNodeRenderable) {
    parent = parent.textParent ?? void 0;
  }
  const scrollBoxCandidate = parent?.parent?.parent?.parent;
  if (scrollBoxCandidate instanceof ScrollBoxRenderable2 && scrollBoxCandidate.content === parent) {
    parent = scrollBoxCandidate;
  }
  return parent;
}
var textStyleDefaults = /* @__PURE__ */ new WeakMap();
var jsxManagedParents = /* @__PURE__ */ new WeakMap();
var layoutStyleIntrinsicDefaults = {
  width: "auto",
  height: "auto",
  x: 0,
  y: 0
};
var layoutStyleCapturedDefaults = /* @__PURE__ */ new WeakMap();
var {
  render: _render,
  effect,
  memo: memo2,
  createComponent: createComponent2,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps: mergeProps3,
  use
} = createRenderer2({
  createElement(tagName) {
    log("Creating element:", tagName);
    const id = getNextId(tagName);
    const solidRenderer = useContext2(RendererContext);
    if (!solidRenderer) {
      throw new Error("No renderer found");
    }
    const elements = getComponentCatalogue();
    if (!elements[tagName]) {
      throw new Error(`[Reconciler] Unknown component type: ${tagName}`);
    }
    const element = new elements[tagName](solidRenderer, { id });
    log("Element created with id:", id);
    return element;
  },
  createTextNode: _createTextNode,
  createSlotNode,
  replaceText(textNode, value) {
    log("Replacing text:", value, "in node:", logId(textNode));
    if (!(textNode instanceof TextNode)) return;
    textNode.replace(decodeHTML(value), 0);
  },
  setProperty(node, name, value, prev) {
    if (name.startsWith("on:")) {
      const eventName = name.slice(3);
      if (value) {
        node.on(eventName, value);
      }
      if (prev) {
        node.off(eventName, prev);
      }
      return;
    }
    if (isTextNodeRenderable(node)) {
      if (name === "href") {
        node.link = { url: value };
        return;
      }
      if (name === "style") {
        let defaults = textStyleDefaults.get(node);
        if (!defaults) {
          defaults = { attributes: node.attributes, fg: node.fg, bg: node.bg };
          textStyleDefaults.set(node, defaults);
        }
        node.attributes = defaults.attributes | createTextAttributes(value ?? {});
        node.fg = value?.fg ?? defaults.fg;
        node.bg = value?.bg ?? defaults.bg;
        return;
      }
      return;
    }
    switch (name) {
      case "id":
        if (node.parent) break;
        log("Id mapped", node.id, "=", value);
        node[name] = value;
        break;
      case "focused":
        if (!(node instanceof Renderable)) return;
        if (value) {
          node.focus();
        } else {
          node.blur();
        }
        break;
      case "onChange":
        let event = void 0;
        if (node instanceof SelectRenderable) {
          event = SelectRenderableEvents.SELECTION_CHANGED;
        } else if (node instanceof TabSelectRenderable) {
          event = TabSelectRenderableEvents.SELECTION_CHANGED;
        } else if (node instanceof InputRenderable2) {
          event = InputRenderableEvents.CHANGE;
        }
        if (!event) break;
        if (value) {
          node.on(event, value);
        }
        if (prev) {
          node.off(event, prev);
        }
        break;
      case "onInput":
        if (node instanceof InputRenderable2) {
          if (value) {
            node.on(InputRenderableEvents.INPUT, value);
          }
          if (prev) {
            node.off(InputRenderableEvents.INPUT, prev);
          }
        }
        break;
      case "onSubmit":
        if (node instanceof InputRenderable2) {
          if (value) {
            node.on(InputRenderableEvents.ENTER, value);
          }
          if (prev) {
            node.off(InputRenderableEvents.ENTER, prev);
          }
        } else {
          node[name] = value;
        }
        break;
      case "onSelect":
        if (node instanceof SelectRenderable) {
          if (value) {
            node.on(SelectRenderableEvents.ITEM_SELECTED, value);
          }
          if (prev) {
            node.off(SelectRenderableEvents.ITEM_SELECTED, prev);
          }
        } else if (node instanceof TabSelectRenderable) {
          if (value) {
            node.on(TabSelectRenderableEvents.ITEM_SELECTED, value);
          }
          if (prev) {
            node.off(TabSelectRenderableEvents.ITEM_SELECTED, prev);
          }
        }
        break;
      case "style": {
        const nextStyle = value ?? {};
        let captured = layoutStyleCapturedDefaults.get(node);
        if (!captured) {
          captured = /* @__PURE__ */ new Map();
          layoutStyleCapturedDefaults.set(node, captured);
        }
        for (const prop in nextStyle) {
          const propVal = nextStyle[prop];
          if (prev !== void 0 && propVal === prev[prop]) continue;
          if (!(prop in layoutStyleIntrinsicDefaults) && !captured.has(prop)) {
            captured.set(prop, node[prop]);
          }
          node[prop] = propVal;
        }
        const prevStyle = prev ?? {};
        for (const prop in prevStyle) {
          if (prop in nextStyle) continue;
          if (prop in layoutStyleIntrinsicDefaults) {
            node[prop] = layoutStyleIntrinsicDefaults[prop];
          } else if (captured.has(prop)) {
            node[prop] = captured.get(prop);
            captured.delete(prop);
          }
        }
        break;
      }
      case "text":
      case "content": {
        const textValue = value == null ? "" : typeof value === "string" ? value : Array.isArray(value) ? value.join("") : `${value}`;
        node[name] = decodeHTML(textValue);
        break;
      }
      default:
        node[name] = value;
    }
  },
  isTextNode(node) {
    return node instanceof TextNode;
  },
  insertNode: _insertNode,
  removeNode: _removeNode,
  getParentNode: _getParentNode,
  getFirstChild(node) {
    log("Getting first child of node:", logId(node));
    const firstChild = getNodeChildren(node).find((child) => jsxManagedParents.get(child) === node);
    if (!firstChild) {
      log("No first child found for node:", logId(node));
      return void 0;
    }
    log("First child found:", logId(firstChild), "for node:", logId(node));
    return firstChild;
  },
  getNextSibling(node) {
    log("Getting next sibling of node:", logId(node));
    const parent = _getParentNode(node);
    if (!parent) {
      log("No parent found for node:", logId(node));
      return void 0;
    }
    if (node instanceof SlotRenderable) {
      const layoutSlotNode = node.getSlotChildForRemoval(parent);
      if (layoutSlotNode) {
        node = layoutSlotNode;
      }
    }
    const siblings = getNodeChildren(parent);
    const index = siblings.indexOf(node);
    if (index === -1 || index === siblings.length - 1) {
      log("No next sibling found for node:", logId(node));
      return void 0;
    }
    const nextSibling = siblings[index + 1];
    if (!nextSibling) {
      log("Next sibling is null for node:", logId(node));
      return void 0;
    }
    log("Next sibling found:", logId(nextSibling), "for node:", logId(node));
    return nextSibling;
  }
});

// solid/source/src/elements/extras.ts
function Portal(props) {
  const renderer = useRenderer();
  const marker = createSlotNode(), mount = () => props.mount || renderer.root, owner = getOwner();
  createEffect(
    () => {
      const el = mount();
      const container = createElement("box"), renderRoot = container;
      Object.defineProperty(container, "_$host", {
        get() {
          return marker.parent;
        },
        configurable: true
      });
      let disposeContent;
      const content = runWithOwner(
        owner,
        () => createRoot2((dispose) => {
          disposeContent = dispose;
          return createMemo2(() => props.children);
        })
      );
      insert(renderRoot, content);
      el.add(container);
      props.ref && props.ref(container);
      onCleanup2(() => {
        el.remove(container.id);
        container.destroyRecursively();
        disposeContent?.();
      });
    },
    void 0,
    { render: true }
  );
  return marker;
}
function createDynamic(component, props) {
  const cached = createMemo2(component);
  return createMemo2(() => {
    const component2 = cached();
    switch (typeof component2) {
      case "function":
        return untrack2(() => component2(props));
      case "string":
        const el = createElement(component2);
        spread(el, props);
        return el;
      default:
        break;
    }
  });
}
function Dynamic(props) {
  const [, others] = splitProps(props, ["component"]);
  return createDynamic(() => props.component, others);
}

// solid/source/src/elements/slot.ts
import { BaseRenderable as BaseRenderable2, isTextNodeRenderable as isTextNodeRenderable2, TextNodeRenderable as TextNodeRenderable3, TextRenderable as TextRenderable3, Yoga } from "@defai-digital/ax-tui";
function getLayoutNodeConstructor(parent) {
  const parentLayoutNode = parent?.getLayoutNode?.();
  return parentLayoutNode?.constructor;
}
function createLayoutSlotYogaNode(parentNodeConstructor) {
  return parentNodeConstructor?.create?.() ?? Yoga.default.Node.create();
}
var SlotBaseRenderable = class extends BaseRenderable2 {
  constructor(id) {
    super({
      id
    });
  }
  add(obj, index) {
    throw new Error("Can't add children on an Slot renderable");
  }
  getChildren() {
    return [];
  }
  remove(id) {
  }
  insertBefore(obj, anchor) {
    throw new Error("Can't add children on an Slot renderable");
  }
  getRenderable(id) {
    return void 0;
  }
  getChildrenCount() {
    return 0;
  }
  requestRender() {
  }
  findDescendantById(id) {
    return void 0;
  }
};
var TextSlotRenderable = class extends TextNodeRenderable3 {
  slotParent;
  destroyed = false;
  constructor(id, parent) {
    super({ id });
    this._visible = false;
    this.slotParent = parent;
  }
  detachFromSlot() {
    this.slotParent = void 0;
  }
  disposeWithoutSlotCascade() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.detachFromSlot();
  }
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const slotParent = this.slotParent;
    this.slotParent = void 0;
    slotParent?.destroy();
    super.destroy();
  }
};
var LayoutSlotRenderable = class extends SlotBaseRenderable {
  yogaNode;
  slotParent;
  destroyed = false;
  yogaNodeConstructor;
  yogaNodeFreed = false;
  constructor(id, parent, layoutParent) {
    super(id);
    this._visible = false;
    this.slotParent = parent;
    this.yogaNodeConstructor = getLayoutNodeConstructor(layoutParent);
    this.yogaNode = createLayoutSlotYogaNode(this.yogaNodeConstructor);
    this.yogaNode.setDisplay(Yoga.Display.None);
  }
  getLayoutNode() {
    return this.yogaNode;
  }
  updateFromLayout() {
  }
  updateLayout() {
  }
  onRemove() {
  }
  isCompatibleWith(layoutParent) {
    return this.yogaNodeConstructor === getLayoutNodeConstructor(layoutParent);
  }
  detachFromSlot() {
    this.slotParent = void 0;
  }
  freeYogaNode() {
    if (this.yogaNodeFreed) {
      return;
    }
    this.yogaNodeFreed = true;
    try {
      this.yogaNode.free();
    } catch {
    }
  }
  disposeWithoutSlotCascade() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.detachFromSlot();
    this.freeYogaNode();
  }
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const slotParent = this.slotParent;
    this.slotParent = void 0;
    this.freeYogaNode();
    slotParent?.destroy();
  }
  // A destroyed host walks its children with destroyRecursively(); the
  // BaseRenderable default is a no-op, which left this placeholder's Yoga node
  // allocated and pinned in the Yoga node registry forever.
  destroyRecursively() {
    if (this.destroyed) {
      return;
    }
    const host = this.parent;
    if (host) {
      host.remove(this.id);
    }
    const slotParent = this.slotParent;
    if (slotParent && host && slotParent.hasOtherAttachedSlotChildren(this)) {
      slotParent.didRemoveSlotChild(host, this);
      this.disposeWithoutSlotCascade();
      return;
    }
    this.destroy();
  }
};
var SlotRenderable = class extends SlotBaseRenderable {
  destroyed = false;
  layoutNodesByParent = /* @__PURE__ */ new Map();
  textNodesByParent = /* @__PURE__ */ new Map();
  layoutNodeCount = 0;
  textNodeCount = 0;
  constructor(id) {
    super(id);
    this._visible = false;
  }
  get layoutNode() {
    return this.getCurrentSlotChild(this.layoutNodesByParent);
  }
  get textNode() {
    return this.getCurrentSlotChild(this.textNodesByParent);
  }
  isTextSlotParent(parent) {
    return isTextNodeRenderable2(parent) || parent instanceof TextRenderable3;
  }
  getCurrentSlotChild(nodesByParent) {
    for (const node of nodesByParent.values()) {
      if (node.parent) {
        return node;
      }
    }
    return nodesByParent.values().next().value;
  }
  getTextNodeForParent(parent) {
    const mappedNode = this.textNodesByParent.get(parent);
    if (mappedNode) {
      return mappedNode;
    }
    for (const [mappedParent, textNode] of this.textNodesByParent) {
      if (textNode.parent !== parent) {
        continue;
      }
      this.textNodesByParent.delete(mappedParent);
      this.textNodesByParent.set(parent, textNode);
      return textNode;
    }
  }
  getLayoutNodeForParent(parent) {
    const mappedNode = this.layoutNodesByParent.get(parent);
    if (mappedNode) {
      return mappedNode;
    }
    for (const [mappedParent, layoutNode] of this.layoutNodesByParent) {
      if (layoutNode.parent !== parent) {
        continue;
      }
      this.layoutNodesByParent.delete(mappedParent);
      this.layoutNodesByParent.set(parent, layoutNode);
      return layoutNode;
    }
  }
  takeReusableTextNode(parent) {
    for (const [mappedParent, textNode] of this.textNodesByParent) {
      if (textNode.parent) {
        continue;
      }
      this.textNodesByParent.delete(mappedParent);
      this.textNodesByParent.set(parent, textNode);
      return textNode;
    }
  }
  takeReusableLayoutNode(parent) {
    for (const [mappedParent, layoutNode] of this.layoutNodesByParent) {
      if (layoutNode.parent) {
        continue;
      }
      if (!layoutNode.isCompatibleWith(parent)) {
        continue;
      }
      this.layoutNodesByParent.delete(mappedParent);
      this.layoutNodesByParent.set(parent, layoutNode);
      return layoutNode;
    }
  }
  disposeDetachedTextNodes() {
    for (const [parent, textNode] of this.textNodesByParent) {
      if (textNode.parent) {
        continue;
      }
      this.textNodesByParent.delete(parent);
      textNode.disposeWithoutSlotCascade();
    }
  }
  disposeDetachedIncompatibleLayoutNodes(parent) {
    for (const [mappedParent, layoutNode] of this.layoutNodesByParent) {
      if (layoutNode.parent || layoutNode.isCompatibleWith(parent)) {
        continue;
      }
      this.layoutNodesByParent.delete(mappedParent);
      layoutNode.disposeWithoutSlotCascade();
    }
  }
  // A slot can have multiple placeholder children attached transiently while a
  // move is in flight. Portal host tracking relies on `slot.parent` pointing at
  // one of the still-live hosts, not necessarily the most recently inserted one.
  getAttachedSlotParent(excludedNode) {
    for (const textNode of this.textNodesByParent.values()) {
      if (textNode !== excludedNode && textNode.parent) {
        return textNode.parent;
      }
    }
    for (const layoutNode of this.layoutNodesByParent.values()) {
      if (layoutNode !== excludedNode && layoutNode.parent) {
        return layoutNode.parent;
      }
    }
    return null;
  }
  hasOtherAttachedSlotChildren(excludedNode) {
    return this.getAttachedSlotParent(excludedNode) !== null;
  }
  getSlotChild(parent) {
    if (this.isTextSlotParent(parent)) {
      const existingTextNode = this.getTextNodeForParent(parent);
      if (existingTextNode) {
        return existingTextNode;
      }
      const reusableTextNode = this.takeReusableTextNode(parent);
      if (reusableTextNode) {
        return reusableTextNode;
      }
      this.disposeDetachedIncompatibleLayoutNodes(parent);
      const textNode = new TextSlotRenderable(`slot-text-${this.id}-${++this.textNodeCount}`, this);
      this.textNodesByParent.set(parent, textNode);
      return textNode;
    }
    const existingLayoutNode = this.getLayoutNodeForParent(parent);
    if (existingLayoutNode) {
      return existingLayoutNode;
    }
    const reusableLayoutNode = this.takeReusableLayoutNode(parent);
    if (reusableLayoutNode) {
      return reusableLayoutNode;
    }
    this.disposeDetachedTextNodes();
    this.disposeDetachedIncompatibleLayoutNodes(parent);
    const layoutNode = new LayoutSlotRenderable(`slot-layout-${this.id}-${++this.layoutNodeCount}`, this, parent);
    this.layoutNodesByParent.set(parent, layoutNode);
    return layoutNode;
  }
  getSlotChildForRemoval(parent) {
    if (this.isTextSlotParent(parent)) {
      return this.getTextNodeForParent(parent);
    }
    return this.getLayoutNodeForParent(parent);
  }
  didRemoveSlotChild(parent, child) {
    const hasOtherAttachedSlotChildren = this.hasOtherAttachedSlotChildren(child);
    if (hasOtherAttachedSlotChildren && child instanceof TextSlotRenderable && this.getTextNodeForParent(parent) === child) {
      this.textNodesByParent.delete(parent);
      child.disposeWithoutSlotCascade();
    }
    if (hasOtherAttachedSlotChildren && child instanceof LayoutSlotRenderable && this.getLayoutNodeForParent(parent) === child) {
      this.layoutNodesByParent.delete(parent);
      child.disposeWithoutSlotCascade();
    }
    if (this.parent === parent) {
      this.parent = this.getAttachedSlotParent(child);
    }
  }
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const layoutNodes = new Set(this.layoutNodesByParent.values());
    this.layoutNodesByParent.clear();
    for (const layoutNode of layoutNodes) {
      layoutNode.destroy();
    }
    const textNodes = new Set(this.textNodesByParent.values());
    this.textNodesByParent.clear();
    for (const textNode of textNodes) {
      textNode.destroy();
    }
  }
};

// solid/source/src/elements/virtual-list.ts
import { RenderableEvents as RenderableEvents2, VirtualListRenderable } from "@defai-digital/ax-tui";
import { createRoot as createRoot3, onCleanup as onCleanup3, splitProps as splitProps2 } from "solid-js/dist/solid.js";
function VirtualList(props) {
  const [fixed, reactive] = splitProps2(props, ["getKey", "renderItem", "estimateHeight", "overscan", "ref"]);
  const list = new VirtualListRenderable(useRenderer(), {
    ...reactive,
    getKey: fixed.getKey,
    renderItem: fixed.renderItem,
    estimateHeight: fixed.estimateHeight,
    overscan: fixed.overscan
  });
  const stopUpdates = createRoot3((dispose) => {
    spread(list, reactive);
    return dispose;
  });
  list.once(RenderableEvents2.DESTROYED, stopUpdates);
  onCleanup3(() => {
    stopUpdates();
    list.off(RenderableEvents2.DESTROYED, stopUpdates);
    list.destroyRecursively();
  });
  fixed.ref?.(list);
  return list;
}

// solid/source/src/elements/keymap-help.ts
import { KeymapHelpRenderable, RenderableEvents as RenderableEvents3 } from "@defai-digital/ax-tui";
import { createRoot as createRoot4, onCleanup as onCleanup4, splitProps as splitProps3 } from "solid-js/dist/solid.js";
function KeymapHelp(props) {
  const [fixed, reactive] = splitProps3(props, ["ref"]);
  const help = new KeymapHelpRenderable(useRenderer(), { ...reactive });
  const stopUpdates = createRoot4((dispose) => {
    spread(help, reactive);
    return dispose;
  });
  help.once(RenderableEvents3.DESTROYED, stopUpdates);
  onCleanup4(() => {
    stopUpdates();
    help.off(RenderableEvents3.DESTROYED, stopUpdates);
    help.destroyRecursively();
  });
  fixed.ref?.(help);
  return help;
}

// solid/source/src/elements/application.ts
import {
  getCommandRegistry,
  getFocusManager,
  RenderableEvents as RenderableEvents4,
  showCommandPalette
} from "@defai-digital/ax-tui";
import { onCleanup as onCleanup5 } from "solid-js/dist/solid.js";
function useFocusManager() {
  const manager = getFocusManager(useRenderer());
  const scopes = /* @__PURE__ */ new Set();
  let disposed = false;
  onCleanup5(() => {
    disposed = true;
    for (const remove of [...scopes]) remove();
  });
  return {
    registerScope(root, options) {
      if (disposed) throw new Error("Focus scope owner is disposed");
      const unregister = manager.registerScope(root, options);
      const remove = () => {
        scopes.delete(remove);
        root.off(RenderableEvents4.DESTROYED, remove);
        unregister();
      };
      scopes.add(remove);
      root.once(RenderableEvents4.DESTROYED, remove);
      return remove;
    },
    focusNext: () => !disposed && manager.focusNext(),
    focusPrevious: () => !disposed && manager.focusPrevious()
  };
}
function useCommands() {
  const registry = getCommandRegistry(useRenderer());
  const registrations = /* @__PURE__ */ new Set();
  let disposed = false;
  onCleanup5(() => {
    disposed = true;
    for (const remove of [...registrations]) remove();
  });
  return {
    register(command, target) {
      if (disposed) throw new Error("Command owner is disposed");
      const unregister = registry.register(command, target);
      const remove = () => {
        registrations.delete(remove);
        target?.off(RenderableEvents4.DESTROYED, remove);
        unregister();
      };
      registrations.add(remove);
      target?.once(RenderableEvents4.DESTROYED, remove);
      return remove;
    },
    execute: registry.execute.bind(registry),
    search: registry.search.bind(registry)
  };
}
function useCommandPalette() {
  const renderer = useRenderer();
  const palettes = /* @__PURE__ */ new Set();
  let disposed = false;
  onCleanup5(() => {
    disposed = true;
    for (const palette of [...palettes]) palette.close();
    palettes.clear();
  });
  return {
    show(options) {
      if (disposed) throw new Error("Command palette owner is disposed");
      const palette = showCommandPalette(renderer, options);
      const scoped = {
        ...palette,
        get selectedId() {
          return palette.selectedId;
        },
        close() {
          palettes.delete(scoped);
          palette.close();
        }
      };
      palettes.add(scoped);
      void palette.result.then(() => palettes.delete(scoped));
      return scoped;
    }
  };
}

// solid/source/src/scrollback.ts
import {
  BoxRenderable as BoxRenderable2,
  RootRenderable
} from "@defai-digital/ax-tui";
import { createSignal as createSignal2 } from "solid-js/dist/solid.js";
var solidScrollbackRootCounter = 0;
var MAX_AUTO_HEIGHT_PASSES = 4;
function normalizeSnapshotDimension(value, axis) {
  if (value === void 0) {
    return void 0;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`createScrollbackWriter requires a finite ${axis}`);
  }
  return Math.max(1, Math.trunc(value));
}
function createSnapshotRendererValue(renderContext, root, width, height, firstLineOffset) {
  const [snapshotWidth] = createSignal2(width);
  const [snapshotHeight, setSnapshotHeight] = createSignal2(height);
  const renderer = Object.create(renderContext);
  let offset = firstLineOffset;
  Object.defineProperties(renderer, {
    root: {
      value: root,
      enumerable: true,
      configurable: true
    },
    width: {
      get: snapshotWidth,
      enumerable: true,
      configurable: true
    },
    height: {
      get: snapshotHeight,
      enumerable: true,
      configurable: true
    },
    claimFirstLineOffset: {
      value: () => {
        const out = offset;
        offset = 0;
        return out;
      },
      enumerable: true,
      configurable: true
    }
  });
  return {
    renderer,
    getHeight: snapshotHeight,
    setHeight(nextHeight) {
      setSnapshotHeight(nextHeight);
      renderer.emit("resize", snapshotWidth(), nextHeight);
    }
  };
}
function runLifecyclePasses(renderContext) {
  for (const renderable of renderContext.getLifecyclePasses()) {
    renderable.onLifecyclePass?.call(renderable);
  }
}
function clearLifecyclePasses(renderContext) {
  for (const renderable of [...renderContext.getLifecyclePasses()]) {
    renderContext.unregisterLifecyclePass(renderable);
  }
}
function measureSnapshotHeight(renderContext, root) {
  const measureRoot = new RootRenderable(renderContext);
  try {
    measureRoot.add(root);
    runLifecyclePasses(renderContext);
    measureRoot.calculateLayout();
    return Math.max(1, Math.trunc(root.getLayoutNode().getComputedLayout().height));
  } finally {
    if (root.parent === measureRoot) {
      measureRoot.remove(root.id);
    }
    measureRoot.destroyRecursively();
  }
}
function resolveSnapshotHeight(renderContext, root, snapshotRenderer) {
  for (let pass = 0; pass < MAX_AUTO_HEIGHT_PASSES; pass++) {
    const measuredHeight = measureSnapshotHeight(renderContext, root);
    if (measuredHeight === snapshotRenderer.getHeight()) {
      clearLifecyclePasses(renderContext);
      return measuredHeight;
    }
    snapshotRenderer.setHeight(measuredHeight);
  }
  return measureSnapshotHeight(renderContext, root);
}
function createScrollbackWriter(node, options = {}) {
  return (ctx) => {
    const width = normalizeSnapshotDimension(options.width, "width") ?? Math.max(1, Math.trunc(ctx.width));
    const height = normalizeSnapshotDimension(options.height, "height");
    const startOnNewLine = options.startOnNewLine ?? true;
    const firstLineWidth = !startOnNewLine && ctx.tailColumn > 0 && ctx.tailColumn < ctx.width ? Math.min(width, ctx.width - ctx.tailColumn) : width;
    const firstLineOffset = width - firstLineWidth;
    const root = new BoxRenderable2(ctx.renderContext, {
      id: `solid-scrollback-root-${solidScrollbackRootCounter++}`,
      position: "absolute",
      left: 0,
      top: 0,
      width,
      height: height ?? "auto",
      border: false,
      backgroundColor: "transparent",
      shouldFill: false,
      flexDirection: "column"
    });
    const snapshotRenderer = createSnapshotRendererValue(
      ctx.renderContext,
      root,
      width,
      height ?? Math.max(1, ctx.renderContext.height),
      firstLineOffset
    );
    let dispose;
    let disposed = false;
    const teardown = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      dispose?.();
    };
    try {
      dispose = _render(
        () => createComponent2(RendererContext.Provider, {
          get value() {
            return snapshotRenderer.renderer;
          },
          get children() {
            return node(ctx);
          }
        }),
        root
      );
      return {
        root,
        width,
        height: height ?? resolveSnapshotHeight(ctx.renderContext, root, snapshotRenderer),
        rowColumns: options.rowColumns,
        startOnNewLine,
        trailingNewline: options.trailingNewline,
        teardown
      };
    } catch (error) {
      teardown();
      root.destroyRecursively();
      throw error;
    }
  };
}
function writeSolidToScrollback(renderer, node, options = {}) {
  renderer.writeToScrollback(createScrollbackWriter(node, options));
}

// solid/source/src/time-to-first-draw.tsx
import { spread as _$spread } from "@defai-digital/ax-tui/solid";
import { createElement as _$createElement } from "@defai-digital/ax-tui/solid";
import { TimeToFirstDrawRenderable } from "@defai-digital/ax-tui";
extend({
  time_to_first_draw: TimeToFirstDrawRenderable
});
var TimeToFirstDraw = (props) => {
  return (() => {
    var _el$ = _$createElement("time_to_first_draw");
    _$spread(_el$, props, false);
    return _el$;
  })();
};

// solid/source/src/plugins/slot.tsx
import { memo as _$memo } from "@defai-digital/ax-tui/solid";
import { createComponent as _$createComponent } from "@defai-digital/ax-tui/solid";
import { mergeProps as _$mergeProps } from "@defai-digital/ax-tui/solid";
import { createSlotRegistry } from "@defai-digital/ax-tui";
import { children, createMemo as createMemo3, createSignal as createSignal3, ErrorBoundary, For, onCleanup as onCleanup6, splitProps as splitProps4 } from "solid-js/dist/solid.js";
var EMPTY_ENTRY_IDS = [];
function createSolidSlotRegistry(renderer, context, options = {}) {
  return createSlotRegistry(renderer, "solid:slot-registry", context, options);
}
function createSlot(registry, options = {}) {
  return function BoundSlot(props) {
    return _$createComponent(Slot, _$mergeProps(props, {
      registry,
      get pluginFailurePlaceholder() {
        return options.pluginFailurePlaceholder;
      }
    }));
  };
}
function Slot(props) {
  const [local, slotProps] = splitProps4(props, ["registry", "name", "mode", "children", "pluginFailurePlaceholder"]);
  const registry = () => local.registry;
  const pluginFailurePlaceholder = () => local.pluginFailurePlaceholder;
  const [version, setVersion] = createSignal3(0);
  let queued = false;
  let disposed = false;
  const unsubscribe = registry().subscribe(() => {
    if (queued) return;
    queued = true;
    setVersion((current) => current + 1);
    queueMicrotask(() => {
      queued = false;
      if (disposed) return;
    });
  });
  onCleanup6(() => {
    disposed = true;
    unsubscribe();
  });
  const entries = createMemo3((previousEntries = []) => {
    version();
    const resolvedEntries = registry().resolveEntries(local.name);
    if (resolvedEntries.length === 0) {
      if (previousEntries.length === 0) return previousEntries;
      return [];
    }
    const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]));
    const nextEntries = resolvedEntries.map((entry) => {
      const previousEntry = previousById.get(entry.id);
      if (previousEntry && previousEntry.renderer === entry.renderer) {
        return previousEntry;
      }
      return entry;
    });
    const unchanged = nextEntries.length === previousEntries.length && nextEntries.every((entry, index) => entry === previousEntries[index]);
    if (unchanged) return previousEntries;
    return nextEntries;
  });
  const entryIds = createMemo3(() => entries().map((entry) => entry.id));
  const entriesById = createMemo3(() => new Map(entries().map((entry) => [entry.id, entry])));
  const slotName = () => String(local.name);
  const renderFallback = () => {
    const value = children(() => local.children)();
    return value ?? null;
  };
  const resolveFallback = (fallbackValue) => fallbackValue?.() ?? null;
  const renderPluginFailurePlaceholder = (failure, fallbackValue) => {
    if (!pluginFailurePlaceholder()) {
      return resolveFallback(fallbackValue);
    }
    try {
      return pluginFailurePlaceholder()(failure);
    } catch (error) {
      registry().reportPluginError({
        pluginId: failure.pluginId,
        slot: failure.slot ?? slotName(),
        phase: "error_placeholder",
        source: "solid",
        error
      });
      return resolveFallback(fallbackValue);
    }
  };
  const renderEntry = (entry, fallbackOnError) => {
    let initialRender;
    try {
      initialRender = entry.renderer(registry().context, slotProps);
    } catch (error) {
      const failure = registry().reportPluginError({
        pluginId: entry.id,
        slot: slotName(),
        phase: "render",
        source: "solid",
        error
      });
      return renderPluginFailurePlaceholder(failure, fallbackOnError);
    }
    const resolvedInitialRender = children(() => initialRender);
    const hasInitialOutput = resolvedInitialRender.toArray().some((node) => node !== null && node !== void 0 && node !== false);
    if (!hasInitialOutput) {
      return resolveFallback(fallbackOnError);
    }
    return _$createComponent(ErrorBoundary, {
      fallback: (error) => {
        const failure = registry().reportPluginError({
          pluginId: entry.id,
          slot: slotName(),
          phase: "render",
          source: "solid",
          error
        });
        return renderPluginFailurePlaceholder(failure, fallbackOnError);
      },
      get children() {
        return resolvedInitialRender();
      }
    });
  };
  const AppendEntry = (appendProps) => {
    const entry = createMemo3(() => entriesById().get(appendProps.entryId));
    return _$memo(() => {
      const resolvedEntry = entry();
      if (!resolvedEntry) {
        return null;
      }
      return renderEntry(resolvedEntry);
    });
  };
  const appendEntryIds = createMemo3(() => {
    const mode = local.mode ?? "append";
    if (mode !== "append") {
      return EMPTY_ENTRY_IDS;
    }
    return entryIds();
  });
  const appendView = [renderFallback, _$createComponent(For, {
    get each() {
      return appendEntryIds();
    },
    children: (entryId) => _$createComponent(AppendEntry, {
      entryId
    })
  })];
  return _$memo(() => {
    const resolvedEntries = entries();
    const mode = local.mode ?? "append";
    if (resolvedEntries.length === 0) {
      return renderFallback();
    }
    if (mode === "single_winner") {
      const winner = resolvedEntries[0];
      if (!winner) {
        return renderFallback();
      }
      return renderEntry(winner, renderFallback);
    }
    if (mode === "replace") {
      const renderedEntries = resolvedEntries.map((entry) => renderEntry(entry));
      const hasPluginOutput = renderedEntries.some((entry) => entry !== null && entry !== void 0 && entry !== false);
      if (!hasPluginOutput) {
        return renderFallback();
      }
      return renderedEntries;
    }
    return appendView;
  });
}

// solid/source/index.ts
var mountSolidRoot = (renderer, node) => {
  let dispose;
  let disposeRequested = false;
  let disposed = false;
  let mounting = true;
  let destroyRequested = false;
  const originalDestroy = renderer.destroy.bind(renderer);
  const runDispose = () => {
    if (disposed) {
      return;
    }
    if (!dispose) {
      disposeRequested = true;
      return;
    }
    disposed = true;
    dispose();
  };
  renderer.once("destroy", runDispose);
  renderer.destroy = () => {
    if (mounting) {
      destroyRequested = true;
      return;
    }
    originalDestroy();
  };
  try {
    dispose = _render(
      () => createComponent2(RendererContext.Provider, {
        get value() {
          return renderer;
        },
        get children() {
          return createComponent2(node, {});
        }
      }),
      renderer.root
    );
  } finally {
    mounting = false;
    renderer.destroy = originalDestroy;
  }
  if (disposeRequested) {
    runDispose();
  }
  if (destroyRequested) {
    originalDestroy();
  }
};
var render = async (node, rendererOrConfig = {}) => {
  const renderer = rendererOrConfig instanceof CliRenderer ? rendererOrConfig : await createCliRenderer({
    ...rendererOrConfig,
    onDestroy: () => {
      rendererOrConfig.onDestroy?.();
    }
  });
  engine2.attach(renderer);
  mountSolidRoot(renderer, node);
};
var testRender = async (node, renderConfig = {}) => {
  const testSetup = await createTestRenderer({
    ...renderConfig,
    onDestroy: () => {
      renderConfig.onDestroy?.();
    }
  });
  engine2.attach(testSetup.renderer);
  mountSolidRoot(testSetup.renderer, node);
  return testSetup;
};
export {
  BoldSpanRenderable,
  Dynamic,
  ItalicSpanRenderable,
  KeymapHelp,
  LayoutSlotRenderable,
  LineBreakRenderable,
  LinkRenderable,
  Portal,
  RendererContext,
  Slot,
  SlotRenderable,
  TextSlotRenderable,
  TimeToFirstDraw,
  UnderlineSpanRenderable,
  VirtualList,
  _render,
  baseComponents,
  componentCatalogue,
  createComponent2 as createComponent,
  createDynamic,
  createElement,
  createScrollbackWriter,
  createSlot,
  createSlotNode,
  createSolidSlotRegistry,
  createTextNode,
  effect,
  extend,
  getComponentCatalogue,
  insert,
  insertNode,
  memo2 as memo,
  mergeProps3 as mergeProps,
  onBlur,
  onFocus,
  onResize,
  render,
  setProp,
  spread,
  testRender,
  textNodeKeys,
  use,
  useCommandPalette,
  useCommands,
  useFocusManager,
  useKeyHandler,
  useKeyboard,
  useKeymap,
  useOverlay,
  usePaste,
  useRenderer,
  useSelectionHandler,
  useTerminalDimensions,
  useTimeline,
  writeSolidToScrollback
};
