import { SpinnerRenderable } from "./index.js"
import { extend } from "@ax-code/opentui-solid"

declare module "@ax-code/opentui-solid" {
  interface OpenTUIComponents {
    spinner: typeof SpinnerRenderable
  }
}

extend({ spinner: SpinnerRenderable })
