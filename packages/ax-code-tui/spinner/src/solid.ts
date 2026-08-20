import { SpinnerRenderable } from "./index.js"
import { extend } from "@ax-code/tui/solid"

declare module "@ax-code/tui/solid" {
  interface AxTuiComponents {
    spinner: typeof SpinnerRenderable
  }
}

extend({ spinner: SpinnerRenderable })
