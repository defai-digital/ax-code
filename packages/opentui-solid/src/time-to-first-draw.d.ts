import { TimeToFirstDrawRenderable } from "@ax-code/opentui-core";
import type { ExtendedComponentProps } from "./types/elements.js";
declare module "@ax-code/opentui-solid" {
    interface OpenTUIComponents {
        time_to_first_draw: typeof TimeToFirstDrawRenderable;
    }
}
export type TimeToFirstDrawProps = ExtendedComponentProps<typeof TimeToFirstDrawRenderable>;
export declare const TimeToFirstDraw: (props: TimeToFirstDrawProps) => any;
