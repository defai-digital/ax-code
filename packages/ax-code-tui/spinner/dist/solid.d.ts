import { SpinnerRenderable } from "./index.js";
declare module "@ax-code/tui/solid" {
    interface AxTuiComponents {
        spinner: typeof SpinnerRenderable;
    }
}
