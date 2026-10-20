/** Browser-only inspector code, embedded under the per-launch CSP nonce. */
export const inspectorScript = String.raw`
const el = (id) => document.getElementById(id)
let lastScreen
let busy = false
let epoch = 0
let sequence = 0
let presented = 0
let pendingInputs = 0
let minimumFrame
let activeMutation
let previewFloor = 0
let previewSequence = 0
const receipts = []
function uncertain(result) {
  return result.status === "rejected" && ["timeout_unknown", "outcome_unknown", "internal_error"].includes(result.code)
}
function controls() {
  document.querySelectorAll("button").forEach((button) => { button.disabled = busy || !!activeMutation })
  el("click-submit").disabled = busy || !!activeMutation || pendingInputs > 0 || !lastScreen
}
function invalidate(message) {
  lastScreen = undefined
  previewFloor = sequence
  el("meta").textContent = "Stale preview · " + message
  controls()
}
function receipt(name, args, result) {
  const index = receipts.findIndex((item) => item.requestId === args.requestId)
  if (index >= 0 && receipts[index].status === "applied" && result.status !== "applied") {
    receipts[index] = { ...receipts[index], lastAttemptCode: result.code }
    el("receipts").textContent = JSON.stringify(receipts, null, 2)
    return
  }
  if (index >= 0) receipts.splice(index, 1)
  receipts.push({ tool: name, requestId: args.requestId, status: result.status, ...(result.code ? { code: result.code } : {}) })
  if (receipts.length > 8) receipts.shift()
  el("receipts").textContent = JSON.stringify(receipts, null, 2)
}
function show(result, requestSequence, requestEpoch, present, mutation = false) {
  if (requestEpoch !== epoch) return result
  if (result.status === "snapshot" && requestSequence >= previewFloor && pendingInputs === 0 &&
      (minimumFrame === undefined || result.screen.frameId > minimumFrame)) {
    if (!lastScreen || result.screen.frameId >= lastScreen.screen.frameId) {
      lastScreen = result
      previewSequence = Math.max(previewSequence, requestSequence)
      minimumFrame = undefined
      el("screen").textContent = result.screen.text
      el("meta").textContent = result.screen.width + " × " + result.screen.height +
        " · frame " + result.screen.frameId + " · focus " + (result.screen.focusedId ?? "none") +
        " · dialogs " + result.screen.modalDepth
      controls()
    }
  }
  if (present && requestSequence >= presented) {
    presented = requestSequence
    el("details").textContent = JSON.stringify(result, null, 2)
    el("status").textContent = result.status === "rejected"
      ? mutation && uncertain(result)
        ? "Input outcome unknown; reconcile before retrying. " + result.code
        : "Rejected: " + result.code
      : "Connected · " + result.status
  }
  return result
}
async function rpc(name, args = {}, present = true) {
  const requestSequence = ++sequence
  const requestEpoch = epoch
  const deadline = AbortSignal.timeout(15_000)
  try {
    const response = await fetch("/rpc", {
      method: "POST", headers: { "Content-Type": "application/json", "X-AX-TUI-Debug": boot.capability },
      body: JSON.stringify({ name, args }),
      signal: deadline,
    })
    let result
    try { result = await response.json() } catch {
      deadline.throwIfAborted()
      throw new Error("Inspector returned an invalid response (HTTP " + response.status + ")")
    }
    if (!response.ok) throw new Error("Inspector request failed: " + (result.code ?? "HTTP " + response.status))
    if (result.status === "rejected" && requestEpoch === epoch) invalidate(result.code)
    return show(result, requestSequence, requestEpoch, present, name === "tui_input" || name === "select_session")
  } catch (error) {
    if (requestEpoch === epoch) {
      // A failed older read cannot supersede a newer successfully observed screen.
      if (requestSequence >= previewSequence) invalidate(error.message)
      if (present && requestSequence >= presented) {
        presented = requestSequence
        el("status").textContent = error.message
      }
    }
    throw error
  }
}
function target(context) {
  return { instanceId: context.instanceId, generation: context.generation }
}
async function context() {
  const result = await rpc("get_view_context", {}, false)
  if (result.status !== "context") throw new Error("TUI unavailable: " + result.code)
  return result.context
}
async function refresh(present = true) {
  const ctx = await context()
  return rpc("get_tui_snapshot", target(ctx), present)
}
async function execute(name, args = {}) {
  if (name !== "tui_input" && name !== "select_session") return rpc(name, args)
  const signature = JSON.stringify({ name, args }, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value)
  if (activeMutation) {
    if (activeMutation.requestId === args.requestId && activeMutation.signature === signature) return activeMutation.promise
    const result = { status: "rejected", code: activeMutation.requestId === args.requestId ? "request_conflict" : "busy" }
    receipt(name, args, result)
    return show(result, ++sequence, epoch, true)
  }
  const operation = { requestId: args.requestId, signature, promise: undefined }
  activeMutation = operation
  controls()
  operation.promise = Promise.resolve().then(() => mutate(name, args)).finally(() => {
    if (activeMutation === operation) activeMutation = undefined
    controls()
  })
  return operation.promise
}
async function mutate(name, args) {
  // A displayed frame can predate unrelated native rendering. Sample immediately before dispatch.
  // Sampling aids visual confirmation; the native controller remains the mutation authority.
  // A rejected sample must not replace reconciliation of a cached mutation receipt.
  const previousMinimum = minimumFrame
  const baseline = await rpc("get_tui_snapshot", target(args), false)
  const before = baseline.status === "snapshot" ? baseline.screen.frameId : undefined
  const ownEpoch = ++epoch
  minimumFrame = before === undefined ? previousMinimum : Math.max(previousMinimum ?? before, before)
  pendingInputs++
  invalidate("input dispatch in progress")
  let result
  try {
    result = await rpc(name, args)
    receipt(name, args, result)
  } catch (error) {
    receipt(name, args, { status: "rejected", code: "outcome_unknown" })
    const message = "Input outcome unknown; reconcile before retrying. " + error.message
    if (ownEpoch === epoch) el("status").textContent = message
    throw new Error(message)
  } finally {
    pendingInputs--
    controls()
  }
  // A confirmed refusal emits no input frame. Retain only an older unresolved paint fence.
  if (result.status === "rejected" && !uncertain(result) && ownEpoch === epoch) minimumFrame = previousMinimum
  if (result.status === "applied" && ownEpoch === epoch) {
    try {
      if (before === undefined) throw new Error("No pre-input frame is available")
      // A cached receipt (or already-selected route) produces no new mutation revision/frame.
      if (baseline.status === "snapshot" && result.context.revision <= baseline.context.revision) {
        minimumFrame = previousMinimum
        const current = await rpc("get_tui_snapshot", target(args), false)
        if (current.status !== "snapshot") throw new Error(current.code)
        if (previousMinimum !== undefined && current.screen.frameId <= previousMinimum) throw new Error("A newer frame was not observed")
        return result
      }
      const observed = await rpc("wait_for_tui", { ...target(args), afterFrameId: before, timeoutMs: 2000 }, false)
      if (observed.status !== "snapshot") throw new Error(observed.code)
      if (observed.screen.frameId <= before) throw new Error("A newer frame was not observed")
    } catch (error) {
      if (ownEpoch === epoch) el("status").textContent = "Input applied; preview unavailable. Do not repeat blindly. " + error.message
    }
  }
  return result
}
async function action(value) {
  const ctx = await context()
  return execute("tui_input", { ...target(ctx), expectedRevision: ctx.revision, requestId: crypto.randomUUID(), action: value })
}
async function run(fn) {
  if (busy) return
  busy = true
  controls()
  try {
    await fn()
  } catch (error) {
    el("status").textContent = error.message
  } finally {
    busy = false
    controls()
  }
}
el("refresh").onclick = () => run(() => refresh())
for (const id of ["keys", "paste", "resize", "click", "wait"])
  el(id).onsubmit = (event) => {
    event.preventDefault()
    run(async () => {
      if (id === "keys")
        return action({
          kind: "key",
          key: el("key").value,
          ctrl: el("ctrl").checked,
          shift: el("shift").checked,
          meta: el("metaKey").checked,
        })
      if (id === "paste") return action({ kind: "paste", text: el("text").value })
      if (id === "resize")
        return action({ kind: "resize", width: Number(el("cols").value), height: Number(el("rows").value) })
      if (id === "click") {
        if (!lastScreen) throw new Error("Refresh the screen before clicking")
        return action({
          kind: "click",
          x: Number(el("x").value),
          y: Number(el("y").value),
          expectedFrameId: lastScreen.screen.frameId,
        })
      }
      const ctx = await context()
      return rpc("wait_for_tui", { ...target(ctx), text: el("condition").value, timeoutMs: 3000 })
    })
  }
setInterval(() => {
  if (el("live").checked && !busy && !activeMutation && pendingInputs === 0) void run(() => refresh(false))
}, 500)
const modelContext = document.modelContext ?? navigator.modelContext
if (modelContext && typeof modelContext.registerTool === "function") {
  ;(async () => {
    for (const tool of boot.tools)
      await modelContext.registerTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint === true,
          consequentialHint: tool.annotations?.readOnlyHint !== true,
          untrustedContentHint: tool.name === "get_tui_snapshot" || tool.name === "wait_for_tui",
        },
        execute: async (args) => JSON.stringify(await execute(tool.name, args)),
      })
    el("webmcp").textContent = "WebMCP ready · " + boot.tools.length + " native TUI tools"
  })().catch(() => {
    el("webmcp").textContent = "WebMCP registration failed; manual controls remain available."
  })
} else
  el("webmcp").textContent = "WebMCP unavailable in this browser. Manual controls and MCP/SDK access remain available."
controls()
void run(() => refresh())
`
