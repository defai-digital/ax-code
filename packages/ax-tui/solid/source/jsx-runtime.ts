/**
 * Automatic JSX runtime and terminal intrinsic types.
 *
 * @module
 */
export {}
import { createComponent, createElement, spread } from "@defai-digital/ax-tui/solid"
import type {
  BoxProps,
  CodeProps,
  ExtendedIntrinsicElements,
  InputProps,
  LinkProps,
  MarkdownProps,
  AxTuiComponents,
  ScrollBoxProps,
  SpanProps,
  TextareaProps,
  TextProps,
} from "./src/types/elements.js"
import type { JSX as SolidJSX } from "solid-js"

type SolidComponent = (props: Record<string, unknown>) => JSX.Element

interface JsxProps {
  children?: unknown
  key?: unknown
  [key: string]: unknown
}

function normalizeProps(props: JsxProps | null | undefined): Record<string, unknown> {
  if (!props) {
    return {}
  }

  if (!("key" in props)) {
    return props
  }

  // Strip `key` without rest destructuring: spreading or destructuring
  // invokes every getter eagerly and copies static values, which destroys
  // Solid reactivity for props that forward signal-backed getters.
  const rest: Record<string, unknown> = {}
  for (const name of Object.keys(props)) {
    if (name === "key") continue
    const descriptor = Object.getOwnPropertyDescriptor(props, name)
    if (descriptor) Object.defineProperty(rest, name, descriptor)
  }
  return rest
}

function createIntrinsicElement(type: string, props: Record<string, unknown>): JSX.Element {
  const element = createElement(type)
  spread(element, props)
  return element as unknown as JSX.Element
}

export function jsx(type: string | SolidComponent, props: JsxProps | null = {}): JSX.Element {
  const normalizedProps = normalizeProps(props)

  if (typeof type === "function") {
    return (createComponent as any)(type, normalizedProps)
  }

  return createIntrinsicElement(type, normalizedProps)
}

export const jsxs = jsx

export function jsxDEV(type: string | SolidComponent, props: JsxProps | null = {}): JSX.Element {
  return jsx(type, props)
}

export function Fragment(props: { children?: JSX.Element }): JSX.Element {
  return props.children ?? null
}

export namespace JSX {
  export type Element = SolidJSX.Element

  export interface IntrinsicElements extends ExtendedIntrinsicElements<AxTuiComponents> {
    box: BoxProps
    text: TextProps
    span: SpanProps
    input: InputProps

    scrollbox: ScrollBoxProps
    code: CodeProps
    textarea: TextareaProps
    markdown: MarkdownProps

    b: SpanProps
    strong: SpanProps
    i: SpanProps
    em: SpanProps
    u: SpanProps
    br: {}
    a: LinkProps
  }

  export interface ElementChildrenAttribute {
    children: {}
  }
}
