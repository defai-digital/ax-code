import type { AnyNode } from "acorn"
import { Budget, Fault } from "./limits"
import { forbiddenKeys } from "./parser"

export type Primitive = undefined | null | boolean | number | string
export type Value = Primitive | Data | Closure | Builtin | Pending
export type Data =
  | { kind: "object" | "error"; props: Map<string, Value> }
  | { kind: "array" | "set"; items: Value[] }
  | { kind: "map"; entries: [Value, Value][] }
  | { kind: "date"; time: number }
export type Closure = { kind: "closure"; node: AnyNode; env: Env; arrow: boolean; async: boolean }
export type Builtin = { kind: "builtin"; name: string; receiver?: Value }
export type Pending = { kind: "promise"; promise: Promise<Value> }
export const builtin = (name: string, receiver?: Value): Builtin => ({ kind: "builtin", name, receiver })
export function tagged(value: Value): value is Exclude<Value, Primitive> {
  return value !== null && typeof value === "object"
}
export function key(value: Value): string {
  if (tagged(value)) throw new Error("Property keys must be primitive values")
  const result = String(value)
  if (forbiddenKeys.has(result))
    throw new Fault({ error: "UnsupportedSyntax", message: `Forbidden property: ${result}` })
  return result
}
export function primitive(value: Value): Primitive {
  if (tagged(value)) throw new Error("Implicit object coercion is unsupported")
  return value
}
export const str = (value: Value) => String(primitive(value))
export const num = (value: Value) => Number(primitive(value))
export const truth = (value: Value) => !!value
export function array(value: Value): Value[] {
  if (!tagged(value) || value.kind !== "array") throw new Error("Expected an array")
  return value.items
}
export function object(value: Value): Map<string, Value> {
  if (!tagged(value) || (value.kind !== "object" && value.kind !== "error")) throw new Error("Expected a plain object")
  return value.props
}
export function list(items: Value[], budget: Budget): Data {
  budget.size(items.length)
  budget.allocate(items.length + 1)
  return { kind: "array", items }
}
export function record(entries: [string, Value][], budget: Budget, kind: "object" | "error" = "object"): Data {
  budget.size(entries.length)
  budget.allocate(entries.length + 1)
  for (const [name] of entries) {
    key(name)
    budget.string(name)
  }
  return { kind, props: new Map(entries) }
}
export class Env {
  readonly bindings = new Map<string, { value: Value; constant: boolean }>()
  constructor(
    readonly parent?: Env,
    readonly functionScope = false,
    readonly thisValue?: Value,
    readonly receiverScope = false,
  ) {}
  define(name: string, value: Value, constant = false, variable = false): void {
    if (variable && !this.functionScope && this.parent) return this.parent.define(name, value, constant, true)
    const old = this.bindings.get(name)
    if (old) {
      if (variable && !old.constant) {
        old.value = value
        return
      }
      throw new Error(`Duplicate binding: ${name}`)
    }
    this.bindings.set(name, { value, constant })
  }
  get(name: string): Value {
    if (this.bindings.has(name)) return this.bindings.get(name)!.value
    return this.parent?.get(name)
  }
  set(name: string, value: Value): void {
    const binding = this.bindings.get(name)
    if (!binding) {
      if (this.parent) return this.parent.set(name, value)
      throw new Error(`Undefined binding: ${name}`)
    }
    if (binding.constant) throw new Error(`Cannot assign to constant: ${name}`)
    binding.value = value
  }
  hasReceiver(): boolean {
    return this.receiverScope || (this.parent?.hasReceiver() ?? false)
  }
  receiver(): Value {
    if (this.functionScope) return this.thisValue
    return this.parent?.receiver()
  }
}

/** Import only bounded JSON data, never host functions, accessors, prototypes or errors. */
export function copyIn(value: unknown, budget: Budget, depth = 0, seen = new Set<object>()): Value {
  budget.step()
  if (depth > budget.limits.max_ast_depth) budget.fail("ast_depth")
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return budget.string(value)
  if (typeof value !== "object") throw new Error("Only plain JSON tool values are supported")
  if (seen.has(value)) throw new Error("Cyclic tool result")
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error("Non-JSON host object refused")
  seen.add(value)
  try {
    const keys = Object.keys(value)
    budget.size(keys.length)
    if (Array.isArray(value)) budget.size(value.length)
    const entries: [string, Value][] = []
    for (const name of keys) {
      key(name)
      const descriptor = Object.getOwnPropertyDescriptor(value, name)!
      if (!Object.hasOwn(descriptor, "value")) throw new Error("Host accessor refused")
      entries.push([name, copyIn(descriptor.value, budget, depth + 1, seen)])
    }
    if (Array.isArray(value)) {
      const items: Value[] = []
      budget.allocate(value.length)
      for (let i = 0; i < value.length; i++) items.push(undefined)
      for (const [name, item] of entries) {
        if (!/^(0|[1-9][0-9]*)$/.test(name)) throw new Error("Non-JSON array property")
        items[Number(name)] = item
      }
      return list(items, budget)
    }
    return record(entries, budget)
  } finally {
    seen.delete(value)
  }
}

/** Streaming-size accounting bounds expansion of aliases and cycles before JSON.stringify. */
export function serialize(value: Value, budget: Budget): string {
  const chunks: string[] = []
  let bytes = 0
  const seen = new Set<object>()
  const emit = (text: string) => {
    bytes += Buffer.byteLength(text)
    if (bytes > budget.limits.max_result_bytes) budget.fail("result_bytes")
    chunks.push(text)
  }
  const visit = (value: Value, depth: number) => {
    budget.step()
    if (depth > budget.limits.max_ast_depth) budget.fail("ast_depth")
    if (!tagged(value)) {
      emit(JSON.stringify(value ?? null))
      return
    }
    if (seen.has(value)) throw new Error("Cyclic result is not JSON")
    seen.add(value)
    try {
      if (value.kind === "array") {
        emit("[")
        value.items.forEach((item, index) => {
          if (index) emit(",")
          visit(item, depth + 1)
        })
        emit("]")
      } else if (value.kind === "object" || value.kind === "error") {
        emit("{")
        let index = 0
        for (const [name, item] of value.props) {
          key(name)
          if (item === undefined) continue
          if (index++) emit(",")
          emit(JSON.stringify(name))
          emit(":")
          visit(item, depth + 1)
        }
        emit("}")
      } else if (value.kind === "map" || value.kind === "set") emit("{}")
      else if (value.kind === "date") emit(JSON.stringify(new Date(value.time).toJSON()))
      else throw new Error("Functions and unawaited promises cannot cross the JSON boundary")
    } finally {
      seen.delete(value)
    }
  }
  visit(value, 0)
  return chunks.join("")
}
