export interface RendererOptions<NodeType> {
  createElement(tag: string): NodeType
  createTextNode(value: string): NodeType
  createSlotNode(): NodeType
  replaceText(textNode: NodeType, value: string): void
  isTextNode(node: NodeType): boolean
  setProperty<T>(node: NodeType, name: string, value: T, prev?: T): void
  insertNode(parent: NodeType, node: NodeType, anchor?: NodeType): void
  removeNode(parent: NodeType, node: NodeType): void
  getParentNode(node: NodeType): NodeType | undefined
  getFirstChild(node: NodeType): NodeType | undefined
  getNextSibling(node: NodeType): NodeType | undefined
}

export interface Renderer<NodeType> {
  render(code: () => unknown, node: NodeType): () => void
  effect<T>(fn: (prev?: T) => T, init?: T): void
  memo<T>(fn: () => T, equal: boolean): () => T
  createComponent: typeof createComponent
  createElement(tag: string): NodeType
  createTextNode(value: string): NodeType
  insertNode(parent: NodeType, node: NodeType, anchor?: NodeType): void
  insert<T>(parent: any, accessor: (() => T) | T, marker?: any | null, initial?: any): NodeType
  spread<T>(node: any, accessor: (() => T) | T, skipChildren?: boolean): void
  setProp<T>(node: NodeType, name: string, value: T, prev?: T): T
  mergeProps(...sources: unknown[]): unknown
  use<A, T>(fn: (element: NodeType, arg: A) => T, element: NodeType, arg: A): T
}

import { createRoot, createRenderEffect, createMemo, createComponent, untrack, mergeProps } from "solid-js"

const memo = <T>(fn: () => T) => createMemo(() => fn())

export function createRenderer<NodeType>({
  createElement,
  createTextNode,
  createSlotNode,
  isTextNode,
  replaceText,
  insertNode,
  removeNode,
  setProperty,
  getParentNode,
  getFirstChild,
  getNextSibling,
}: RendererOptions<NodeType>): Renderer<NodeType> {
  function insert(parent: any, accessor: any, marker: any = undefined, initial: any = undefined): any {
    if (marker !== undefined && !initial) initial = []
    if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker)
    createRenderEffect((current) => insertExpression(parent, accessor(), current, marker), initial)
  }
  function insertExpression(
    parent: any,
    value: any,
    current: any,
    marker: any = undefined,
    unwrapArray: any = undefined,
  ): any {
    while (typeof current === "function") current = current()
    if (value === current) return current
    const t = typeof value,
      multi = marker !== undefined
    if (t === "string" || t === "number") {
      if (t === "number") value = value.toString()
      if (multi) {
        let node = current[0]
        if (node && isTextNode(node)) {
          replaceText(node, value)
        } else node = createTextNode(value)
        current = cleanChildren(parent, current, marker, node)
      } else {
        if (current !== "" && typeof current === "string") {
          replaceText(getFirstChild(parent)!, (current = value))
        } else {
          cleanChildren(parent, current, marker, createTextNode(value))
          current = value
        }
      }
    } else if (value == null || t === "boolean") {
      current = cleanChildren(parent, current, marker)
    } else if (t === "function") {
      createRenderEffect(() => {
        let v = value()
        while (typeof v === "function") v = v()
        current = insertExpression(parent, v, current, marker)
      })
      return () => current
    } else if (Array.isArray(value)) {
      const array: any[] = []
      if (normalizeIncomingArray(array, value, unwrapArray)) {
        createRenderEffect(() => (current = insertExpression(parent, array, current, marker, true)))
        return () => current
      }
      if (array.length === 0) {
        const replacement = cleanChildren(parent, current, marker)
        if (multi) return (current = replacement)
      } else {
        if (Array.isArray(current)) {
          if (current.length === 0) {
            appendNodes(parent, array, marker)
          } else reconcileArrays(parent, current, array)
        } else if (current == null || current === "") {
          appendNodes(parent, array)
        } else {
          reconcileArrays(parent, (multi && current) || [getFirstChild(parent)], array)
        }
      }
      current = array
    } else {
      if (Array.isArray(current)) {
        if (multi) return (current = cleanChildren(parent, current, marker, value))
        cleanChildren(parent, current, null, value)
      } else if (current == null || current === "" || !getFirstChild(parent)) {
        insertNode(parent, value)
      } else replaceNode(parent, value, getFirstChild(parent))
      current = value
    }
    return current
  }
  function normalizeIncomingArray(normalized: any, array: any, unwrap: any = undefined): any {
    let dynamic = false
    for (let i = 0, len = array.length; i < len; i++) {
      let item = array[i],
        t
      if (item == null || item === true || item === false) continue
      else if (Array.isArray(item)) {
        dynamic = normalizeIncomingArray(normalized, item) || dynamic
      } else if ((t = typeof item) === "string" || t === "number") {
        normalized.push(createTextNode(item))
      } else if (t === "function") {
        if (unwrap) {
          while (typeof item === "function") item = item()
          dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item]) || dynamic
        } else {
          normalized.push(item)
          dynamic = true
        }
      } else normalized.push(item)
    }
    return dynamic
  }
  function reconcileArrays(parentNode: any, a: any, b: any): any {
    let bLength = b.length,
      aEnd = a.length,
      bEnd = bLength,
      aStart = 0,
      bStart = 0,
      after = getNextSibling(a[aEnd - 1]),
      map = null
    while (aStart < aEnd || bStart < bEnd) {
      if (a[aStart] === b[bStart]) {
        aStart++
        bStart++
        continue
      }
      while (a[aEnd - 1] === b[bEnd - 1]) {
        aEnd--
        bEnd--
      }
      if (aEnd === aStart) {
        const node = bEnd < bLength ? (bStart ? getNextSibling(b[bStart - 1]) : b[bEnd - bStart]) : after
        while (bStart < bEnd) insertNode(parentNode, b[bStart++], node)
      } else if (bEnd === bStart) {
        while (aStart < aEnd) {
          if (!map || !map.has(a[aStart])) removeNode(parentNode, a[aStart])
          aStart++
        }
      } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
        const node = getNextSibling(a[--aEnd])
        insertNode(parentNode, b[bStart++], getNextSibling(a[aStart++]))
        insertNode(parentNode, b[--bEnd], node)
        a[aEnd] = b[bEnd]
      } else {
        if (!map) {
          map = new Map()
          let i = bStart
          while (i < bEnd) map.set(b[i], i++)
        }
        const index = map.get(a[aStart])
        if (index != null) {
          if (bStart < index && index < bEnd) {
            let i = aStart,
              sequence = 1,
              t
            while (++i < aEnd && i < bEnd) {
              if ((t = map.get(a[i])) == null || t !== index + sequence) break
              sequence++
            }
            if (sequence > index - bStart) {
              const node = a[aStart]
              while (bStart < index) insertNode(parentNode, b[bStart++], node)
            } else replaceNode(parentNode, b[bStart++], a[aStart++])
          } else aStart++
        } else removeNode(parentNode, a[aStart++])
      }
    }
  }
  function cleanChildren(parent: any, current: any, marker: any = undefined, replacement: any = undefined): any {
    if (marker === undefined) {
      let removed
      while ((removed = getFirstChild(parent))) removeNode(parent, removed)
      replacement && insertNode(parent, replacement)
      return replacement ?? ""
    }
    const node = replacement || createSlotNode()
    if (current.length) {
      let inserted = false
      for (let i = current.length - 1; i >= 0; i--) {
        const el = current[i]
        if (node !== el) {
          const isParent = getParentNode(el) === parent
          if (!inserted && !i) isParent ? replaceNode(parent, node, el) : insertNode(parent, node, marker)
          else isParent && removeNode(parent, el)
        } else inserted = true
      }
    } else insertNode(parent, node, marker)
    return [node]
  }
  function appendNodes(parent: any, array: any, marker: any = undefined): any {
    for (let i = 0, len = array.length; i < len; i++) insertNode(parent, array[i], marker)
  }
  function replaceNode(parent: any, newNode: any, oldNode: any): any {
    insertNode(parent, newNode, oldNode)
    removeNode(parent, oldNode)
  }
  function spreadExpression(
    node: any,
    props: any,
    prevProps: Record<string, any> = {},
    skipChildren: boolean = false,
  ): any {
    props || (props = {})
    if (!skipChildren) {
      createRenderEffect(() => (prevProps.children = insertExpression(node, props.children, prevProps.children)))
    }
    createRenderEffect(() => props.ref && props.ref(node))
    createRenderEffect(() => {
      for (const prop in props) {
        if (prop === "children" || prop === "ref") continue
        const value = props[prop]
        if (value === prevProps[prop]) continue
        setProperty(node, prop, value, prevProps[prop])
        prevProps[prop] = value
      }
      // Props that disappeared from the source must be unset, otherwise stale
      // values stick on the node forever (Solid's DOM spread diffs both ways).
      for (const prop in prevProps) {
        if (prop === "children" || prop === "ref") continue
        if (!(prop in props)) {
          setProperty(node, prop, undefined, prevProps[prop])
          delete prevProps[prop]
        }
      }
    })
    return prevProps
  }
  return {
    render(code, element) {
      let disposer: (() => void) | undefined
      createRoot((dispose) => {
        disposer = dispose
        insert(element, code())
      })
      return disposer!
    },
    insert,
    spread<T>(node: any, accessor: (() => T) | T, skipChildren?: boolean) {
      if (typeof accessor === "function") {
        createRenderEffect((current) =>
          spreadExpression(node, (accessor as () => T)(), current as Record<string, any>, skipChildren),
        )
      } else spreadExpression(node, accessor, undefined, skipChildren)
    },
    createElement,
    createTextNode,
    insertNode,
    setProp(node, name, value, prev) {
      setProperty(node, name, value, prev)
      return value
    },
    mergeProps,
    effect: createRenderEffect,
    memo,
    createComponent,
    use(fn, element, arg) {
      return untrack(() => fn(element, arg))
    },
  }
}
