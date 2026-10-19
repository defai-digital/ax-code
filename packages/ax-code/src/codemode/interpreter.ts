import type { AnyNode } from "acorn"
import { parseJsonStrict } from "@ax-code/util/json-value"
import { Budget, Fault, type Limits, type Diagnostic } from "./limits"
import { parseProgram, unsupported } from "./parser"
import { get, globals, invoke, iterable, set } from "./builtins"
import {
  Env,
  builtin,
  copyIn,
  key,
  list,
  num,
  object,
  primitive,
  record,
  serialize,
  str,
  tagged,
  truth,
  type Closure,
  type Value,
} from "./values"

export interface Options {
  limits?: Partial<Limits>
  signal?: AbortSignal
  /** Only explicitly injected clocks are visible as Date.now(). */
  clock?: () => number
  tools?: readonly string[]
  dispatch?: (id: string, args: unknown, signal: AbortSignal) => Promise<unknown>
}
export interface Result {
  output: string
  metadata: { toolCalls: number; steps: number; durationMs: number }
  diagnostic?: Diagnostic
}
class Completion {
  constructor(
    readonly type: "return" | "break" | "continue" | "throw",
    readonly value?: Value,
  ) {}
}
const shortCircuit = Symbol("optional chain")
type Reference = { get(): Value; set(value: Value): Value; receiver?: Value }

/** Own enumerable string keys, matching `for...in` over the values we model. */
function enumerableKeys(value: Value): string[] {
  if (typeof value === "string") return Array.from({ length: value.length }, (_, index) => String(index))
  if (!tagged(value)) return []
  if (value.kind === "array") return value.items.map((_, index) => String(index))
  if (value.kind === "object" || value.kind === "error") return [...value.props.keys()]
  return []
}

class Interpreter {
  fatal?: Fault
  lastYieldStep = 0
  depth = 0
  readonly pending = new Set<Promise<Value>>()
  readonly global = new Env(undefined, true)
  constructor(
    readonly source: string,
    readonly budget: Budget,
    readonly options: Options,
  ) {
    for (const [name, value] of globals(budget)) this.global.define(name, value, true)
    this.global.define(
      "tools",
      { kind: "object", props: new Map((options.tools ?? []).map((name) => [key(name), builtin(`tools.${name}`)])) },
      true,
    )
  }
  get clock() {
    return this.options.clock
  }
  hoist(node: AnyNode, env: Env) {
    const nodes: AnyNode[] = [node]
    const names = (pattern: AnyNode): void => {
      if (pattern.type === "Identifier") {
        if (!env.bindings.has(pattern.name)) {
          this.budget.allocate(1)
          // `var` can be redeclared by a function declaration or another var.
          env.define(pattern.name, undefined, false, true)
        }
      } else if (pattern.type === "ArrayPattern") {
        for (const item of pattern.elements) if (item) names(item)
      } else if (pattern.type === "ObjectPattern") {
        for (const item of pattern.properties) names(item.type === "RestElement" ? item.argument : item.value)
      } else if (pattern.type === "AssignmentPattern") names(pattern.left)
      else if (pattern.type === "RestElement") names(pattern.argument)
    }
    while (nodes.length) {
      const current = nodes.pop()!
      this.budget.step()
      if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(current.type)) continue
      if (current.type === "VariableDeclaration" && current.kind === "var")
        for (const declaration of current.declarations) names(declaration.id)
      for (const value of Object.values(current)) {
        if (Array.isArray(value)) {
          for (const item of value) if (item && typeof item === "object" && "type" in item) nodes.push(item as AnyNode)
        } else if (value && typeof value === "object" && "type" in value) nodes.push(value as AnyNode)
      }
    }
  }
  declareFunction(scope: Env, name: string, value: Value) {
    const existing = scope.bindings.get(name)
    // A hoisted `var` (or an earlier declaration) is overwritten, as in JS.
    if (existing && !existing.constant) {
      existing.value = value
      return
    }
    scope.define(name, value)
  }
  async settle(value: Value): Promise<Value> {
    while (tagged(value) && value.kind === "promise") value = await value.promise
    this.budget.check()
    return value
  }
  track(promise: Promise<Value>): Value {
    // Attach a handler immediately: a script may intentionally ignore a call.
    this.budget.allocate(1)
    this.pending.add(promise)
    const settled = () => this.pending.delete(promise)
    void promise.then(settled, settled)
    return { kind: "promise", promise }
  }
  async call(fn: Value, args: Value[], receiver?: Value): Promise<Value> {
    this.budget.step()
    if (!tagged(fn)) throw new Error("Value is not callable")
    if (fn.kind === "builtin") {
      if (fn.name.startsWith("tools.")) {
        this.budget.check()
        if (this.budget.toolCalls >= this.budget.limits.max_tool_calls) this.budget.fail("tool_calls")
        this.budget.toolCalls++
        const name = fn.name.slice(6)
        if (!this.options.dispatch || !this.options.tools?.includes(name)) throw new Error("Unavailable tool")
        if (args.length !== 1) throw new Error("Tool calls require one plain argument object")
        object(args[0])
        const parameters = parseJsonStrict(serialize(args[0], this.budget))
        const result = Promise.resolve()
          .then(() => {
            this.budget.check()
            return this.options.dispatch!(name, parameters, this.budget.signal)
          })
          .then(
            (value) => copyIn(value, this.budget),
            (error: unknown) => {
              if (error instanceof Fault) throw error
              // Host stack/name/custom fields never cross this boundary.
              throw new Completion(
                "throw",
                record(
                  [["message", this.budget.string(error instanceof Error ? error.message : "Tool call failed")]],
                  this.budget,
                  "error",
                ),
              )
            },
          )
        return this.track(result)
      }
      const value = await invoke(fn, args, this)
      if (tagged(value) && value.kind === "promise") return this.track(value.promise)
      return value
    }
    if (fn.kind !== "closure") throw new Error("Value is not callable")
    const run = async () => {
      if (++this.depth > this.budget.limits.max_call_depth) this.budget.fail("call_depth")
      try {
        const node = fn.node
        if (
          node.type !== "FunctionDeclaration" &&
          node.type !== "FunctionExpression" &&
          node.type !== "ArrowFunctionExpression"
        )
          throw new Error("Invalid closure")
        const env = new Env(fn.env, !fn.arrow, receiver, !fn.arrow)
        // Arrows still own var bindings, but inherit their lexical receiver.
        const scope = fn.arrow ? new Env(env, true, fn.env.receiver()) : env
        if (node.type !== "ArrowFunctionExpression" && node.id) scope.define(node.id.name, fn, true)
        for (let i = 0; i < node.params.length; i++) {
          const param = node.params[i]
          await this.bind(
            param,
            param.type === "RestElement" ? list(args.slice(i), this.budget) : args[i],
            scope,
            "let",
          )
        }
        this.hoist(node.body, scope)
        try {
          if (node.body.type !== "BlockStatement") return await this.eval(node.body, scope)
          await this.eval(node.body, scope, true)
          return undefined
        } catch (error) {
          if (error instanceof Completion && error.type === "return") return error.value
          throw error
        }
      } finally {
        this.depth--
      }
    }
    return fn.async ? this.track(run().then((value) => this.settle(value))) : run()
  }
  closure(node: AnyNode, env: Env): Closure {
    this.budget.allocate(1)
    return {
      kind: "closure",
      node,
      env,
      arrow: node.type === "ArrowFunctionExpression",
      async: "async" in node && node.async === true,
    }
  }
  async property(node: AnyNode, computed: boolean, env: Env): Promise<string> {
    return key(
      computed
        ? await this.eval(node, env)
        : node.type === "Identifier"
          ? node.name
          : node.type === "Literal"
            ? copyIn(node.value, this.budget)
            : undefined,
    )
  }
  async reference(node: AnyNode, env: Env): Promise<Reference> {
    if (node.type === "Identifier")
      return {
        get: () => env.get(node.name),
        set: (value) => {
          env.set(node.name, value)
          return value
        },
      }
    if (node.type !== "MemberExpression") unsupported(node, this.source, "Invalid assignment target")
    const receiver = await this.eval(node.object, env)
    if (receiver == null && node.optional) throw shortCircuit
    const name = await this.property(node.property, node.computed, env)
    return { get: () => get(receiver, name), set: (value) => set(receiver, name, value, this.budget), receiver }
  }
  async bind(node: AnyNode, value: Value, env: Env, kind?: string): Promise<void> {
    this.budget.step()
    switch (node.type) {
      case "Identifier":
        if (kind) {
          this.budget.allocate(1)
          env.define(node.name, value, kind === "const", kind === "var")
        } else env.set(node.name, value)
        return
      case "MemberExpression":
        ;(await this.reference(node, env)).set(value)
        return
      case "RestElement":
        return this.bind(node.argument, value, env, kind)
      case "AssignmentPattern":
        return this.bind(node.left, value === undefined ? await this.eval(node.right, env) : value, env, kind)
      case "ArrayPattern": {
        const values = iterable(value, this.budget)
        for (let i = 0; i < node.elements.length; i++) {
          const element = node.elements[i]
          if (element)
            await this.bind(
              element,
              element.type === "RestElement" ? list(values.slice(i), this.budget) : values[i],
              env,
              kind,
            )
        }
        return
      }
      case "ObjectPattern": {
        const used = new Set<string>()
        for (const property of node.properties) {
          if (property.type === "RestElement") {
            const entries = [...object(value)].filter(([name]) => !used.has(name))
            await this.bind(property.argument, record(entries, this.budget), env, kind)
          } else {
            const name = await this.property(property.key, property.computed, env)
            used.add(name)
            await this.bind(property.value, get(value, name), env, kind)
          }
        }
        return
      }
      default:
        unsupported(node, this.source, "Unsupported binding")
    }
  }
  binary(operator: string, left: Value, right: Value): Value {
    if (operator === "===") return left === right
    if (operator === "!==") return left !== right
    if (operator === "==" || operator === "!=") {
      const equal = tagged(left) || tagged(right) ? left === right : left == right
      return operator === "==" ? equal : !equal
    }
    if (operator === "in") {
      const name = key(left)
      if (tagged(right) && (right.kind === "object" || right.kind === "error")) return right.props.has(name)
      if (tagged(right) && right.kind === "array")
        return name === "length" || (/^(0|[1-9][0-9]*)$/.test(name) && Number(name) < right.items.length)
      throw new Error("in requires a plain object or array")
    }
    if (operator === "instanceof") {
      if (!tagged(right) || right.kind !== "builtin") throw new Error("Unsupported instanceof target")
      if (!tagged(left)) return false
      return (
        (
          { Map: "map", Set: "set", Error: "error", Date: "date", Array: "array", Object: "object" } as Record<
            string,
            string
          >
        )[right.name] === left.kind
      )
    }
    const l = primitive(left),
      r = primitive(right)
    switch (operator) {
      case "+": {
        if (typeof l === "string" || typeof r === "string") {
          const a = String(l),
            b = String(r)
          if (a.length + b.length > this.budget.limits.max_string_bytes) this.budget.fail("string_bytes")
          return this.budget.string(a + b)
        }
        return Number(l) + Number(r)
      }
      case "-":
        return Number(l) - Number(r)
      case "*":
        return Number(l) * Number(r)
      case "/":
        return Number(l) / Number(r)
      case "%":
        return Number(l) % Number(r)
      case "**":
        return Number(l) ** Number(r)
      case "<":
        return typeof l === "string" && typeof r === "string" ? l < r : Number(l) < Number(r)
      case "<=":
        return typeof l === "string" && typeof r === "string" ? l <= r : Number(l) <= Number(r)
      case ">":
        return typeof l === "string" && typeof r === "string" ? l > r : Number(l) > Number(r)
      case ">=":
        return typeof l === "string" && typeof r === "string" ? l >= r : Number(l) >= Number(r)
      case "|":
        return Number(l) | Number(r)
      case "&":
        return Number(l) & Number(r)
      case "^":
        return Number(l) ^ Number(r)
      case "<<":
        return Number(l) << Number(r)
      case ">>":
        return Number(l) >> Number(r)
      case ">>>":
        return Number(l) >>> Number(r)
      default:
        throw new Error(`Unsupported operator: ${operator}`)
    }
  }
  async eval(node: AnyNode, env: Env, reuseBlock = false): Promise<Value> {
    if (this.fatal) throw this.fatal
    this.budget.step()
    // Yield to the event loop so external aborts and the wall timer run during
    // CPU-only scripts; async microtasks alone would starve those timers.
    if (this.budget.steps - this.lastYieldStep >= 1024) {
      this.lastYieldStep = this.budget.steps
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      this.budget.check()
    }
    try {
      switch (node.type) {
        case "Program":
        case "BlockStatement": {
          // A function body is its own scope already; only nested blocks add one.
          const scope = node.type === "Program" || reuseBlock ? env : new Env(env)
          this.budget.allocate(1)
          for (const statement of node.body)
            if (statement.type === "FunctionDeclaration" && statement.id)
              this.declareFunction(scope, statement.id.name, this.closure(statement, scope))
          let value: Value
          for (const statement of node.body) value = await this.eval(statement, scope)
          return value
        }
        case "EmptyStatement":
          return undefined
        case "ExpressionStatement":
          return await this.eval(node.expression, env)
        case "Literal":
          return copyIn(node.value, this.budget)
        case "Identifier":
          return env.get(node.name)
        case "ThisExpression":
          if (!env.hasReceiver()) unsupported(node, this.source, "this outside a plain function")
          return env.receiver()
        case "FunctionDeclaration":
          return undefined
        case "FunctionExpression":
        case "ArrowFunctionExpression":
          return this.closure(node, env)
        case "VariableDeclaration":
          for (const declaration of node.declarations)
            if (node.kind !== "var" || declaration.init)
              await this.bind(
                declaration.id,
                declaration.init ? await this.eval(declaration.init, env) : undefined,
                env,
                node.kind,
              )
          return undefined
        case "ArrayExpression": {
          const items: Value[] = []
          for (const item of node.elements) {
            const values =
              item?.type === "SpreadElement"
                ? iterable(await this.eval(item.argument, env), this.budget)
                : [item ? await this.eval(item, env) : undefined]
            this.budget.size(items.length + values.length)
            for (const value of values) items.push(value)
          }
          return list(items, this.budget)
        }
        case "ObjectExpression": {
          const result = record([], this.budget)
          for (const property of node.properties) {
            if (property.type === "SpreadElement")
              for (const [name, value] of object(await this.eval(property.argument, env)))
                set(result, key(name), value, this.budget)
            else
              set(
                result,
                await this.property(property.key, property.computed, env),
                await this.eval(property.value, env),
                this.budget,
              )
          }
          return result
        }
        case "TemplateLiteral": {
          let result = ""
          for (let i = 0; i < node.quasis.length; i++) {
            result = str(this.binary("+", result, node.quasis[i].value.cooked ?? ""))
            if (i < node.expressions.length)
              result = str(this.binary("+", result, str(await this.eval(node.expressions[i], env))))
          }
          return result
        }
        case "MemberExpression":
          return (await this.reference(node, env)).get()
        case "ChainExpression":
          try {
            return await this.eval(node.expression, env)
          } catch (error) {
            if (error === shortCircuit) return undefined
            throw error
          }
        case "CallExpression":
        case "NewExpression": {
          const ref = node.callee.type === "MemberExpression" ? await this.reference(node.callee, env) : undefined
          const fn = ref ? ref.get() : await this.eval(node.callee, env)
          if (node.type === "CallExpression" && node.optional && fn == null) throw shortCircuit
          if (
            node.type === "NewExpression" &&
            (!tagged(fn) || fn.kind !== "builtin" || !["Map", "Set", "Error", "Date"].includes(fn.name))
          )
            unsupported(node, this.source, "Constructor is not allowlisted")
          const args: Value[] = []
          for (const arg of node.arguments) {
            const values =
              arg.type === "SpreadElement"
                ? iterable(await this.eval(arg.argument, env), this.budget)
                : [await this.eval(arg, env)]
            this.budget.size(args.length + values.length)
            for (const value of values) args.push(value)
          }
          return await this.call(fn, args, ref?.receiver)
        }
        case "AwaitExpression":
          return await this.settle(await this.eval(node.argument, env))
        case "SequenceExpression": {
          let value: Value
          for (const expression of node.expressions) value = await this.eval(expression, env)
          return value
        }
        case "ConditionalExpression":
          return await this.eval(truth(await this.eval(node.test, env)) ? node.consequent : node.alternate, env)
        case "LogicalExpression": {
          const left = await this.eval(node.left, env)
          return (node.operator === "&&" ? truth(left) : node.operator === "||" ? !truth(left) : left == null)
            ? await this.eval(node.right, env)
            : left
        }
        case "BinaryExpression":
          return this.binary(node.operator, await this.eval(node.left, env), await this.eval(node.right, env))
        case "UnaryExpression": {
          if (node.operator === "delete") unsupported(node, this.source, "delete")
          const value = await this.eval(node.argument, env)
          switch (node.operator) {
            case "typeof":
              return tagged(value)
                ? value.kind === "closure" || value.kind === "builtin"
                  ? "function"
                  : "object"
                : typeof value
            case "void":
              return undefined
            case "!":
              return !truth(value)
            case "~":
              return ~num(value)
            case "+":
              return num(value)
            case "-":
              return -num(value)
          }
          return undefined
        }
        case "UpdateExpression": {
          const ref = await this.reference(node.argument, env)
          const before = num(ref.get()),
            after = before + (node.operator === "++" ? 1 : -1)
          ref.set(after)
          return node.prefix ? after : before
        }
        case "AssignmentExpression": {
          if (node.left.type === "ArrayPattern" || node.left.type === "ObjectPattern") {
            const value = await this.eval(node.right, env)
            await this.bind(node.left, value, env)
            return value
          }
          const ref = await this.reference(node.left, env)
          const old = ref.get()
          if (
            (node.operator === "&&=" && !truth(old)) ||
            (node.operator === "||=" && truth(old)) ||
            (node.operator === "??=" && old != null)
          )
            return old
          const right = await this.eval(node.right, env)
          return ref.set(
            ["=", "&&=", "||=", "??="].includes(node.operator)
              ? right
              : this.binary(node.operator.slice(0, -1), old, right),
          )
        }
        case "IfStatement":
          return truth(await this.eval(node.test, env))
            ? await this.eval(node.consequent, env)
            : node.alternate
              ? await this.eval(node.alternate, env)
              : undefined
        case "ReturnStatement":
          throw new Completion("return", node.argument ? await this.eval(node.argument, env) : undefined)
        case "BreakStatement":
          throw new Completion("break")
        case "ContinueStatement":
          throw new Completion("continue")
        case "ThrowStatement":
          throw new Completion("throw", await this.eval(node.argument, env))
        case "TryStatement": {
          let fatal: Fault | undefined
          try {
            return await this.eval(node.block, env)
          } catch (error) {
            if (error instanceof Fault) {
              fatal = error
              throw error
            }
            if ((error instanceof Completion && error.type !== "throw") || error === shortCircuit) throw error
            if (!node.handler) throw error
            const scope = new Env(env)
            const value =
              error instanceof Completion
                ? error.value
                : record(
                    [["message", this.budget.string(error instanceof Error ? error.message : "Runtime error")]],
                    this.budget,
                    "error",
                  )
            if (node.handler.param) await this.bind(node.handler.param, value, scope, "let")
            return await this.eval(node.handler.body, scope)
          } finally {
            if (fatal || this.fatal) throw fatal ?? this.fatal
            // Fatal budgets cannot be swallowed by a return in finally.
            this.budget.check()
            if (this.budget.steps > this.budget.limits.max_steps) this.budget.fail("steps")
            if (node.finalizer) await this.eval(node.finalizer, env)
          }
        }
        case "ForOfStatement":
        case "ForInStatement": {
          if (node.type === "ForOfStatement" && node.await) unsupported(node, this.source, "for-await")
          const value = await this.eval(node.right, env)
          const values = node.type === "ForInStatement" ? enumerableKeys(value) : iterable(value, this.budget)
          for (let i = 0; i < values.length; i++) {
            this.budget.step()
            const scope = new Env(env)
            if (node.left.type === "VariableDeclaration")
              await this.bind(node.left.declarations[0].id, values[i], scope, node.left.kind)
            else await this.bind(node.left, values[i], scope)
            if ((await this.loopBody(node.body, scope)) === "break") break
          }
          return undefined
        }
        case "ForStatement":
        case "WhileStatement":
        case "DoWhileStatement": {
          let scope = new Env(env)
          if (node.type === "ForStatement" && node.init) await this.eval(node.init, scope)
          let first = true
          while (true) {
            this.budget.step()
            if (!(node.type === "DoWhileStatement" && first) && node.test && !truth(await this.eval(node.test, scope)))
              break
            first = false
            if ((await this.loopBody(node.body, scope)) === "break") break
            if (node.type === "ForStatement") {
              const next = new Env(env)
              for (const [name, binding] of scope.bindings) next.define(name, binding.value, binding.constant)
              scope = next
              if (node.update) await this.eval(node.update, scope)
            }
          }
          return undefined
        }
        default:
          unsupported(node, this.source)
      }
    } catch (error) {
      if (error instanceof Fault) this.fatal ??= error
      if (error instanceof Fault && error.diagnostic.line === undefined) {
        error.diagnostic.line = node.loc?.start.line
        error.diagnostic.column = node.loc?.start.column
        error.diagnostic.excerpt = this.source.slice(node.start, Math.min(node.end, node.start + 100))
      }
      throw error
    }
  }
  async loopBody(node: AnyNode, env: Env) {
    try {
      await this.eval(node, env)
    } catch (error) {
      if (error instanceof Completion && (error.type === "break" || error.type === "continue")) return error.type
      throw error
    }
  }
  async run(): Promise<string> {
    let value: Value
    const program = parseProgram(this.source, this.budget)
    this.hoist(program, this.global)
    try {
      value = await this.eval(program, this.global)
    } catch (error) {
      if (error instanceof Completion && error.type === "return") value = error.value
      else throw error
    }
    value = await this.settle(value)
    // No detached work may intentionally escape the execute lifetime. A
    // resumed async function can start a NEW tool call after the previous
    // batch settled, so keep draining until the set stays empty.
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending])
    }
    this.budget.check()
    if (this.fatal) throw this.fatal
    return serialize(value, this.budget)
  }
}

export async function execute(source: string, options: Options = {}): Promise<Result> {
  const controller = new AbortController()
  const budget = new Budget(options.limits, controller.signal, options.clock)
  const abort = () => controller.abort()
  options.signal?.addEventListener("abort", abort, { once: true })
  if (options.signal?.aborted) abort()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Fault({ error: "Aborted" }))
    controller.signal.addEventListener("abort", onAbort, { once: true })
    timer = setTimeout(() => {
      reject(new Fault({ error: "LimitExceeded", limit: "duration_ms" }))
      controller.abort()
    }, budget.limits.max_duration_ms)
  })
  try {
    budget.check()
    const interpreter = new Interpreter(source, budget, options)
    const output = await Promise.race([interpreter.run(), stopped])
    return {
      output,
      metadata: {
        toolCalls: budget.toolCalls,
        steps: budget.steps,
        durationMs: Math.max(0, budget.clock() - budget.started),
      },
    }
  } catch (error) {
    let diagnostic: Diagnostic =
      error instanceof Fault
        ? error.diagnostic
        : {
            error: "RuntimeError",
            message:
              error instanceof Completion
                ? tagged(error.value) &&
                  error.value.kind === "error" &&
                  typeof error.value.props.get("message") === "string"
                  ? (error.value.props.get("message") as string)
                  : "Uncaught script exception"
                : error instanceof Error
                  ? error.message
                  : "Execution failed",
          }
    let output = JSON.stringify(diagnostic)
    if (Buffer.byteLength(output) > budget.limits.max_result_bytes) {
      diagnostic = { error: "LimitExceeded", limit: "result_bytes" }
      output = JSON.stringify(diagnostic)
    }
    return {
      output,
      diagnostic,
      metadata: {
        toolCalls: budget.toolCalls,
        steps: budget.steps,
        durationMs: Math.max(0, budget.clock() - budget.started),
      },
    }
  } finally {
    clearTimeout(timer)
    if (onAbort) controller.signal.removeEventListener("abort", onAbort)
    options.signal?.removeEventListener("abort", abort)
    controller.abort()
  }
}
