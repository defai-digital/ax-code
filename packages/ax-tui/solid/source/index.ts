/**
 * SolidJS reconciler and component lifecycle for AX TUI.
 *
 * @module
 */
export {}
import { CliRenderer, Renderable, createCliRenderer, engine, type CliRendererConfig } from "@defai-digital/ax-tui"
import { createTestRenderer, type TestRendererOptions } from "@defai-digital/ax-tui/testing"
import type { JSX } from "./jsx-runtime.js"
import { RendererContext } from "./src/elements/index.js"
import { _render as renderInternal, createComponent } from "./src/reconciler.js"

type DisposeFn = () => void

const mountSolidRoot = (renderer: CliRenderer, node: () => JSX.Element) => {
  let dispose: DisposeFn | undefined
  let disposeRequested = false
  let disposed = false
  let mounting = true
  let destroyRequested = false

  const originalDestroy = renderer.destroy.bind(renderer)

  const runDispose = () => {
    if (disposed) {
      return
    }

    if (!dispose) {
      disposeRequested = true
      return
    }

    disposed = true
    dispose()
  }

  renderer.once("destroy", runDispose)

  renderer.destroy = () => {
    if (mounting) {
      destroyRequested = true
      return
    }

    originalDestroy()
  }

  const before = new Set(Renderable.renderablesByNumber.keys())
  try {
    dispose = renderInternal(
      () =>
        createComponent(RendererContext.Provider, {
          get value() {
            return renderer
          },
          get children() {
            return (createComponent as any)(node, {})
          },
        }),
      renderer.root,
    )
  } catch (error) {
    // A throw partway through inserting the tree leaves earlier siblings
    // attached under root (disposing the Solid owner does not detach nodes);
    // destroy those orphans so the failed mount does not pollute later frames.
    for (const [num, orphan] of Renderable.renderablesByNumber) {
      if (!before.has(num)) orphan.destroyRecursively()
    }
    // The mount never completed: nothing to dispose on a later destroy.
    renderer.off("destroy", runDispose)
    throw error
  } finally {
    mounting = false
    renderer.destroy = originalDestroy
    // Honor destruction requested while the mount was in flight (even when
    // the mount then failed) now that the destroy override is restored.
    if (disposeRequested) {
      runDispose()
    }
    if (destroyRequested) {
      originalDestroy()
    }
  }
}

export const render = async (node: () => JSX.Element, rendererOrConfig: CliRenderer | CliRendererConfig = {}) => {
  const ownsRenderer = !(rendererOrConfig instanceof CliRenderer)
  const renderer = ownsRenderer
    ? await createCliRenderer({
        ...rendererOrConfig,
        onDestroy: () => {
          rendererOrConfig.onDestroy?.()
        },
      })
    : rendererOrConfig

  engine.attach(renderer)
  try {
    mountSolidRoot(renderer, node)
  } catch (error) {
    // The caller has no handle to the renderer we created; destroy it so a
    // failed mount does not leak the native renderer and event listeners.
    if (ownsRenderer) renderer.destroy()
    throw error
  }
}

export const testRender = async (node: () => JSX.Element, renderConfig: TestRendererOptions = {}) => {
  const testSetup = await createTestRenderer({
    ...renderConfig,
    onDestroy: () => {
      renderConfig.onDestroy?.()
    },
  })

  engine.attach(testSetup.renderer)
  try {
    mountSolidRoot(testSetup.renderer, node)
  } catch (error) {
    // The caller never receives the setup; destroy it so a failed mount does
    // not leak the renderer and its native resources.
    testSetup.renderer.destroy()
    throw error
  }

  return testSetup
}

export * from "./src/reconciler.js"
export * from "./src/elements/index.js"
export * from "./src/scrollback.js"
export * from "./src/time-to-first-draw.js"
export * from "./src/plugins/slot.js"
export * from "./src/types/elements.js"
export { type JSX }
