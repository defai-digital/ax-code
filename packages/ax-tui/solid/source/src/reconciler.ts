/* @refresh skip */
import {
  BaseRenderable,
  createTextAttributes,
  InputRenderable,
  InputRenderableEvents,
  isTextNodeRenderable,
  Renderable,
  RootTextNodeRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextNodeRenderable,
  TextRenderable,
  type TextNodeOptions,
} from "@defai-digital/ax-tui"
import { decodeHTML } from "entities"
import { useContext } from "solid-js"
import { createRenderer } from "./renderer/index.js"
import { getComponentCatalogue, RendererContext, SlotRenderable } from "./elements/index.js"
import { getNextId } from "./utils/id-counter.js"
import { log } from "./utils/log.js"

class TextNode extends TextNodeRenderable {
  public static override fromString(text: string, options: Partial<TextNodeOptions> = {}): TextNode {
    const node = new TextNode(options)
    node.add(text)
    return node
  }
}

export type DomNode = BaseRenderable

/**
 * Gets the id of a node, or content if it's a text chunk.
 * Intended for use in logging.
 * @param node The node to get the id of.
 * @returns Log-friendly id of the node.
 */
const logId = (node?: DomNode): string | undefined => {
  if (!node) return undefined
  return node.id
}

const getNodeChildren = (node: DomNode) => {
  let children
  if (node instanceof TextRenderable) {
    children = node.getTextChildren()
  } else {
    children = node.getChildren()
  }
  return children
}

function _insertNode(parent: DomNode, node: DomNode, anchor?: DomNode): void {
  log(
    "Inserting node:",
    logId(node),
    "into parent:",
    logId(parent),
    "with anchor:",
    logId(anchor),
    node instanceof TextNode,
  )

  if (node instanceof SlotRenderable) {
    node.parent = parent
    node = node.getSlotChild(parent)
  }

  if (anchor && anchor instanceof SlotRenderable) {
    anchor = anchor.getSlotChild(parent)
  }

  if (isTextNodeRenderable(node)) {
    if (!(parent instanceof TextRenderable) && !isTextNodeRenderable(parent)) {
      throw new Error(
        `Orphan text error: "${node
          .toChunks()
          .map((c) => c.text)
          .join("")}" must have a <text> as a parent: ${parent.id} above ${node.id}`,
      )
    }

    if (node === anchor) return

    // Inline text insertion must move existing nodes, like layout insertion.
    // Detach first so sibling indices reflect the tree after the move.
    node.parent?.remove(node.id)
  }

  // Renderable nodes
  if (!(parent instanceof BaseRenderable)) {
    console.error("[INSERT]", "Tried to mount a non base renderable")
    // Can't be a noop, have to panic
    throw new Error("Tried to mount a non base renderable")
  }

  jsxManagedParents.set(node, parent)

  if (!anchor) {
    parent.add(node)
    return
  }

  const children = getNodeChildren(parent)

  const anchorIndex = children.findIndex((el) => el.id === anchor.id)
  if (anchorIndex === -1) {
    log("[INSERT]", "Could not find anchor", logId(parent), logId(anchor), "[children]", ...children.map((c) => c.id))
    parent.add(node)
    return
  }

  // Text parents filter raw string children out of getNodeChildren, but add()
  // indexes the unfiltered child array; insertBefore resolves the anchor by
  // identity so the two index spaces cannot diverge.
  if (parent instanceof TextRenderable) {
    parent.insertBefore(node, anchor)
    return
  }

  parent.add(node, anchorIndex)
}

function _removeNode(parent: DomNode, node: DomNode): void {
  log("Removing node:", logId(node), "from parent:", logId(parent))

  let slotParent: SlotRenderable | undefined

  if (node instanceof SlotRenderable) {
    slotParent = node
    const slotChild = slotParent.getSlotChildForRemoval(parent)
    if (!slotChild) {
      if (slotParent.parent === parent) {
        slotParent.parent = null
      }
      return
    }

    node = slotChild
  }

  if (jsxManagedParents.get(node) === parent) {
    jsxManagedParents.delete(node)
  }

  parent.remove(node.id)

  slotParent?.didRemoveSlotChild(parent, node)

  process.nextTick(() => {
    if (node instanceof BaseRenderable && !node.parent) {
      node.destroyRecursively()
      return
    }
  })
}

function _createTextNode(value: string | number): TextNode {
  log("Creating text node:", value)

  const id = getNextId("text-node")

  if (typeof value === "number") {
    value = value.toString()
  }

  return TextNode.fromString(decodeHTML(value), { id })
}

export function createSlotNode(): SlotRenderable {
  const id = getNextId("slot-node")
  log("Creating slot node", id)
  return new SlotRenderable(id)
}

function _getParentNode(childNode: DomNode): DomNode | undefined {
  log("Getting parent of node:", logId(childNode))

  let parent = childNode.parent ?? undefined
  if (parent instanceof RootTextNodeRenderable) {
    parent = parent.textParent ?? undefined
  }
  // ScrollBox delegates add/remove to its internal `content` wrapper
  // (scrollbox → wrapper → viewport → content), so children report
  // `content` as their parent. Return the ScrollBox so the identity
  // check in cleanChildren (getParentNode(el) === parent) succeeds.
  const scrollBoxCandidate = parent?.parent?.parent?.parent
  if (scrollBoxCandidate instanceof ScrollBoxRenderable && scrollBoxCandidate.content === parent) {
    parent = scrollBoxCandidate
  }
  return parent
}

// Retain intrinsic/custom defaults while reactive style objects are replaced or removed.
const textStyleDefaults = new WeakMap<TextNodeRenderable, Pick<TextNodeRenderable, "attributes" | "fg" | "bg">>()

// Tracks which parent inserted each node through the reconciler. Child queries
// (getFirstChild) and cleanChildren's wipe loop must only operate on these
// JSX-managed children — a renderable's own internal children (Diff's sides,
// LineNumber's gutter, Portal containers) are added outside the reconciler and
// must never be removed by it.
const jsxManagedParents = new WeakMap<DomNode, DomNode>()

// Layout style subkeys that disappear from a later style object are restored
// to these intrinsic defaults. x/y/width/height getters return computed values
// (absolute/computed pixels), so they cannot be captured reliably; every other
// styleable prop's getter returns the raw set value and is captured lazily.
const layoutStyleIntrinsicDefaults: Record<string, unknown> = {
  width: "auto",
  height: "auto",
  x: 0,
  y: 0,
}
const layoutStyleCapturedDefaults = new WeakMap<DomNode, Map<string, unknown>>()

export const {
  render: _render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
} = createRenderer<DomNode>({
  createElement(tagName: string): DomNode {
    log("Creating element:", tagName)
    const id = getNextId(tagName)
    const solidRenderer = useContext(RendererContext)
    if (!solidRenderer) {
      throw new Error("No renderer found")
    }
    const elements = getComponentCatalogue()

    if (!elements[tagName]) {
      throw new Error(`[Reconciler] Unknown component type: ${tagName}`)
    }

    const element = new elements[tagName](solidRenderer, { id })
    log("Element created with id:", id)
    return element
  },

  createTextNode: _createTextNode,

  createSlotNode,

  replaceText(textNode: TextNode, value: string): void {
    log("Replacing text:", value, "in node:", logId(textNode))

    if (!(textNode instanceof TextNode)) return
    textNode.replace(decodeHTML(value), 0)
  },

  setProperty(node: DomNode, name: string, value: any, prev: any): void {
    if (name.startsWith("on:")) {
      const eventName = name.slice(3)
      if (value) {
        node.on(eventName, value)
      }
      if (prev) {
        node.off(eventName, prev)
      }

      return
    }

    if (isTextNodeRenderable(node)) {
      if (name === "href") {
        node.link = { url: value }
        return
      }

      if (name === "style") {
        let defaults = textStyleDefaults.get(node)
        if (!defaults) {
          defaults = { attributes: node.attributes, fg: node.fg, bg: node.bg }
          textStyleDefaults.set(node, defaults)
        }
        node.attributes = defaults.attributes | createTextAttributes(value ?? {})
        node.fg = value?.fg ?? defaults.fg
        node.bg = value?.bg ?? defaults.bg
        return
      }

      return
    }

    switch (name) {
      case "id":
        // The id is the key in the parent's renderable registry, captured at
        // insert time. Mutating it after insertion would desync removal
        // (parent.remove(newId) misses), leaving a ghost node behind, so only
        // accept the id while the node is not yet mounted.
        if (node.parent) break
        log("Id mapped", node.id, "=", value)
        node[name] = value
        break
      case "focused":
        if (!(node instanceof Renderable)) return
        if (value) {
          node.focus()
        } else {
          node.blur()
        }
        break
      case "onChange":
        let event: string | undefined = undefined
        if (node instanceof SelectRenderable) {
          event = SelectRenderableEvents.SELECTION_CHANGED
        } else if (node instanceof TabSelectRenderable) {
          event = TabSelectRenderableEvents.SELECTION_CHANGED
        } else if (node instanceof InputRenderable) {
          event = InputRenderableEvents.CHANGE
        }
        if (!event) break

        if (value) {
          node.on(event, value)
        }
        if (prev) {
          node.off(event, prev)
        }
        break
      case "onInput":
        if (node instanceof InputRenderable) {
          if (value) {
            node.on(InputRenderableEvents.INPUT, value)
          }

          if (prev) {
            node.off(InputRenderableEvents.INPUT, prev)
          }
        }

        break
      case "onSubmit":
        if (node instanceof InputRenderable) {
          if (value) {
            node.on(InputRenderableEvents.ENTER, value)
          }

          if (prev) {
            node.off(InputRenderableEvents.ENTER, prev)
          }
        } else {
          // @ts-expect-error todo validate if prop is actually settable
          node[name] = value
        }
        break
      case "onSelect":
        if (node instanceof SelectRenderable) {
          if (value) {
            node.on(SelectRenderableEvents.ITEM_SELECTED, value)
          }

          if (prev) {
            node.off(SelectRenderableEvents.ITEM_SELECTED, prev)
          }
        } else if (node instanceof TabSelectRenderable) {
          if (value) {
            node.on(TabSelectRenderableEvents.ITEM_SELECTED, value)
          }

          if (prev) {
            node.off(TabSelectRenderableEvents.ITEM_SELECTED, prev)
          }
        }
        break
      case "style": {
        const nextStyle = value ?? {}
        let captured = layoutStyleCapturedDefaults.get(node)
        if (!captured) {
          captured = new Map()
          layoutStyleCapturedDefaults.set(node, captured)
        }

        for (const prop in nextStyle) {
          const propVal = nextStyle[prop]
          if (prev !== undefined && propVal === prev[prop]) continue
          // Capture the raw current value before the first style-driven write
          // so a later removal of this subkey can restore it.
          if (!(prop in layoutStyleIntrinsicDefaults) && !captured.has(prop)) {
            // @ts-expect-error todo validate if prop is actually settable
            captured.set(prop, node[prop])
          }
          // @ts-expect-error todo validate if prop is actually settable
          node[prop] = propVal
        }

        // Subkeys present in the previous style but missing now must fall back
        // to their intrinsic (or captured pre-style) value instead of sticking.
        const prevStyle = prev ?? {}
        for (const prop in prevStyle) {
          if (prop in nextStyle) continue
          if (prop in layoutStyleIntrinsicDefaults) {
            // @ts-expect-error todo validate if prop is actually settable
            node[prop] = layoutStyleIntrinsicDefaults[prop]
          } else if (captured.has(prop)) {
            // @ts-expect-error todo validate if prop is actually settable
            node[prop] = captured.get(prop)
            captured.delete(prop)
          }
        }
        break
      }
      case "text":
      case "content": {
        const textValue =
          value == null ? "" : typeof value === "string" ? value : Array.isArray(value) ? value.join("") : `${value}`
        // @ts-expect-error todo validate if prop is actually settable
        node[name] = decodeHTML(textValue)
        break
      }

      default:
        // @ts-expect-error todo validate if prop is actually settable
        node[name] = value
    }
  },

  isTextNode(node: DomNode): boolean {
    return node instanceof TextNode
  },

  insertNode: _insertNode,

  removeNode: _removeNode,

  getParentNode: _getParentNode,

  getFirstChild(node: DomNode): DomNode | undefined {
    log("Getting first child of node:", logId(node))

    const firstChild = getNodeChildren(node).find((child) => jsxManagedParents.get(child) === node)

    if (!firstChild) {
      log("No first child found for node:", logId(node))
      return undefined
    }

    log("First child found:", logId(firstChild), "for node:", logId(node))
    return firstChild
  },

  getNextSibling(node: DomNode): DomNode | undefined {
    log("Getting next sibling of node:", logId(node))

    const parent = _getParentNode(node)
    if (!parent) {
      log("No parent found for node:", logId(node))
      return undefined
    }

    if (node instanceof SlotRenderable) {
      const layoutSlotNode = node.getSlotChildForRemoval(parent)
      if (layoutSlotNode) {
        node = layoutSlotNode
      }
    }

    const siblings = getNodeChildren(parent)
    const index = siblings.indexOf(node)

    if (index === -1 || index === siblings.length - 1) {
      log("No next sibling found for node:", logId(node))
      return undefined
    }

    const nextSibling = siblings[index + 1]

    if (!nextSibling) {
      log("Next sibling is null for node:", logId(node))
      return undefined
    }

    log("Next sibling found:", logId(nextSibling), "for node:", logId(node))
    return nextSibling
  },
})
