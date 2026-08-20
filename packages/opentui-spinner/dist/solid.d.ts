import { SpinnerRenderable } from "./index.js";
declare module "@ax-code/opentui-solid" {
    interface OpenTUIComponents {
        spinner: typeof SpinnerRenderable;
    }
}
