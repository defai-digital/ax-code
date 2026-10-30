import { VirtualListRenderable, type VirtualListOptions } from "@defai-digital/ax-tui";
import type { JSX } from "../../jsx-runtime.js";
/** Solid-owned list; renderItem constructs imperative rows, not already mounted JSX. */
export declare function VirtualList<T>(props: VirtualListOptions<T> & {
    ref?: (list: VirtualListRenderable<T>) => void;
}): JSX.Element;
