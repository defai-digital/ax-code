import assert from "node:assert/strict"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ImageRenderable, InputRenderable, Renderable, TextRenderable, VirtualListRenderable, type AllocatorStats,
  getCommandRegistry, getFocusManager, showCommandPalette, resolveRenderLib } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"

export async function stressApplication(iterations = 1000, seed = 0xa871) {
  assert.ok(Number.isSafeInteger(iterations) && iterations >= 100 && iterations <= 100000)
  assert.ok(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff)
  const originalSeed = seed
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }
  // Drain native output through the custom Writable/feed path. The test helper's
  // default memory destination intentionally retains the entire ANSI transcript,
  // which would make RSS growth a measurement of captured output, not a leak.
  const setup = await createTestRenderer({ width: 80, height: 24, useKittyKeyboard: null, maxFps: 1000000,
    useThread: false, bufferedOutput: "stdout" })
  const { renderer } = setup
  const start = performance.now()
  const heapSamples: {
    iteration: number
    heapUsed: number
    rss: number
    arrayBuffers: number
    nativeArenaBytes: number
    nativeAllocator: AllocatorStats
  }[] = []
  let maxMounted = 0
  let maxLiveRenderables = 0
  let executed = 0
  let cancelledLoads = 0
  let nextId = 10000
  const pixels = (green: number) => ({ width: 2, height: 2,
    data: Uint8Array.from([0, green, 255, 255, 0, green, 255, 255, 0, green, 255, 255, 0, green, 255, 255]) })
  let items = Array.from({ length: 10000 }, (_, id) => ({ id, text: `ROW-${id} 中文 ${"wrap ".repeat(id % 4)}` }))
  const label = new TextRenderable(renderer, { height: 1, content: "State 中文 e\u0301 👩‍💻" })
  const input = new InputRenderable(renderer, { id: "stress-input", value: "Edit 中文", width: "100%" })
  const image = new ImageRenderable(renderer, { width: 4, height: 2, position: "absolute", top: 0, right: 0,
    source: pixels(255), protocol: "blocks" })
  const list = new VirtualListRenderable(renderer, {
    items, width: "100%", flexGrow: 1, getKey: item => item.id, estimateHeight: 2,
    renderItem: (item, _index, context) => new TextRenderable(context, {
      content: item.text, width: "100%", wrapMode: "word",
    }),
  })
  renderer.root.add(label)
  renderer.root.add(input)
  renderer.root.add(list)
  renderer.root.add(image)
  getFocusManager(renderer).registerScope(renderer.root)
  input.focus()
  const registry = getCommandRegistry(renderer)
  registry.register({ id: "stress.execute", title: "Execute stress command", run() { executed++ } })
  const baselineKeyListeners = renderer.keyInput.listenerCount("keypress")
  const settle = async () => {
    for (let pass = 0; pass < 3; pass++) {
      await new Promise(resolve => setImmediate(resolve))
      await renderer.idle()
    }
  }
  try {
    await image.loadPromise
    await settle()
    for (let iteration = 0; iteration < iterations; iteration++) {
      // Fixed seed, bounded data window, changing identities and measured heights.
      if (iteration % 3 === 0) {
        const id = nextId++
        items = [...items.slice(1), { id, text: `ROW-${id} 中文 ${"tail ".repeat(iteration % 11)}` }]
        list.items = items
      }
      if (iteration % 11 === 0) {
        const [width, height] = [[40, 12], [120, 40], [80, 24]][random() % 3]
        setup.resize(width, height)
      }
      const target = random() % (items.length - 40)
      list.scrollToIndex(target)
      await settle()
      assert.ok(setup.captureCharFrame().includes(`ROW-${items[target].id} `),
        `Missing target row at iteration ${iteration}, seed ${originalSeed}`)
      assert.ok(setup.captureCharFrame().includes("State 中文 e\u0301 👩‍💻"), "Unicode header was corrupted")
      if (iteration % 7 === 0) {
        let complete!: (value: ReturnType<typeof pixels>) => void
        image.source = signal => {
          signal.addEventListener("abort", () => { cancelledLoads++ }, { once: true })
          return new Promise(resolve => { complete = resolve })
        }
        await Promise.resolve()
        const stale = image.loadPromise
        image.source = pixels(iteration % 256)
        await image.loadPromise
        complete(pixels(0))
        await stale
        assert.equal(image.loadError, null)
      }
      if (iteration % 10 === 0) {
        input.focus()
        const palette = showCommandPalette(renderer, { query: "Execute stress" })
        await settle()
        assert.equal(palette.selectedId, "stress.execute")
        if (iteration % 20 === 0) assert.equal((await palette.executeSelected())?.status, "executed")
        else {
          palette.close()
          assert.equal(await palette.result, null)
        }
        assert.equal(renderer.currentFocusedRenderable, input, "Palette did not restore focus")
        const temporary = new InputRenderable(renderer, { id: `temporary-${iteration}` })
        renderer.root.add(temporary)
        registry.register({ id: "temporary", title: "Temporary", run() {} }, temporary)
        temporary.destroy()
        assert.equal(registry.search().length, 1, "Destroyed command target retained a registration")
      }
      input.value = `Edit ${iteration} 中文`
      await settle()
      maxMounted = Math.max(maxMounted, list.mountedCount)
      maxLiveRenderables = Math.max(maxLiveRenderables, Renderable.renderablesByNumber.size)
      assert.ok(list.mountedCount <= renderer.height + 10, "Virtual row mounting grew without bound")
      assert.ok(Renderable.renderablesByNumber.size < 120, "Renderable registry grew without bound")
      assert.equal(renderer.keyInput.listenerCount("keypress"), baselineKeyListeners, "Key listeners leaked")
      assert.equal(registry.listenerCount("change"), 0, "Palette retained its command subscription")
      const frame = renderer.frameId
      await settle()
      assert.equal(renderer.frameId, frame, "Settled workload kept repainting")
      if (iteration % 100 === 99) {
        globalThis.gc?.()
        const { heapUsed, rss, arrayBuffers } = process.memoryUsage()
        const nativeArenaBytes = resolveRenderLib().getArenaAllocatedBytes()
        const nativeAllocator = resolveRenderLib().getAllocatorStats()
        heapSamples.push({ iteration: iteration + 1, heapUsed, rss, arrayBuffers, nativeArenaBytes, nativeAllocator })
        if (heapSamples.length > 3) {
          assert.ok(nativeArenaBytes - heapSamples[2].nativeArenaBytes < 65536,
            "Process-lifetime native arena grew by over 64 KiB after warmup")
        }
      }
    }
    // Ignore initial cache warmup; exact object/listener checks above are the
    // primary leak oracle. Heap guard requires explicit GC and a long enough run.
    if (globalThis.gc && heapSamples.length >= 5) {
      const baseline = heapSamples[2].heapUsed
      assert.ok(heapSamples.at(-1)!.heapUsed - baseline < 32 * 1024 * 1024, "Retained JS heap grew by over 32 MiB")
    }
    return { status: "AX_APPLICATION_STRESS_COMPLETE", seed: originalSeed, iterations,
      elapsedMs: performance.now() - start, maxMounted, maxLiveRenderables, executed, cancelledLoads,
      explicitGc: Boolean(globalThis.gc), output: "drained native span feed",
      nativeBuildOptions: resolveRenderLib().getBuildOptions(), heapSamples }
  } finally {
    renderer.destroy()
    assert.equal(Renderable.renderablesByNumber.size, 0, "Renderer teardown retained renderables")
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = await stressApplication(Number(process.argv[2] ?? 1000), Number(process.argv[3] ?? 0xa871))
  console.log(JSON.stringify(summary))
}
