import { MeasureMode } from "../yoga.js";
export interface TextMeasureView {
    measureForDimensions(width: number, height: number): {
        lineCount: number;
        widthColsMax: number;
    } | null;
}
export declare function createTextMeasureFunc(view: TextMeasureView, isAbsolute: () => boolean): (width: number, widthMode: MeasureMode, height: number, heightMode: MeasureMode) => {
    width: number;
    height: number;
};
