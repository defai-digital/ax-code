import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { Writable } from "node:stream"
import { fileURLToPath } from "node:url"
import {
  benchmarkChild,
  benchmarkOptions,
  benchmarkProvenance,
  distribution,
  writeBenchmarkReport,
} from "./benchmark-support.js"
import { tuiRoot } from "./build-text-width-experiment.js"

export const applicationWorkloads = ["stream-markdown", "scroll-history", "resize-text", "large-code"] as const
export type ApplicationWorkload = (typeof applicationWorkloads)[number]

export async function measureApplicationWorkload(workload: ApplicationWorkload, iterations: number, warmup: number) {
  assert.ok(applicationWorkloads.includes(workload))
  assert.ok(Number.isSafeInteger(iterations) && iterations >= 1 && iterations <= 10000)
  assert.ok(Number.isSafeInteger(warmup) && warmup >= 0 && warmup <= 10000)
  const {
    MarkdownRenderable,
    CodeRenderable,
    TextRenderable,
    VirtualListRenderable,
    ScrollBoxRenderable,
    SyntaxStyle,
    TreeSitterClient,
    CliRenderEvents,
    Renderable,
    resolveRenderLib,
  } = await import("../index.js")
  const { createTestRenderer } = await import("../testing.js")
  const coldStart = performance.now()
  let outputBytes = 0
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        outputBytes += chunk.byteLength
        callback()
      },
    }),
    { isTTY: true, columns: 120, rows: 40, getColorDepth: () => 24 },
  )
  const setup = await createTestRenderer({
    width: 120,
    height: 40,
    useThread: false,
    maxFps: 1000000,
    useKittyKeyboard: null,
    consoleMode: "disabled",
    bufferedOutput: "stdout",
    stdout: stdout as unknown as NodeJS.WriteStream,
  })
  const { renderer } = setup
  const cache = mkdtempSync(join(tmpdir(), "ax-tui-benchmark-"))
  const client = new TreeSitterClient({ dataPath: cache })
  const style = SyntaxStyle.fromStyles({
    keyword: { fg: "#ff8800" },
    string: { fg: "#00ff00" },
    comment: { fg: "#888888" },
  })
  let measuring = false
  let rootRenderMs = 0
  let nativeDiffMs = 0
  let nativeOutputMs = 0
  let frames = 0
  let cellsUpdated = 0
  let highlightRequests = 0
  let highlightRequestMs = 0
  let highlightCount = 0
  let styledTextMs = 0
  let styledChunks = 0
  const parserFailures: string[] = []
  const highlight = client.highlightOnce.bind(client)
  client.highlightOnce = async (...args) => {
    const start = performance.now()
    const response = await highlight(...args)
    if (response.error || response.warning) parserFailures.push(response.error ?? response.warning!)
    highlightCount += response.highlights?.length ?? 0
    if (measuring) {
      highlightRequests++
      highlightRequestMs += performance.now() - start
    }
    return response
  }
  const renderRoot = renderer.root.render.bind(renderer.root)
  const lib = resolveRenderLib()
  const setStyledText = lib.textBufferSetStyledText
  lib.textBufferSetStyledText = function (...args) {
    const start = performance.now()
    try {
      return setStyledText.apply(this, args)
    } finally {
      if (measuring) {
        styledTextMs += performance.now() - start
        styledChunks += args[1].length
      }
    }
  }
  renderer.root.render = (...args) => {
    const start = performance.now()
    try {
      return renderRoot(...args)
    } finally {
      if (measuring) rootRenderMs += performance.now() - start
    }
  }
  renderer.on(CliRenderEvents.FRAME, () => {
    if (!measuring) return
    const stats = renderer.getNativeStats()
    assert.ok(
      stats.nativeRenderTime !== undefined && stats.nativeStdoutWriteTime !== undefined,
      "Native phase timings are unavailable",
    )
    // The native ABI reports microseconds. These are nested phase timings, not
    // independent wall-time components; feed delivery is asynchronous.
    nativeDiffMs += stats.nativeRenderTime / 1000
    nativeOutputMs += stats.nativeStdoutWriteTime / 1000
    cellsUpdated += stats.cellsUpdated
    frames++
  })
  const codeNodes = (node: InstanceType<typeof Renderable>): InstanceType<typeof CodeRenderable>[] => [
    ...(node instanceof CodeRenderable ? [node] : []),
    ...node.getChildren().flatMap(codeNodes),
  ]
  const settle = async () => {
    for (let pass = 0; pass < 30; pass++) {
      await renderer.idle()
      await Promise.all(codeNodes(renderer.root).map((code) => code.highlightingDone))
      await new Promise((resolve) => setImmediate(resolve))
      const state = renderer.getSchedulerState()
      if (
        !state.isRendering &&
        !state.isRunning &&
        !state.hasScheduledRender &&
        !codeNodes(renderer.root).some((code) => code.isHighlighting)
      )
        return
    }
    throw new Error(`Workload did not settle: ${workload}`)
  }
  let mutate: (tick: number) => void
  let verify: (tick: number) => void
  let detail: Record<string, unknown>
  try {
    await client.initialize()
    if (workload === "stream-markdown") {
      const scroll = new ScrollBoxRenderable(renderer, {
        width: "100%",
        height: "100%",
        stickyScroll: true,
        stickyStart: "bottom",
        scrollX: false,
      })
      let content = "# Conversation\n\n" + "Prior response with **formatting** and 中文 café 👩‍💻.\n\n".repeat(20)
      const markdown = new MarkdownRenderable(renderer, {
        width: "100%",
        content,
        streaming: true,
        syntaxStyle: style,
        treeSitterClient: client,
      })
      scroll.add(markdown)
      renderer.root.add(scroll)
      mutate = (tick) => {
        content +=
          `\n\nSTREAM-${tick} 中文 café 👩‍💻 **response** with inline \`code\`.\n\n` +
          `\`\`\`typescript\nconst streamed${tick} = "中文"\n\`\`\`\n`
        markdown.content = content
      }
      verify = (tick) =>
        assert.ok(setup.captureCharFrame().includes(`STREAM-${tick} `), "Latest Markdown chunk was not painted")
      detail = {
        initialParagraphs: 20,
        chunk: "paragraph plus TypeScript fence",
        parser: "real bundled Tree-sitter WASM",
      }
    } else if (workload === "scroll-history") {
      const items = Array.from({ length: 10000 }, (_, id) => ({
        id,
        text: `MESSAGE-${id} 中文 café 👩‍💻 ${"response ".repeat(id % 12)}`,
      }))
      const list = new VirtualListRenderable(renderer, {
        width: "100%",
        height: "100%",
        items,
        getKey: (item) => item.id,
        estimateHeight: 2,
        renderItem: (item, _index, context) =>
          new TextRenderable(context, { width: "100%", content: item.text, wrapMode: "word" }),
      })
      renderer.root.add(list)
      const target = (tick: number) => 1000 + ((tick * 7919) % 8000)
      mutate = (tick) => list.scrollToIndex(target(tick))
      verify = (tick) => {
        assert.ok(setup.captureCharFrame().includes(`MESSAGE-${target(tick)} `), "Target history row was not painted")
        assert.ok(list.mountedCount <= renderer.height + 12, "History mounting exceeded viewport bound")
      }
      detail = { messages: items.length, variableHeight: true, targetSequence: "1000 + tick * 7919 % 8000" }
    } else if (workload === "resize-text") {
      const text = new TextRenderable(renderer, { width: "100%", height: "100%", wrapMode: "word" })
      renderer.root.add(text)
      const sizes = [
        [80, 24],
        [120, 40],
        [160, 50],
      ] as const
      mutate = (tick) => {
        const [width, height] = sizes[tick % sizes.length]
        setup.resize(width, height)
        text.content =
          `RESIZE-${tick} 中文 café 👩‍💻\n` + "A long line with mixed Unicode 中文 and wrapping text. ".repeat(100)
      }
      verify = (tick) => {
        assert.equal(renderer.width, sizes[tick % sizes.length][0])
        assert.equal(renderer.height, sizes[tick % sizes.length][1])
        assert.ok(
          setup.captureCharFrame().includes(`RESIZE-${tick} 中文 café 👩‍💻`),
          "Resized Unicode header was not painted",
        )
      }
      detail = { geometries: sizes, wrapMode: "word" }
    } else {
      const body = Array.from(
        { length: 2000 },
        (_, i) => `export const value${i} = { id: ${i}, text: "中文 café 👩‍💻" }`,
      ).join("\n")
      const code = new CodeRenderable(renderer, {
        width: "100%",
        height: "100%",
        filetype: "typescript",
        syntaxStyle: style,
        treeSitterClient: client,
        content: `// CODE-initial\n${body}`,
        conceal: false,
      })
      renderer.root.add(code)
      mutate = (tick) => {
        code.content = `// CODE-${tick} 中文 café 👩‍💻\n${body}\n// END-${tick}`
      }
      verify = (tick) => {
        assert.ok(setup.captureCharFrame().includes(`CODE-${tick} 中文 café 👩‍💻`), "Updated code was not painted")
        assert.ok(code.content.endsWith(`END-${tick}`))
        assert.ok(highlightCount > 0, "Code workload did not produce syntax highlights")
      }
      detail = { lines: 2002, parser: "real bundled Tree-sitter WASM", mutation: "replace full content" }
    }
    await settle()
    for (let tick = 0; tick < warmup; tick++) {
      mutate(tick)
      await settle()
      verify(tick)
    }
    const coldSetupAndWarmupMs = performance.now() - coldStart
    const memoryBefore = process.memoryUsage()
    const samples = []
    for (let tick = warmup; tick < warmup + iterations; tick++) {
      rootRenderMs =
        nativeDiffMs =
        nativeOutputMs =
        frames =
        cellsUpdated =
        highlightRequests =
        highlightRequestMs =
        styledTextMs =
        styledChunks =
          0
      const bytesBefore = outputBytes
      const cpuBefore = process.cpuUsage()
      const utilization = performance.eventLoopUtilization()
      const start = performance.now()
      measuring = true
      mutate(tick)
      const mutationMs = performance.now() - start
      await settle()
      const elapsedMs = performance.now() - start
      measuring = false
      const cpu = process.cpuUsage(cpuBefore)
      const eventLoopUtilization = performance.eventLoopUtilization(utilization).utilization
      assert.ok(frames > 0, "Operation did not produce a completed frame")
      // Assertions and screen capture stay outside the timed operation.
      verify(tick)
      assert.deepEqual(parserFailures, [], "Bundled syntax parsing failed")
      samples.push({
        tick,
        elapsedMs,
        mutationMs,
        rootRenderMs,
        nativeDiffMs,
        nativeOutputMs,
        frames,
        cellsUpdated,
        outputBytes: outputBytes - bytesBefore,
        highlightRequests,
        highlightRequestMs,
        styledTextMs,
        styledChunks,
        cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000,
        eventLoopUtilization,
      })
    }
    return {
      workload,
      detail,
      iterations,
      warmup,
      coldSetupAndWarmupMs,
      samples,
      elapsedMs: distribution(samples.map((sample) => sample.elapsedMs)),
      memoryBefore,
      memoryAfter: process.memoryUsage(),
    }
  } finally {
    measuring = false
    lib.textBufferSetStyledText = setStyledText
    renderer.destroy()
    await client.destroy()
    style.destroy()
    stdout.destroy()
    rmSync(cache, { recursive: true, force: true })
    assert.equal(Renderable.renderablesByNumber.size, 0, "Workload retained renderables")
  }
}

export async function applicationBenchmarkSample(iterations: number, warmup: number) {
  const results = []
  for (const workload of applicationWorkloads)
    results.push(await measureApplicationWorkload(workload, iterations, warmup))
  return { node: process.version, results }
}

type Sample = Awaited<ReturnType<typeof applicationBenchmarkSample>>

async function main() {
  const options = benchmarkOptions(process.argv.slice(2), {
    output: join(tuiRoot, ".internal/benchmarks/application.json"),
    iterations: 40,
    warmup: 8,
  })
  if (options.child) {
    console.log(JSON.stringify(await applicationBenchmarkSample(options.iterations, options.warmup)))
    return
  }
  const runs: Sample[] = []
  const profiles: string[] = []
  for (let sample = 0; sample < options.samples; sample++) {
    const profile = options.profile ? join(dirname(options.output), `application-profile-${sample + 1}`) : undefined
    if (profile) profiles.push(profile)
    runs.push(
      benchmarkChild<Sample>(
        fileURLToPath(import.meta.url),
        [`--iterations=${options.iterations}`, `--warmup=${options.warmup}`],
        true,
        profile,
      ),
    )
    process.stderr.write(`Completed application sample ${sample + 1}/${options.samples}\n`)
  }
  const summaries = applicationWorkloads.map((workload) => {
    const measured = runs.map((run) => run.results.find((result) => result.workload === workload)!)
    return {
      workload,
      medianOfRunMediansMs: distribution(measured.map((result) => result.elapsedMs.median)),
      allOperationsMs: distribution(measured.flatMap((result) => result.samples.map((sample) => sample.elapsedMs))),
    }
  })
  const report = {
    schemaVersion: 1,
    kind: "ax-tui-application-workloads",
    ...benchmarkProvenance([
      "script/benchmark-application.ts",
      "script/benchmark-support.ts",
      "script/build-text-width-experiment.ts",
    ]),
    options,
    output: "native span feed drained to counting Writable",
    initialGeometry: [120, 40],
    terminalEnvironment: { TERM: "xterm-256color", COLORTERM: "truecolor" },
    summaries,
    runs,
    profiles,
    limits: [
      "Single host and runtime; excludes real PTY, terminal emulator and SSH latency",
      "Imperative framework workloads; excludes Solid reconciliation and the full AX Code application",
      "Nested phase timings include instrumentation overhead and must not be added or subtracted to infer pure JS or FFI cost",
      "styledTextMs includes struct packing and native text/highlight construction, including work outside frame rendering",
      "Optional CPU profiling adds overhead; use unprofiled runs for timing comparisons",
      "highlightRequestMs includes worker scheduling, parsing, queries and message transfer; concurrent requests may overlap",
      "RSS and CPU are process-level, include workers and caches, and are not isolated allocation or leak measurements",
      "No WASM rendering arm; no whole-application FPS or statistical significance claim",
    ],
  }
  writeBenchmarkReport(options.output, report)
  console.log(JSON.stringify({ output: options.output, summaries }, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
