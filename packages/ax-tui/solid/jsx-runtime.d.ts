/**
 * Automatic JSX runtime and terminal intrinsic types.
 *
 * @module
 */
export {};
import type { BoxProps, CodeProps, ExtendedIntrinsicElements, InputProps, LinkProps, MarkdownProps, AxTuiComponents, ScrollBoxProps, SpanProps, TextareaProps, TextProps } from "./src/types/elements.js";
import type { JSX as SolidJSX } from "solid-js";
type SolidComponent = (props: Record<string, unknown>) => JSX.Element;
interface JsxProps {
    children?: unknown;
    key?: unknown;
    [key: string]: unknown;
}
export declare function jsx(type: string | SolidComponent, props?: JsxProps | null): JSX.Element;
export declare const jsxs: typeof jsx;
export declare function jsxDEV(type: string | SolidComponent, props?: JsxProps | null): JSX.Element;
export declare function Fragment(props: {
    children?: JSX.Element;
}): JSX.Element;
export declare namespace JSX {
    type Element = SolidJSX.Element;
    interface IntrinsicElements extends ExtendedIntrinsicElements<AxTuiComponents> {
        box: BoxProps;
        text: TextProps;
        span: SpanProps;
        input: InputProps;
        scrollbox: ScrollBoxProps;
        code: CodeProps;
        textarea: TextareaProps;
        markdown: MarkdownProps;
        b: SpanProps;
        strong: SpanProps;
        i: SpanProps;
        em: SpanProps;
        u: SpanProps;
        br: {};
        a: LinkProps;
    }
    interface ElementChildrenAttribute {
        children: {};
    }
}
