import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  AX_CODE_GRPC_METHOD_DESCRIPTORS,
  AX_CODE_GRPC_METHOD,
  AX_CODE_GRPC_PROTO_PACKAGE_PATH,
  AX_CODE_GRPC_PROTO_PATH,
  assertAxCodeGrpcMethodSupported,
  assertAxCodeGrpcNativeHandlers,
  createAxCodeGrpcClient,
  createAxCodeGrpcClientFromHttp,
  createAxCodeGrpcClientFromNativeBridge,
  createAxCodeGrpcClientFromNativeHandlers,
  createAxCodeGrpcClientFromNativeIpc,
  createAxCodeGrpcHttpBridge,
  createAxCodeGrpcNativeBridgeFromHandlers,
  createAxCodeGrpcNativeIpcBridgeFromChannels,
  createAxCodeGrpcNativeIpcStream,
  createAxCodeGrpcNativeIpcTransport,
  getAxCodeGrpcMethodDescriptor,
  listMissingAxCodeGrpcNativeHandlers,
  listAxCodeGrpcMethods,
  resolveAxCodeGrpcProtoUrl,
  type AxCodeGrpcTransport,
} from "../src/grpc"

describe("gRPC SDK facade", () => {
  test("exposes a stable headless service and proto path", () => {
    const packageJson = JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")) as {
      exports: Record<string, string>
    }

    expect(AX_CODE_GRPC_METHOD.SendRuntimeCommand).toBe("/axcode.v1.AxCodeHeadless/SendRuntimeCommand")
    expect(AX_CODE_GRPC_METHOD.LoadBootstrap).toBe("/axcode.v1.AxCodeHeadless/LoadBootstrap")
    expect(AX_CODE_GRPC_METHOD.SubscribeEvents).toBe("/axcode.v1.AxCodeHeadless/SubscribeEvents")
    expect(AX_CODE_GRPC_PROTO_PATH).toBe("ax_code/v1/headless.proto")
    expect(AX_CODE_GRPC_PROTO_PACKAGE_PATH).toBe("proto/ax_code/v1/headless.proto")
    expect(packageJson.exports["./proto/ax_code/v1/headless.proto"]).toBe("./dist/proto/ax_code/v1/headless.proto")
    expect(existsSync(resolveAxCodeGrpcProtoUrl().pathname)).toBe(true)
    expect(resolveAxCodeGrpcProtoUrl("file:///app/node_modules/@ax-code/sdk/dist/grpc.js").pathname).toBe(
      "/app/node_modules/@ax-code/sdk/dist/proto/ax_code/v1/headless.proto",
    )
  })

  test("describes every native transport method", () => {
    const methods = Object.values(AX_CODE_GRPC_METHOD)
    const describedMethods = AX_CODE_GRPC_METHOD_DESCRIPTORS.map((descriptor) => descriptor.method)

    expect(AX_CODE_GRPC_METHOD_DESCRIPTORS).toHaveLength(methods.length)
    expect(Object.isFrozen(AX_CODE_GRPC_METHOD_DESCRIPTORS)).toBe(true)
    expect(Object.isFrozen(AX_CODE_GRPC_METHOD_DESCRIPTORS[0])).toBe(true)
    expect(new Set(describedMethods).size).toBe(methods.length)
    expect(describedMethods.toSorted()).toEqual(methods.toSorted())
    expect(getAxCodeGrpcMethodDescriptor(AX_CODE_GRPC_METHOD.GetSession)).toMatchObject({
      name: "GetSession",
      kind: "unary",
      domain: "session",
      requestType: "SessionRequest",
      responseType: "JsonResponse",
      httpBridge: true,
      stability: "active",
    })
    expect(assertAxCodeGrpcMethodSupported(AX_CODE_GRPC_METHOD.SubscribeEvents, "serverStream")).toMatchObject({
      name: "SubscribeEvents",
      kind: "serverStream",
      domain: "events",
      requestType: "SubscribeEventsRequest",
      responseType: "RuntimeEvent",
    })
    expect(getAxCodeGrpcMethodDescriptor(AX_CODE_GRPC_METHOD.ConnectPty)).toMatchObject({
      name: "ConnectPty",
      kind: "bidiStream",
      domain: "pty",
      requestType: "PtyClientEvent",
      responseType: "PtyServerEvent",
    })
    expect(listAxCodeGrpcMethods({ domain: "mcp" }).map((descriptor) => descriptor.method)).toContain(
      AX_CODE_GRPC_METHOD.GetMcpStatus,
    )
    expect(listAxCodeGrpcMethods({ kind: "bidiStream" })).toEqual([
      expect.objectContaining({ method: AX_CODE_GRPC_METHOD.ConnectPty }),
    ])
    expect(() => assertAxCodeGrpcMethodSupported("/axcode.v1.AxCodeHeadless/Missing" as never)).toThrow(
      "Unsupported AX Code gRPC method",
    )
    expect(() => assertAxCodeGrpcMethodSupported(AX_CODE_GRPC_METHOD.Health, "serverStream")).toThrow(
      "is unary, not serverStream",
    )
  })

  test("method descriptors match the proto service message contract", () => {
    const proto = readFileSync(resolve(import.meta.dir, "../../proto/ax_code/v1/headless.proto"), "utf8")
    const rpcPattern = /rpc\s+(\w+)\((stream\s+)?(\w+)\)\s+returns\s+\((stream\s+)?(\w+)\)/g
    const rpcTypes = new Map<string, { kind: string; requestType: string; responseType: string }>()
    let match: RegExpExecArray | null

    while ((match = rpcPattern.exec(proto))) {
      const [, name, requestStream, requestType, responseStream, responseType] = match
      rpcTypes.set(name, {
        kind: requestStream && responseStream ? "bidiStream" : responseStream ? "serverStream" : "unary",
        requestType,
        responseType,
      })
    }

    expect(rpcTypes.size).toBe(AX_CODE_GRPC_METHOD_DESCRIPTORS.length)
    for (const descriptor of AX_CODE_GRPC_METHOD_DESCRIPTORS) {
      expect(rpcTypes.get(descriptor.name)).toEqual({
        kind: descriptor.kind,
        requestType: descriptor.requestType,
        responseType: descriptor.responseType,
      })
    }
  })

  test("high-level client unwraps unary value envelopes", async () => {
    const calls: Array<{ method: string; request: unknown }> = []
    const transport: AxCodeGrpcTransport = {
      async unary(method, request) {
        calls.push({ method, request })
        if (method === AX_CODE_GRPC_METHOD.Health) return { status: "SERVING", transport: "grpc" }
        if (method === AX_CODE_GRPC_METHOD.CreateSession) return { value: { id: "sess-1" } }
        if (method === AX_CODE_GRPC_METHOD.SendRuntimeCommand) return { accepted: true, status: 202 }
        if (method === AX_CODE_GRPC_METHOD.LoadBootstrap) return { value: { path: { root: "/repo" }, errors: [] } }
        if (method === AX_CODE_GRPC_METHOD.GetSession) return { value: { id: "sess-1", title: "GUI" } }
        if (method === AX_CODE_GRPC_METHOD.ListSessionMessages) return { value: [{ id: "msg-1" }] }
        if (method === AX_CODE_GRPC_METHOD.ListSkills) return { value: [{ id: "improve-security" }] }
        if (method === AX_CODE_GRPC_METHOD.WriteAppLog) return { value: true }
        if (method === AX_CODE_GRPC_METHOD.DisposeInstance) return { value: true }
        if (method === AX_CODE_GRPC_METHOD.RestartInstance) return { value: true }
        if (method === AX_CODE_GRPC_METHOD.GetPath) return { value: { root: "/repo" } }
        if (method === AX_CODE_GRPC_METHOD.GetVcs) return { value: { branch: "main" } }
        if (method === AX_CODE_GRPC_METHOD.ListCommands) return { value: [{ name: "init" }] }
        if (method === AX_CODE_GRPC_METHOD.GetProjectContext) return { value: { files: ["AGENTS.md"] } }
        if (method === AX_CODE_GRPC_METHOD.CreateProjectContextTemplate) return { value: { path: "AGENTS.md" } }
        if (method === AX_CODE_GRPC_METHOD.WarmupProjectMemory) return { value: { warmed: true } }
        if (method === AX_CODE_GRPC_METHOD.ClearProjectMemory) return { value: true }
        if (method === AX_CODE_GRPC_METHOD.GetDebugEnginePendingPlans) return { value: { count: 1, plans: [] } }
        if (method === AX_CODE_GRPC_METHOD.ReadFile) return { value: { content: "hello" } }
        if (method === AX_CODE_GRPC_METHOD.ListPermissions) return { value: [{ id: "perm-1" }] }
        if (method === AX_CODE_GRPC_METHOD.ReplyPermission) return { value: true }
        if (method === AX_CODE_GRPC_METHOD.ListQuestions) return { value: [{ id: "question-1" }] }
        if (method === AX_CODE_GRPC_METHOD.ReplyQuestion) return { value: true }
        if (method === AX_CODE_GRPC_METHOD.RejectQuestion) return { value: true }
        if (method === AX_CODE_GRPC_METHOD.GetAutonomousMode) return { value: { enabled: true } }
        if (method === AX_CODE_GRPC_METHOD.SetAutonomousMode) return { value: { enabled: false } }
        if (method === AX_CODE_GRPC_METHOD.GetIsolationMode)
          return { value: { mode: "workspace-write", network: false } }
        if (method === AX_CODE_GRPC_METHOD.SetIsolationMode) return { value: { mode: "read-only", network: false } }
        if (method === AX_CODE_GRPC_METHOD.GetSmartLlmRouting) return { value: { enabled: true } }
        if (method === AX_CODE_GRPC_METHOD.SetSmartLlmRouting) return { value: { enabled: false } }
        if (method === AX_CODE_GRPC_METHOD.GetMcpStatus) return { value: { playwright: { type: "connected" } } }
        if (method === AX_CODE_GRPC_METHOD.ListMcpResources) return { value: [{ uri: "file://README.md" }] }
        if (method === AX_CODE_GRPC_METHOD.AddMcpServer) return { value: { playwright: { type: "connected" } } }
        if (method === AX_CODE_GRPC_METHOD.StartMcpAuth) return { value: { authorizationUrl: "https://auth.example" } }
        if (method === AX_CODE_GRPC_METHOD.CompleteMcpAuth) return { value: { type: "connected" } }
        if (method === AX_CODE_GRPC_METHOD.AuthenticateMcp) return { value: { type: "connected" } }
        if (method === AX_CODE_GRPC_METHOD.RemoveMcpAuth) return { value: true }
        if (method === AX_CODE_GRPC_METHOD.ConnectMcp) return { value: true }
        if (method === AX_CODE_GRPC_METHOD.DisconnectMcp) return { value: true }
        if (method === AX_CODE_GRPC_METHOD.GetProviderAuth) return { value: { anthropic: [{ type: "api" }] } }
        if (method === AX_CODE_GRPC_METHOD.SetAuth) return { value: true }
        if (method === AX_CODE_GRPC_METHOD.GetLspStatus) return { value: { servers: [] } }
        if (method === AX_CODE_GRPC_METHOD.GetFormatterStatus) return { value: { enabled: true } }
        if (method === AX_CODE_GRPC_METHOD.CreatePty) return { value: { id: "pty_1", title: "Terminal" } }
        if (method === AX_CODE_GRPC_METHOD.TaskQueueCommand) return { value: { id: "task-1", status: "paused" } }
        if (method === AX_CODE_GRPC_METHOD.ListWorkflowRuns) return { value: [{ id: "run-1" }] }
        if (method === AX_CODE_GRPC_METHOD.GetWorkflowRun) return { value: { id: "run-1", status: "running" } }
        if (method === AX_CODE_GRPC_METHOD.WorkflowRunDashboard) return { value: [{ id: "run-1" }] }
        if (method === AX_CODE_GRPC_METHOD.WorkflowRunEvalCases) return { value: [{ id: "case-1" }] }
        if (method === AX_CODE_GRPC_METHOD.WorkflowRunEvalCase) return { value: { caseID: "case-1" } }
        if (method === AX_CODE_GRPC_METHOD.WorkflowRunCommand) return { value: { id: "run-1", status: "running" } }
        throw new Error(`unexpected method ${method}`)
      },
      async *serverStream() {
        yield { type: "server.connected", properties: {} }
      },
    }
    const client = createAxCodeGrpcClient({ transport })
    const { pause } = client.taskQueue

    expect(await client.health()).toEqual({ status: "SERVING", transport: "grpc" })
    expect(await client.createSession({ title: "GUI" })).toEqual({ id: "sess-1" })
    expect(await client.sendPrompt("sess-1", { parts: [{ type: "text", text: "hello" }] })).toEqual({
      accepted: true,
      status: 202,
    })
    expect(await client.bootstrap.load({ include: { path: true } })).toEqual({ path: { root: "/repo" }, errors: [] })
    expect(await client.session.get("sess-1")).toEqual({ id: "sess-1", title: "GUI" })
    expect(await client.session.messages("sess-1", { limit: 10 })).toEqual([{ id: "msg-1" }])
    expect(await client.app.skills()).toEqual([{ id: "improve-security" }])
    expect(await client.app.log({ service: "gui", level: "info", message: "ready" })).toBe(true)
    expect(await client.instance.dispose()).toBe(true)
    expect(await client.instance.restart()).toBe(true)
    expect(await client.path.get()).toEqual({ root: "/repo" })
    expect(await client.vcs.get()).toEqual({ branch: "main" })
    expect(await client.command.list()).toEqual([{ name: "init" }])
    expect(await client.context.get()).toEqual({ files: ["AGENTS.md"] })
    expect(await client.context.createTemplate("repo-rules")).toEqual({ path: "AGENTS.md" })
    expect(await client.context.memory.warmup()).toEqual({ warmed: true })
    expect(await client.context.memory.clear()).toBe(true)
    expect(await client.debugEngine.pendingPlans()).toEqual({ count: 1, plans: [] })
    expect(await client.file.read("README.md")).toEqual({ content: "hello" })
    expect(await client.permission.list()).toEqual([{ id: "perm-1" }])
    expect(await client.permission.reply("perm-1", { reply: "once" })).toBe(true)
    expect(await client.question.list()).toEqual([{ id: "question-1" }])
    expect(await client.question.reply("question-1", { answers: [{ label: "Yes" }] })).toBe(true)
    expect(await client.question.reject("question-1")).toBe(true)
    expect(await client.runtime.autonomous.get()).toEqual({ enabled: true })
    expect(await client.runtime.autonomous.set(false)).toEqual({ enabled: false })
    expect(await client.runtime.isolation.get()).toEqual({ mode: "workspace-write", network: false })
    expect(await client.runtime.isolation.set("read-only")).toEqual({ mode: "read-only", network: false })
    expect(await client.runtime.smartLlm.get()).toEqual({ enabled: true })
    expect(await client.runtime.smartLlm.set(false)).toEqual({ enabled: false })
    expect(await client.mcp.status()).toEqual({ playwright: { type: "connected" } })
    expect(await client.mcp.resources()).toEqual([{ uri: "file://README.md" }])
    expect(await client.mcp.add("playwright", { type: "local", command: ["npx", "playwright"] } as never)).toEqual({
      playwright: { type: "connected" },
    })
    expect(await client.mcp.auth.start("playwright")).toEqual({ authorizationUrl: "https://auth.example" })
    expect(await client.mcp.auth.callback("playwright", "abc")).toEqual({ type: "connected" })
    expect(await client.mcp.auth.authenticate("playwright")).toEqual({ type: "connected" })
    expect(await client.mcp.auth.remove("playwright")).toBe(true)
    expect(await client.mcp.connect("playwright")).toBe(true)
    expect(await client.mcp.disconnect("playwright")).toBe(true)
    expect(await client.provider.auth()).toEqual({ anthropic: [{ type: "api" }] })
    expect(await client.auth.set("anthropic", { type: "api", key: "secret" })).toBe(true)
    expect(await client.lsp.status()).toEqual({ servers: [] })
    expect(await client.formatter.status()).toEqual({ enabled: true })
    expect(await client.pty.create({ title: "Terminal" })).toEqual({ id: "pty_1", title: "Terminal" })
    expect(await pause("task-1")).toEqual({ id: "task-1", status: "paused" })
    expect(await client.workflowRun.list({ status: "running", limit: 5 })).toEqual([{ id: "run-1" }])
    expect(await client.workflowRun.get("run-1")).toEqual({ id: "run-1", status: "running" })
    expect(await client.workflowRun.dashboard({ limit: 5 })).toEqual([{ id: "run-1" }])
    expect(await client.workflowRun.evalCases()).toEqual([{ id: "case-1" }])
    expect(await client.workflowRun.evalCase("run-1", { caseID: "case-1" })).toEqual({ caseID: "case-1" })
    expect(await client.workflowRun.retry("run-1", { phaseID: "phase-1" })).toEqual({ id: "run-1", status: "running" })
    expect(calls.map((call) => call.method)).toEqual([
      AX_CODE_GRPC_METHOD.Health,
      AX_CODE_GRPC_METHOD.CreateSession,
      AX_CODE_GRPC_METHOD.SendRuntimeCommand,
      AX_CODE_GRPC_METHOD.LoadBootstrap,
      AX_CODE_GRPC_METHOD.GetSession,
      AX_CODE_GRPC_METHOD.ListSessionMessages,
      AX_CODE_GRPC_METHOD.ListSkills,
      AX_CODE_GRPC_METHOD.WriteAppLog,
      AX_CODE_GRPC_METHOD.DisposeInstance,
      AX_CODE_GRPC_METHOD.RestartInstance,
      AX_CODE_GRPC_METHOD.GetPath,
      AX_CODE_GRPC_METHOD.GetVcs,
      AX_CODE_GRPC_METHOD.ListCommands,
      AX_CODE_GRPC_METHOD.GetProjectContext,
      AX_CODE_GRPC_METHOD.CreateProjectContextTemplate,
      AX_CODE_GRPC_METHOD.WarmupProjectMemory,
      AX_CODE_GRPC_METHOD.ClearProjectMemory,
      AX_CODE_GRPC_METHOD.GetDebugEnginePendingPlans,
      AX_CODE_GRPC_METHOD.ReadFile,
      AX_CODE_GRPC_METHOD.ListPermissions,
      AX_CODE_GRPC_METHOD.ReplyPermission,
      AX_CODE_GRPC_METHOD.ListQuestions,
      AX_CODE_GRPC_METHOD.ReplyQuestion,
      AX_CODE_GRPC_METHOD.RejectQuestion,
      AX_CODE_GRPC_METHOD.GetAutonomousMode,
      AX_CODE_GRPC_METHOD.SetAutonomousMode,
      AX_CODE_GRPC_METHOD.GetIsolationMode,
      AX_CODE_GRPC_METHOD.SetIsolationMode,
      AX_CODE_GRPC_METHOD.GetSmartLlmRouting,
      AX_CODE_GRPC_METHOD.SetSmartLlmRouting,
      AX_CODE_GRPC_METHOD.GetMcpStatus,
      AX_CODE_GRPC_METHOD.ListMcpResources,
      AX_CODE_GRPC_METHOD.AddMcpServer,
      AX_CODE_GRPC_METHOD.StartMcpAuth,
      AX_CODE_GRPC_METHOD.CompleteMcpAuth,
      AX_CODE_GRPC_METHOD.AuthenticateMcp,
      AX_CODE_GRPC_METHOD.RemoveMcpAuth,
      AX_CODE_GRPC_METHOD.ConnectMcp,
      AX_CODE_GRPC_METHOD.DisconnectMcp,
      AX_CODE_GRPC_METHOD.GetProviderAuth,
      AX_CODE_GRPC_METHOD.SetAuth,
      AX_CODE_GRPC_METHOD.GetLspStatus,
      AX_CODE_GRPC_METHOD.GetFormatterStatus,
      AX_CODE_GRPC_METHOD.CreatePty,
      AX_CODE_GRPC_METHOD.TaskQueueCommand,
      AX_CODE_GRPC_METHOD.ListWorkflowRuns,
      AX_CODE_GRPC_METHOD.GetWorkflowRun,
      AX_CODE_GRPC_METHOD.WorkflowRunDashboard,
      AX_CODE_GRPC_METHOD.WorkflowRunEvalCases,
      AX_CODE_GRPC_METHOD.WorkflowRunEvalCase,
      AX_CODE_GRPC_METHOD.WorkflowRunCommand,
    ])
    expect(calls.at(-1)?.request).toEqual({
      runID: "run-1",
      command: "retry",
      body: { phaseID: "phase-1" },
    })
    expect(calls.find((call) => call.method === AX_CODE_GRPC_METHOD.ListWorkflowRuns)?.request).toEqual({
      parameters: { status: "running", limit: 5 },
    })
    expect(calls.find((call) => call.method === AX_CODE_GRPC_METHOD.GetWorkflowRun)?.request).toEqual({
      runID: "run-1",
    })
  })

  test("high-level client exposes PTY bidirectional streaming", async () => {
    const seen: unknown[] = []
    const transport: AxCodeGrpcTransport = {
      async unary() {
        throw new Error("unary should not be called")
      },
      async *serverStream() {},
      async *bidiStream(method, request, input) {
        seen.push({ method, request })
        for await (const frame of input) seen.push(frame)
        yield { type: "output", data: "ready" }
      },
    }
    const client = createAxCodeGrpcClient({ transport })
    const frames = async function* () {
      yield { type: "input" as const, data: "pwd\n" }
      yield { type: "resize" as const, cols: 120, rows: 30 }
    }
    const events = []

    for await (const event of client.pty.connect("pty_1", frames(), { cursor: 42 })) events.push(event)

    expect(events).toEqual([{ type: "output", data: "ready" }])
    expect(seen).toEqual([
      { method: AX_CODE_GRPC_METHOD.ConnectPty, request: { id: "pty_1", cursor: 42 } },
      { type: "input", data: "pwd\n" },
      { type: "resize", cols: 120, rows: 30 },
    ])
  })

  test("high-level client forwards event subscription filters and keeps legacy options", async () => {
    const calls: unknown[] = []
    const transport: AxCodeGrpcTransport = {
      async unary() {
        throw new Error("unary should not be called")
      },
      async *serverStream(method, request, options) {
        calls.push({ method, request, options })
        yield { type: "server.connected", properties: {} }
      },
    }
    const client = createAxCodeGrpcClient({ transport })

    for await (const _event of client.subscribeEvents(
      { types: ["session.status"], sessionID: "sess-1" },
      { metadata: { "x-native-host": "tauri" } },
    )) {
      break
    }
    for await (const _event of client.subscribeEvents({ metadata: { "x-legacy-options": "true" } })) {
      break
    }

    expect(calls).toEqual([
      {
        method: AX_CODE_GRPC_METHOD.SubscribeEvents,
        request: { types: ["session.status"], sessionID: "sess-1" },
        options: { metadata: { "x-native-host": "tauri" } },
      },
      {
        method: AX_CODE_GRPC_METHOD.SubscribeEvents,
        request: {},
        options: { metadata: { "x-legacy-options": "true" } },
      },
    ])
  })

  test("native bridge adapter carries metadata and streaming calls without HTTP", async () => {
    const calls: unknown[] = []
    const client = createAxCodeGrpcClientFromNativeBridge({
      async unary(call) {
        calls.push(call)
        return { value: { id: "sess-1" } }
      },
      async *serverStream(call) {
        calls.push(call)
        yield { type: "server.connected", properties: {} }
      },
      async *bidiStream(call) {
        calls.push({ ...call, input: "captured" })
        for await (const frame of call.input) calls.push(frame)
        yield { type: "output", data: "ready" }
      },
    })
    const abort = new AbortController()

    await expect(
      client.session.get("sess-1", {
        metadata: { "x-native-host": "tauri" },
        signal: abort.signal,
        timeoutMs: 250,
      }),
    ).resolves.toEqual({ id: "sess-1" })

    const events = []
    for await (const event of client.subscribeEvents({ metadata: { "x-native-host": "tauri" } })) events.push(event)
    for await (const event of client.pty.connect("pty_1", asyncFrames("pwd\n"), { cursor: 4 })) events.push(event)

    expect(events).toEqual([
      { type: "server.connected", properties: {} },
      { type: "output", data: "ready" },
    ])
    expect(calls).toEqual([
      {
        method: AX_CODE_GRPC_METHOD.GetSession,
        request: { sessionID: "sess-1" },
        metadata: { "x-native-host": "tauri" },
        signal: abort.signal,
        timeoutMs: 250,
      },
      {
        method: AX_CODE_GRPC_METHOD.SubscribeEvents,
        request: {},
        metadata: { "x-native-host": "tauri" },
        signal: undefined,
        timeoutMs: undefined,
      },
      {
        method: AX_CODE_GRPC_METHOD.ConnectPty,
        request: { id: "pty_1", cursor: 4 },
        input: "captured",
        metadata: undefined,
        signal: undefined,
        timeoutMs: undefined,
      },
      "pwd\n",
    ])
  })

  test("native IPC bridge uses structured-clone friendly calls", async () => {
    const calls: unknown[] = []
    const client = createAxCodeGrpcClientFromNativeIpc({
      async unary(call) {
        calls.push(call)
        return { value: { id: "sess-1" } }
      },
      async *serverStream(call) {
        calls.push(call)
        yield { type: "server.connected", properties: {} }
      },
      async *bidiStream(call, input) {
        calls.push(call)
        for await (const frame of input) calls.push(frame)
        yield { type: "output", data: "ready" }
      },
    })
    const abort = new AbortController()
    const events = []

    await expect(
      client.session.get("sess-1", {
        metadata: { "x-native-host": "tauri" },
        signal: abort.signal,
        timeoutMs: 250,
      }),
    ).resolves.toEqual({ id: "sess-1" })
    for await (const event of client.subscribeEvents({ metadata: { "x-native-host": "tauri" } })) events.push(event)
    for await (const event of client.pty.connect("pty_1", asyncFrames({ type: "input" as const, data: "pwd\n" }))) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: "server.connected", properties: {} },
      { type: "output", data: "ready" },
    ])
    expect(calls).toEqual([
      {
        method: AX_CODE_GRPC_METHOD.GetSession,
        request: { sessionID: "sess-1" },
        metadata: { "x-native-host": "tauri" },
        timeoutMs: 250,
      },
      {
        method: AX_CODE_GRPC_METHOD.SubscribeEvents,
        request: {},
        metadata: { "x-native-host": "tauri" },
        timeoutMs: undefined,
      },
      {
        method: AX_CODE_GRPC_METHOD.ConnectPty,
        request: { id: "pty_1", cursor: undefined },
        metadata: undefined,
        timeoutMs: undefined,
      },
      { type: "input", data: "pwd\n" },
    ])
  })

  test("native IPC bridge reports missing stream support clearly", () => {
    const transport = createAxCodeGrpcNativeIpcTransport({
      async unary() {
        return {}
      },
    })

    expect(() => transport.serverStream(AX_CODE_GRPC_METHOD.SubscribeEvents, {})).toThrow(
      "AX Code native IPC bridge does not support server streaming",
    )
    expect(() => transport.bidiStream?.(AX_CODE_GRPC_METHOD.ConnectPty, { id: "pty_1" }, asyncFrames())).toThrow(
      "AX Code native IPC bridge does not support bidirectional streaming",
    )
  })

  test("native IPC channel bridge adapts push streams", async () => {
    const calls: unknown[] = []
    const client = createAxCodeGrpcClientFromNativeIpc(
      createAxCodeGrpcNativeIpcBridgeFromChannels({
        async unary(call) {
          calls.push(call)
          return { value: { id: "sess-1" } }
        },
        serverStream(call, controller) {
          calls.push(call)
          controller.push({ type: "server.connected", properties: {} })
          controller.close()
        },
        bidiStream(call, input, controller) {
          calls.push(call)
          void (async () => {
            for await (const frame of input) calls.push(frame)
            controller.push({ type: "output", data: "ready" })
            controller.close()
          })()
        },
      }),
    )
    const events = []

    await expect(client.session.get("sess-1")).resolves.toEqual({ id: "sess-1" })
    for await (const event of client.subscribeEvents()) events.push(event)
    for await (const event of client.pty.connect("pty_1", asyncFrames("pwd\n"))) events.push(event)

    expect(events).toEqual([
      { type: "server.connected", properties: {} },
      { type: "output", data: "ready" },
    ])
    expect(calls).toEqual([
      {
        method: AX_CODE_GRPC_METHOD.GetSession,
        request: { sessionID: "sess-1" },
        metadata: undefined,
        timeoutMs: undefined,
      },
      { method: AX_CODE_GRPC_METHOD.SubscribeEvents, request: {}, metadata: undefined, timeoutMs: undefined },
      {
        method: AX_CODE_GRPC_METHOD.ConnectPty,
        request: { id: "pty_1", cursor: undefined },
        metadata: undefined,
        timeoutMs: undefined,
      },
      "pwd\n",
    ])
  })

  test("native IPC stream helper cleans up subscriptions on early return", async () => {
    const events: string[] = []
    const stream = createAxCodeGrpcNativeIpcStream<string>((controller) => {
      events.push("subscribed")
      controller.push("ready")
      return () => events.push("unsubscribed")
    })

    for await (const value of stream) {
      events.push(value)
      break
    }

    expect(events).toEqual(["subscribed", "ready", "unsubscribed"])
  })

  test("native IPC stream helper cleans up subscriptions after natural close", async () => {
    const events: string[] = []
    const stream = createAxCodeGrpcNativeIpcStream<string>((controller) => {
      events.push("subscribed")
      controller.push("ready")
      controller.close()
      return () => events.push("unsubscribed")
    })

    for await (const value of stream) events.push(value)

    expect(events).toEqual(["subscribed", "ready", "unsubscribed"])
  })

  test("native handler map can back a renderer client without HTTP dispatch glue", async () => {
    const calls: unknown[] = []
    const client = createAxCodeGrpcClientFromNativeHandlers({
      unary: {
        [AX_CODE_GRPC_METHOD.GetSession](request, context) {
          calls.push({ request, context })
          return {
            value: {
              id: (request as { sessionID: string }).sessionID,
              host: context.metadata?.["x-native-host"],
            },
          }
        },
      },
      serverStream: {
        async *[AX_CODE_GRPC_METHOD.SubscribeEvents](_request, context) {
          calls.push({ stream: context.method, metadata: context.metadata })
          yield { type: "server.connected", properties: { host: context.metadata?.["x-native-host"] } }
        },
      },
      bidiStream: {
        async *[AX_CODE_GRPC_METHOD.ConnectPty](request, input, context) {
          calls.push({ request, method: context.method })
          for await (const frame of input) calls.push(frame)
          yield { type: "output", data: "ready" }
        },
      },
    })

    await expect(client.session.get("sess-1", { metadata: { "x-native-host": "tauri" } })).resolves.toEqual({
      id: "sess-1",
      host: "tauri",
    })

    const events = []
    for await (const event of client.subscribeEvents({ metadata: { "x-native-host": "tauri" } })) events.push(event)
    for await (const event of client.pty.connect("pty_1", asyncFrames({ type: "input" as const, data: "pwd\n" }))) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: "server.connected", properties: { host: "tauri" } },
      { type: "output", data: "ready" },
    ])
    expect(calls).toEqual([
      {
        request: { sessionID: "sess-1" },
        context: {
          method: AX_CODE_GRPC_METHOD.GetSession,
          metadata: { "x-native-host": "tauri" },
          signal: undefined,
          timeoutMs: undefined,
        },
      },
      {
        stream: AX_CODE_GRPC_METHOD.SubscribeEvents,
        metadata: { "x-native-host": "tauri" },
      },
      {
        request: { id: "pty_1", cursor: undefined },
        method: AX_CODE_GRPC_METHOD.ConnectPty,
      },
      { type: "input", data: "pwd\n" },
    ])
  })

  test("native handler coverage can fail fast before renderer handoff", () => {
    const handlers = {
      unary: {
        [AX_CODE_GRPC_METHOD.GetSession]() {
          return { value: { id: "sess-1" } }
        },
        [AX_CODE_GRPC_METHOD.GetMcpStatus]() {
          return { value: {} }
        },
      },
      serverStream: {
        async *[AX_CODE_GRPC_METHOD.SubscribeEvents]() {
          yield { type: "server.connected", properties: {} }
        },
      },
    }

    expect(listMissingAxCodeGrpcNativeHandlers(handlers, { methods: [AX_CODE_GRPC_METHOD.GetSession] })).toEqual([])
    expect(
      listMissingAxCodeGrpcNativeHandlers(handlers, { domain: "mcp" }).map((descriptor) => descriptor.name),
    ).toEqual([
      "ListMcpResources",
      "AddMcpServer",
      "StartMcpAuth",
      "CompleteMcpAuth",
      "AuthenticateMcp",
      "RemoveMcpAuth",
      "ConnectMcp",
      "DisconnectMcp",
    ])
    expect(listMissingAxCodeGrpcNativeHandlers(handlers, { kind: "serverStream" })).toEqual([])
    expect(listMissingAxCodeGrpcNativeHandlers(handlers, { kind: "bidiStream" })).toEqual([
      expect.objectContaining({ name: "ConnectPty", kind: "bidiStream" }),
    ])
    expect(() => assertAxCodeGrpcNativeHandlers(handlers, { kind: "bidiStream" })).toThrow(
      "Missing AX Code gRPC native handlers: ConnectPty(bidiStream)",
    )
    expect(() =>
      assertAxCodeGrpcNativeHandlers(handlers, {
        methods: [AX_CODE_GRPC_METHOD.GetSession, AX_CODE_GRPC_METHOD.SubscribeEvents],
      }),
    ).not.toThrow()
    expect(() =>
      createAxCodeGrpcNativeBridgeFromHandlers(handlers, {
        requireHandlers: { methods: [AX_CODE_GRPC_METHOD.GetSession, AX_CODE_GRPC_METHOD.SubscribeEvents] },
      }),
    ).not.toThrow()
    expect(() =>
      createAxCodeGrpcClientFromNativeHandlers(handlers, {
        requireHandlers: { methods: [AX_CODE_GRPC_METHOD.ConnectPty] },
      }),
    ).toThrow("Missing AX Code gRPC native handlers: ConnectPty(bidiStream)")
  })

  test("native handler map reports missing methods clearly", async () => {
    const bridge = createAxCodeGrpcNativeBridgeFromHandlers({})

    await expect(
      bridge.unary({ method: AX_CODE_GRPC_METHOD.GetSession, request: { sessionID: "sess-1" } }),
    ).rejects.toThrow("Unsupported AX Code gRPC unary method: /axcode.v1.AxCodeHeadless/GetSession")
    expect(() => bridge.serverStream?.({ method: AX_CODE_GRPC_METHOD.SubscribeEvents, request: {} })).toThrow(
      "Unsupported AX Code gRPC server stream method: /axcode.v1.AxCodeHeadless/SubscribeEvents",
    )
    expect(() =>
      bridge.bidiStream?.({ method: AX_CODE_GRPC_METHOD.ConnectPty, request: { id: "pty_1" }, input: asyncFrames() }),
    ).toThrow("Unsupported AX Code gRPC bidirectional stream method: /axcode.v1.AxCodeHeadless/ConnectPty")
  })

  test("HTTP bridge maps gRPC-style session commands to the headless backend", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      headers: { Authorization: "Basic base" },
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        calls.push({ url: request.url, init: request })
        const pathname = new URL(request.url).pathname
        if (pathname === "/session") return Response.json({ id: "sess-1" })
        if (pathname === "/session/sess-1/prompt_async") return new Response("", { status: 202 })
        return Response.json(true)
      }) as typeof fetch,
    })

    await client.createSession({ title: "GUI" }, { metadata: { "x-ax-code-gui": "desktop" } })
    await client.sendPrompt("sess-1", { parts: [{ type: "text", text: "hello" }] })

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/session", "/session/sess-1/prompt_async"])
    expect(headerValue(calls[0].init.headers, "authorization")).toBe("Basic base")
    expect(headerValue(calls[0].init.headers, "x-ax-code-gui")).toBe("desktop")
    expect(await new Response(calls[1].init.body).text()).toBe(
      JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
    )
  })

  test("HTTP bridge maps session history calls to the headless backend", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push({
          path: `${parsed.pathname}${parsed.search}`,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        if (parsed.pathname === "/session") return Response.json([{ id: "sess-1" }])
        if (parsed.pathname === "/session/status") return Response.json({ "sess-1": { type: "idle" } })
        if (parsed.pathname === "/session/sess-1") return Response.json({ id: "sess-1", title: "GUI" })
        if (parsed.pathname === "/session/sess-1/message") return Response.json([{ id: "msg-1" }])
        if (parsed.pathname === "/session/sess-1/message/msg-1") return Response.json({ id: "msg-1" })
        if (parsed.pathname === "/session/sess-1/children") return Response.json([{ id: "child-1" }])
        if (parsed.pathname === "/session/sess-1/diff") return Response.json({ files: [] })
        if (parsed.pathname === "/session/sess-1/todo") return Response.json([])
        if (parsed.pathname === "/session/sess-1/share" && request.method === "POST") {
          return Response.json({ id: "sess-1", share: { url: "https://share.example/sess-1" } })
        }
        if (parsed.pathname === "/session/sess-1/share" && request.method === "DELETE") {
          return Response.json({ id: "sess-1" })
        }
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.session.list({ limit: 5 })).resolves.toEqual([{ id: "sess-1" }])
    await expect(client.session.status()).resolves.toEqual({ "sess-1": { type: "idle" } })
    await expect(client.session.get("sess-1")).resolves.toEqual({ id: "sess-1", title: "GUI" })
    await expect(client.session.messages("sess-1", { limit: 20 })).resolves.toEqual([{ id: "msg-1" }])
    await expect(client.session.message("sess-1", "msg-1")).resolves.toEqual({ id: "msg-1" })
    await expect(client.session.children("sess-1")).resolves.toEqual([{ id: "child-1" }])
    await expect(client.session.diff("sess-1", { messageID: "msg-1" })).resolves.toEqual({ files: [] })
    await expect(client.session.todo("sess-1")).resolves.toEqual([])
    await expect(client.session.share("sess-1")).resolves.toEqual({
      id: "sess-1",
      share: { url: "https://share.example/sess-1" },
    })
    await expect(client.session.unshare("sess-1")).resolves.toEqual({ id: "sess-1" })

    expect(calls).toEqual([
      { path: "/session?limit=5", method: "GET", body: "" },
      { path: "/session/status", method: "GET", body: "" },
      { path: "/session/sess-1", method: "GET", body: "" },
      { path: "/session/sess-1/message?limit=20", method: "GET", body: "" },
      { path: "/session/sess-1/message/msg-1", method: "GET", body: "" },
      { path: "/session/sess-1/children", method: "GET", body: "" },
      { path: "/session/sess-1/diff?messageID=msg-1", method: "GET", body: "" },
      { path: "/session/sess-1/todo", method: "GET", body: "" },
      { path: "/session/sess-1/share", method: "POST", body: "" },
      { path: "/session/sess-1/share", method: "DELETE", body: "" },
    ])
  })

  test("HTTP bridge maps GUI discovery and file search calls to the headless backend", async () => {
    const calls: string[] = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push(`${request.method} ${parsed.pathname}${parsed.search}`)
        if (parsed.pathname === "/skill") return Response.json([{ id: "improve-security" }])
        if (parsed.pathname === "/agent") return Response.json([{ id: "general" }])
        if (parsed.pathname === "/project/current") return Response.json({ id: "proj-1" })
        if (parsed.pathname === "/project") return Response.json([{ id: "proj-1" }])
        if (parsed.pathname === "/path") return Response.json({ root: "/repo" })
        if (parsed.pathname === "/vcs") return Response.json({ branch: "main" })
        if (parsed.pathname === "/command") return Response.json([{ name: "init" }])
        if (parsed.pathname === "/file") return Response.json([{ path: "src/index.ts" }])
        if (parsed.pathname === "/file/content") return Response.json({ content: "hello" })
        if (parsed.pathname === "/file/status") return Response.json([{ path: "README.md", status: "modified" }])
        if (parsed.pathname === "/find") return Response.json([{ path: "README.md" }])
        if (parsed.pathname === "/find/file") return Response.json(["README.md"])
        if (parsed.pathname === "/find/symbol") return Response.json([{ name: "main" }])
        if (parsed.pathname === "/experimental/tool/ids") return Response.json(["bash"])
        if (parsed.pathname === "/experimental/tool") return Response.json([{ id: "bash" }])
        if (parsed.pathname === "/lsp") return Response.json({ servers: [] })
        if (parsed.pathname === "/formatter") return Response.json({ enabled: true })
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.app.skills()).resolves.toEqual([{ id: "improve-security" }])
    await expect(client.app.agents()).resolves.toEqual([{ id: "general" }])
    await expect(client.project.current()).resolves.toEqual({ id: "proj-1" })
    await expect(client.project.list()).resolves.toEqual([{ id: "proj-1" }])
    await expect(client.path.get()).resolves.toEqual({ root: "/repo" })
    await expect(client.vcs.get()).resolves.toEqual({ branch: "main" })
    await expect(client.command.list()).resolves.toEqual([{ name: "init" }])
    await expect(client.file.list("src")).resolves.toEqual([{ path: "src/index.ts" }])
    await expect(client.file.read("README.md")).resolves.toEqual({ content: "hello" })
    await expect(client.file.status()).resolves.toEqual([{ path: "README.md", status: "modified" }])
    await expect(client.find.text("hello")).resolves.toEqual([{ path: "README.md" }])
    await expect(client.find.files("README", { limit: 5 })).resolves.toEqual(["README.md"])
    await expect(client.find.symbols("main")).resolves.toEqual([{ name: "main" }])
    await expect(client.tool.ids()).resolves.toEqual(["bash"])
    await expect(client.tool.list("anthropic", "claude")).resolves.toEqual([{ id: "bash" }])
    await expect(client.lsp.status()).resolves.toEqual({ servers: [] })
    await expect(client.formatter.status()).resolves.toEqual({ enabled: true })

    expect(calls).toEqual([
      "GET /skill",
      "GET /agent",
      "GET /project/current",
      "GET /project",
      "GET /path",
      "GET /vcs",
      "GET /command",
      "GET /file?path=src",
      "GET /file/content?path=README.md",
      "GET /file/status",
      "GET /find?pattern=hello",
      "GET /find/file?query=README&limit=5",
      "GET /find/symbol?query=main",
      "GET /experimental/tool/ids",
      "GET /experimental/tool?provider=anthropic&model=claude",
      "GET /lsp",
      "GET /formatter",
    ])
  })

  test("HTTP bridge maps app lifecycle controls to the headless backend", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push({
          path: parsed.pathname,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        if (parsed.pathname === "/log") return Response.json(true)
        if (parsed.pathname === "/instance/dispose") return Response.json(true)
        if (parsed.pathname === "/instance/restart") return Response.json(true)
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.app.log({ service: "gui", level: "info", message: "ready" })).resolves.toBe(true)
    await expect(client.instance.dispose()).resolves.toBe(true)
    await expect(client.instance.restart()).resolves.toBe(true)

    expect(calls).toEqual([
      { path: "/log", method: "POST", body: JSON.stringify({ service: "gui", level: "info", message: "ready" }) },
      { path: "/instance/dispose", method: "POST", body: "" },
      { path: "/instance/restart", method: "POST", body: "" },
    ])
  })

  test("HTTP bridge maps project context diagnostics to the headless backend", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push({
          path: parsed.pathname,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        if (parsed.pathname === "/context" && request.method === "GET") return Response.json({ files: ["AGENTS.md"] })
        if (parsed.pathname === "/context/template") return Response.json({ path: "AGENTS.md" })
        if (parsed.pathname === "/context/memory/warmup") return Response.json({ warmed: true })
        if (parsed.pathname === "/context/memory" && request.method === "DELETE") return Response.json(true)
        if (parsed.pathname === "/debug-engine/pending-plans") return Response.json({ count: 1, plans: [] })
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.context.get()).resolves.toEqual({ files: ["AGENTS.md"] })
    await expect(client.context.createTemplate("repo-rules")).resolves.toEqual({ path: "AGENTS.md" })
    await expect(client.context.memory.warmup()).resolves.toEqual({ warmed: true })
    await expect(client.context.memory.clear()).resolves.toBe(true)
    await expect(client.debugEngine.pendingPlans()).resolves.toEqual({ count: 1, plans: [] })

    expect(calls).toEqual([
      { path: "/context", method: "GET", body: "" },
      { path: "/context/template", method: "POST", body: JSON.stringify({ key: "repo-rules" }) },
      { path: "/context/memory/warmup", method: "POST", body: "" },
      { path: "/context/memory", method: "DELETE", body: "" },
      { path: "/debug-engine/pending-plans", method: "GET", body: "" },
    ])
  })

  test("HTTP bridge maps GUI supervision calls to the headless backend", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push({
          path: parsed.pathname,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        if (parsed.pathname === "/permission") return Response.json([{ id: "perm-1" }])
        if (parsed.pathname === "/permission/perm-1/reply") return Response.json(true)
        if (parsed.pathname === "/question") return Response.json([{ id: "question-1" }])
        if (parsed.pathname === "/question/question-1/reply") return Response.json(true)
        if (parsed.pathname === "/question/question-1/reject") return Response.json(true)
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.permission.list()).resolves.toEqual([{ id: "perm-1" }])
    await expect(client.permission.reply("perm-1", { reply: "once", message: "approved" })).resolves.toBe(true)
    await expect(client.question.list()).resolves.toEqual([{ id: "question-1" }])
    await expect(client.question.reply("question-1", { answers: [{ label: "Yes" }] })).resolves.toBe(true)
    await expect(client.question.reject("question-1")).resolves.toBe(true)

    expect(calls).toEqual([
      { path: "/permission", method: "GET", body: "" },
      {
        path: "/permission/perm-1/reply",
        method: "POST",
        body: JSON.stringify({ reply: "once", message: "approved" }),
      },
      { path: "/question", method: "GET", body: "" },
      {
        path: "/question/question-1/reply",
        method: "POST",
        body: JSON.stringify({ answers: [{ label: "Yes" }] }),
      },
      { path: "/question/question-1/reject", method: "POST", body: "" },
    ])
  })

  test("HTTP bridge maps runtime setting calls to the headless backend", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push({
          path: parsed.pathname,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        if (parsed.pathname === "/autonomous" && request.method === "GET") return Response.json({ enabled: true })
        if (parsed.pathname === "/autonomous" && request.method === "PUT") return Response.json({ enabled: false })
        if (parsed.pathname === "/isolation" && request.method === "GET") {
          return Response.json({ mode: "workspace-write", network: false })
        }
        if (parsed.pathname === "/isolation" && request.method === "PUT") {
          return Response.json({ mode: "read-only", network: false })
        }
        if (parsed.pathname === "/smart-llm" && request.method === "GET") return Response.json({ enabled: true })
        if (parsed.pathname === "/smart-llm" && request.method === "PUT") return Response.json({ enabled: false })
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.runtime.autonomous.get()).resolves.toEqual({ enabled: true })
    await expect(client.runtime.autonomous.set(false)).resolves.toEqual({ enabled: false })
    await expect(client.runtime.isolation.get()).resolves.toEqual({ mode: "workspace-write", network: false })
    await expect(client.runtime.isolation.set("read-only")).resolves.toEqual({ mode: "read-only", network: false })
    await expect(client.runtime.smartLlm.get()).resolves.toEqual({ enabled: true })
    await expect(client.runtime.smartLlm.set(false)).resolves.toEqual({ enabled: false })

    expect(calls).toEqual([
      { path: "/autonomous", method: "GET", body: "" },
      { path: "/autonomous", method: "PUT", body: JSON.stringify({ enabled: false }) },
      { path: "/isolation", method: "GET", body: "" },
      { path: "/isolation", method: "PUT", body: JSON.stringify({ mode: "read-only" }) },
      { path: "/smart-llm", method: "GET", body: "" },
      { path: "/smart-llm", method: "PUT", body: JSON.stringify({ enabled: false }) },
    ])
  })

  test("HTTP bridge maps MCP management calls to the headless backend", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push({
          path: parsed.pathname,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        if (parsed.pathname === "/mcp" && request.method === "GET") {
          return Response.json({ playwright: { type: "connected" } })
        }
        if (parsed.pathname === "/experimental/resource") return Response.json([{ uri: "file://README.md" }])
        if (parsed.pathname === "/mcp" && request.method === "POST") {
          return Response.json({ playwright: { type: "connected" } })
        }
        if (parsed.pathname === "/mcp/playwright/auth" && request.method === "POST") {
          return Response.json({ authorizationUrl: "https://auth.example" })
        }
        if (parsed.pathname === "/mcp/playwright/auth/callback") return Response.json({ type: "connected" })
        if (parsed.pathname === "/mcp/playwright/auth/authenticate") return Response.json({ type: "connected" })
        if (parsed.pathname === "/mcp/playwright/auth" && request.method === "DELETE") return Response.json(true)
        if (parsed.pathname === "/mcp/playwright/connect") return Response.json(true)
        if (parsed.pathname === "/mcp/playwright/disconnect") return Response.json(true)
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.mcp.status()).resolves.toEqual({ playwright: { type: "connected" } })
    await expect(client.mcp.resources()).resolves.toEqual([{ uri: "file://README.md" }])
    await expect(
      client.mcp.add("playwright", { type: "local", command: ["npx", "playwright"] } as never),
    ).resolves.toEqual({ playwright: { type: "connected" } })
    await expect(client.mcp.auth.start("playwright")).resolves.toEqual({
      authorizationUrl: "https://auth.example",
    })
    await expect(client.mcp.auth.callback("playwright", "abc")).resolves.toEqual({ type: "connected" })
    await expect(client.mcp.auth.authenticate("playwright")).resolves.toEqual({ type: "connected" })
    await expect(client.mcp.auth.remove("playwright")).resolves.toBe(true)
    await expect(client.mcp.connect("playwright")).resolves.toBe(true)
    await expect(client.mcp.disconnect("playwright")).resolves.toBe(true)

    expect(calls).toEqual([
      { path: "/mcp", method: "GET", body: "" },
      { path: "/experimental/resource", method: "GET", body: "" },
      {
        path: "/mcp",
        method: "POST",
        body: JSON.stringify({ name: "playwright", config: { type: "local", command: ["npx", "playwright"] } }),
      },
      { path: "/mcp/playwright/auth", method: "POST", body: "" },
      { path: "/mcp/playwright/auth/callback", method: "POST", body: JSON.stringify({ code: "abc" }) },
      { path: "/mcp/playwright/auth/authenticate", method: "POST", body: "" },
      { path: "/mcp/playwright/auth", method: "DELETE", body: "" },
      { path: "/mcp/playwright/connect", method: "POST", body: "" },
      { path: "/mcp/playwright/disconnect", method: "POST", body: "" },
    ])
  })

  test("HTTP bridge filters event streams for GUI subscriptions", async () => {
    const calls: string[] = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push(`${request.method} ${parsed.pathname}`)
        if (parsed.pathname === "/event") {
          return sseResponse([
            { type: "server.connected", properties: {} },
            { type: "session.created", properties: { info: { id: "sess-1" } } },
            { type: "session.status", properties: { sessionID: "sess-2", status: { type: "idle" } } },
            { type: "message.updated", properties: { info: { id: "msg-1", sessionID: "sess-1" } } },
            { type: "task.queue.updated", properties: { item: { id: "task-1", sessionID: "sess-2" } } },
          ])
        }
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })
    const events = []

    for await (const event of client.subscribeEvents({
      types: ["server.connected", "session.status", "message.updated", "task.queue.updated"],
      sessionID: "sess-1",
    })) {
      events.push(event)
    }

    expect(calls).toEqual(["GET /event"])
    expect(events).toEqual([
      { type: "server.connected", properties: {} },
      { type: "message.updated", properties: { info: { id: "msg-1", sessionID: "sess-1" } } },
    ])
  })

  test("HTTP bridge maps provider auth settings to the headless backend", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push({
          path: parsed.pathname,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        if (parsed.pathname === "/config" && request.method === "GET") return Response.json({ model: "default" })
        if (parsed.pathname === "/config" && request.method === "PATCH") return Response.json({ saved: true })
        if (parsed.pathname === "/config/providers") return Response.json({ anthropic: { model: "claude" } })
        if (parsed.pathname === "/provider") return Response.json([{ id: "anthropic" }])
        if (parsed.pathname === "/provider/auth") return Response.json({ anthropic: [{ type: "api" }] })
        if (parsed.pathname === "/auth/anthropic" && request.method === "PUT") return Response.json(true)
        if (parsed.pathname === "/auth/anthropic" && request.method === "DELETE") return Response.json(true)
        if (parsed.pathname === "/provider/anthropic/oauth/authorize")
          return Response.json({ url: "https://auth.example" })
        if (parsed.pathname === "/provider/anthropic/oauth/callback") return Response.json(true)
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.config.get()).resolves.toEqual({ model: "default" })
    await expect(client.config.update({ model: "next" } as never)).resolves.toEqual({ saved: true })
    await expect(client.config.providers()).resolves.toEqual({ anthropic: { model: "claude" } })
    await expect(client.provider.list()).resolves.toEqual([{ id: "anthropic" }])
    await expect(client.provider.auth()).resolves.toEqual({ anthropic: [{ type: "api" }] })
    await expect(client.auth.set("anthropic", { type: "api", key: "secret" })).resolves.toBe(true)
    await expect(client.auth.remove("anthropic")).resolves.toBe(true)
    await expect(client.provider.oauth.authorize("anthropic", { method: 0 })).resolves.toEqual({
      url: "https://auth.example",
    })
    await expect(client.provider.oauth.callback("anthropic", { method: 0, code: "abc" })).resolves.toBe(true)

    expect(calls).toEqual([
      { path: "/config", method: "GET", body: "" },
      { path: "/config", method: "PATCH", body: JSON.stringify({ model: "next" }) },
      { path: "/config/providers", method: "GET", body: "" },
      { path: "/provider", method: "GET", body: "" },
      { path: "/provider/auth", method: "GET", body: "" },
      { path: "/auth/anthropic", method: "PUT", body: JSON.stringify({ type: "api", key: "secret" }) },
      { path: "/auth/anthropic", method: "DELETE", body: "" },
      { path: "/provider/anthropic/oauth/authorize", method: "POST", body: JSON.stringify({ method: 0 }) },
      {
        path: "/provider/anthropic/oauth/callback",
        method: "POST",
        body: JSON.stringify({ method: 0, code: "abc" }),
      },
    ])
  })

  test("HTTP bridge maps workflow dashboard supervision calls to the headless backend", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push({
          path: `${parsed.pathname}${parsed.search}`,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        if (parsed.pathname === "/workflow-runs") return Response.json([{ id: "run-1" }])
        if (parsed.pathname === "/workflow-runs/run-1" && request.method === "GET") {
          return Response.json({ id: "run-1", status: "running" })
        }
        if (parsed.pathname === "/workflow-runs/dashboard") return Response.json([{ id: "run-1" }])
        if (parsed.pathname === "/workflow-runs/eval-cases") return Response.json([{ id: "case-1" }])
        if (parsed.pathname === "/workflow-runs/run-1/eval-case") return Response.json({ caseID: "case-1" })
        if (parsed.pathname === "/workflow-runs/run-1/retry") return Response.json({ id: "run-1", status: "running" })
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.workflowRun.list({ status: "running", limit: 10 })).resolves.toEqual([{ id: "run-1" }])
    await expect(client.workflowRun.get("run-1")).resolves.toEqual({ id: "run-1", status: "running" })
    await expect(client.workflowRun.dashboard({ limit: 10 })).resolves.toEqual([{ id: "run-1" }])
    await expect(client.workflowRun.evalCases()).resolves.toEqual([{ id: "case-1" }])
    await expect(client.workflowRun.evalCase("run-1", { caseID: "case-1" })).resolves.toEqual({ caseID: "case-1" })
    await expect(client.workflowRun.retry("run-1", { phaseID: "phase-1" })).resolves.toEqual({
      id: "run-1",
      status: "running",
    })

    expect(calls).toEqual([
      { path: "/workflow-runs?status=running&limit=10", method: "GET", body: "" },
      { path: "/workflow-runs/run-1", method: "GET", body: "" },
      { path: "/workflow-runs/dashboard?limit=10", method: "GET", body: "" },
      { path: "/workflow-runs/eval-cases", method: "GET", body: "" },
      { path: "/workflow-runs/run-1/eval-case", method: "POST", body: JSON.stringify({ caseID: "case-1" }) },
      { path: "/workflow-runs/run-1/retry?phaseID=phase-1", method: "POST", body: "" },
    ])
  })

  test("HTTP bridge maps PTY management calls to the headless backend", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        calls.push({
          path: new URL(request.url).pathname,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        const pathname = new URL(request.url).pathname
        if (pathname === "/pty" && request.method === "GET") return Response.json([{ id: "pty_1" }])
        if (pathname === "/pty" && request.method === "POST") return Response.json({ id: "pty_2" })
        if (pathname === "/pty/pty_2" && request.method === "PUT") return Response.json({ id: "pty_2", title: "Shell" })
        if (pathname === "/pty/pty_2" && request.method === "DELETE") return Response.json(true)
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.pty.list()).resolves.toEqual([{ id: "pty_1" }])
    await expect(client.pty.create({ title: "Shell" })).resolves.toEqual({ id: "pty_2" })
    await expect(client.pty.update("pty_2", { title: "Shell" })).resolves.toEqual({ id: "pty_2", title: "Shell" })
    await expect(client.pty.remove("pty_2")).resolves.toBe(true)

    expect(calls).toEqual([
      { path: "/pty", method: "GET", body: "" },
      { path: "/pty", method: "POST", body: JSON.stringify({ title: "Shell" }) },
      { path: "/pty/pty_2", method: "PUT", body: JSON.stringify({ title: "Shell" }) },
      { path: "/pty/pty_2", method: "DELETE", body: "" },
    ])
  })

  test("HTTP bridge adapts PTY streams to the WebSocket route", async () => {
    class FakeSocket {
      readyState = 1
      binaryType?: BinaryType
      sent: Array<string | Uint8Array | ArrayBuffer> = []
      onopen?: (event: unknown) => void
      onmessage?: (event: { data: unknown }) => void
      onerror?: (event: unknown) => void
      onclose?: (event: { code?: number; reason?: string }) => void

      constructor(readonly url: string) {}

      send(data: string | Uint8Array | ArrayBuffer) {
        this.sent.push(data)
      }

      close(code?: number, reason?: string) {
        this.onclose?.({ code, reason })
      }
    }

    let socket: FakeSocket | undefined
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      headers: { Authorization: "Basic " + btoa("ax-code:secret") },
      webSocketFactory(url) {
        socket = new FakeSocket(url)
        queueMicrotask(() => socket?.onopen?.({}))
        return socket
      },
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        calls.push({
          path: new URL(request.url).pathname,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        return Response.json({ id: "pty_1" })
      }) as typeof fetch,
    })
    const frames = async function* () {
      yield "ls\n"
      yield { type: "resize" as const, cols: 120, rows: 30 }
    }
    const eventsPromise = (async () => {
      const events = []
      for await (const event of client.pty.connect("pty_1", frames(), { cursor: 8 })) events.push(event)
      return events
    })()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(socket?.url).toBe("ws://ax-code:secret@127.0.0.1:4096/pty/pty_1/connect?cursor=8")
    socket?.onmessage?.({ data: "ready" })
    socket?.onmessage?.({ data: ptyMetaFrame({ cursor: 12 }) })
    socket?.close(1000, "done")

    await expect(eventsPromise).resolves.toEqual([
      { type: "output", data: "ready" },
      { type: "replay", cursor: 12 },
      { type: "closed", code: 1000, reason: "done" },
    ])
    expect(socket?.sent).toEqual(["ls\n"])
    expect(calls).toEqual([
      { path: "/pty/pty_1", method: "PUT", body: JSON.stringify({ size: { cols: 120, rows: 30 } }) },
    ])
  })

  test("HTTP bridge can load a GUI bootstrap snapshot from selected routes", async () => {
    const paths: string[] = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        paths.push(`${parsed.pathname}${parsed.search}`)
        if (parsed.pathname === "/path") return Response.json({ root: "/repo", config: "/repo/ax-code.json" })
        if (parsed.pathname === "/vcs") return Response.json({ branch: "main" })
        if (parsed.pathname === "/command") return Response.json([{ name: "init" }])
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.bootstrap.load({ include: { path: true, vcs: true, commands: true } })).resolves.toEqual({
      path: { root: "/repo", config: "/repo/ax-code.json" },
      vcs: { branch: "main" },
      commands: [{ name: "init" }],
      errors: [],
    })
    expect(paths.toSorted()).toEqual(["/command", "/path", "/vcs"])
  })

  test("HTTP bridge exposes health without requiring an HTTP round trip", async () => {
    const bridge = createAxCodeGrpcHttpBridge({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async () => {
        throw new Error("fetch should not be called")
      }) as typeof fetch,
    })

    await expect(bridge.unary(AX_CODE_GRPC_METHOD.Health, {})).resolves.toEqual({
      status: "SERVING",
      transport: "http-bridge",
    })
  })

  test("HTTP bridge is loopback-only by default for desktop fallback safety", async () => {
    expect(() =>
      createAxCodeGrpcClientFromHttp({
        baseUrl: "https://ax-code.example.com",
      }),
    ).toThrow("AX Code gRPC HTTP bridge only accepts loopback HTTP base URLs by default")

    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "https://ax-code.example.com",
      allowRemoteHttpBridge: true,
      fetch: (async () => {
        throw new Error("fetch should not be called")
      }) as typeof fetch,
    })

    await expect(client.health()).resolves.toEqual({ status: "SERVING", transport: "http-bridge" })
  })

  test("HTTP bridge default allows literal loopback endpoints", async () => {
    for (const baseUrl of ["http://localhost:4096", "http://127.12.0.1:4096", "http://[::1]:4096"]) {
      const client = createAxCodeGrpcClientFromHttp({
        baseUrl,
        fetch: (async () => {
          throw new Error("fetch should not be called")
        }) as typeof fetch,
      })

      await expect(client.health()).resolves.toEqual({ status: "SERVING", transport: "http-bridge" })
    }
  })

  test("proto declares the headless service used by the SDK facade", () => {
    const proto = readFileSync(resolve(import.meta.dir, "../../proto/ax_code/v1/headless.proto"), "utf8")

    expect(proto).toContain("service AxCodeHeadless")
    expect(proto).toContain("rpc SendRuntimeCommand")
    expect(proto).toContain("rpc LoadBootstrap")
    expect(proto).toContain("rpc ListSessionMessages")
    expect(proto).toContain("rpc ListSkills")
    expect(proto).toContain("rpc WriteAppLog")
    expect(proto).toContain("rpc DisposeInstance")
    expect(proto).toContain("rpc RestartInstance")
    expect(proto).toContain("rpc GetPath")
    expect(proto).toContain("rpc GetVcs")
    expect(proto).toContain("rpc ListCommands")
    expect(proto).toContain("rpc GetProjectContext")
    expect(proto).toContain("rpc CreateProjectContextTemplate")
    expect(proto).toContain("rpc WarmupProjectMemory")
    expect(proto).toContain("rpc ClearProjectMemory")
    expect(proto).toContain("rpc GetDebugEnginePendingPlans")
    expect(proto).toContain("rpc FindFiles")
    expect(proto).toContain("rpc ListPermissions")
    expect(proto).toContain("rpc ReplyPermission")
    expect(proto).toContain("rpc ListQuestions")
    expect(proto).toContain("rpc ReplyQuestion")
    expect(proto).toContain("rpc RejectQuestion")
    expect(proto).toContain("rpc GetAutonomousMode")
    expect(proto).toContain("rpc SetAutonomousMode")
    expect(proto).toContain("rpc GetIsolationMode")
    expect(proto).toContain("rpc SetIsolationMode")
    expect(proto).toContain("rpc GetSmartLlmRouting")
    expect(proto).toContain("rpc SetSmartLlmRouting")
    expect(proto).toContain("rpc GetMcpStatus")
    expect(proto).toContain("rpc ListMcpResources")
    expect(proto).toContain("rpc AddMcpServer")
    expect(proto).toContain("rpc StartMcpAuth")
    expect(proto).toContain("rpc CompleteMcpAuth")
    expect(proto).toContain("rpc AuthenticateMcp")
    expect(proto).toContain("rpc RemoveMcpAuth")
    expect(proto).toContain("rpc ConnectMcp")
    expect(proto).toContain("rpc DisconnectMcp")
    expect(proto).toContain("rpc SetAuth")
    expect(proto).toContain("rpc ProviderOauthAuthorize")
    expect(proto).toContain("rpc GetLspStatus")
    expect(proto).toContain("rpc GetFormatterStatus")
    expect(proto).toContain("rpc ConnectPty")
    expect(proto).toContain("rpc WorkflowRunDashboard")
    expect(proto).toContain("rpc WorkflowRunEvalCases")
    expect(proto).toContain("rpc WorkflowRunEvalCase")
    expect(proto).toContain("rpc SubscribeEvents")
  })
})

function ptyMetaFrame(payload: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(payload))
  const bytes = new Uint8Array(encoded.length + 1)
  bytes[0] = 0
  bytes.set(encoded, 1)
  return bytes
}

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        controller.close()
      },
    }),
    {
      headers: { "content-type": "text/event-stream" },
    },
  )
}

async function* asyncFrames<T>(...frames: T[]) {
  yield* frames
}

function headerValue(headers: RequestInit["headers"], name: string) {
  if (!headers) return null
  if (headers instanceof Headers) return headers.get(name)
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
    return found?.[1] ?? null
  }
  return headers[name] ?? headers[name.toLowerCase()] ?? null
}
