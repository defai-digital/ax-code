import { parseJsonStrict } from "@ax-code/util/json-value"
import type { Budget } from "./limits"
import {
  array,
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
  type Builtin,
  type Value,
} from "./values"

/**
 * Array.prototype.join's String(element): a nested array joins with "," and
 * a cycle back to an enclosing array renders as "", as in JavaScript. Other
 * objects keep Code Mode's no-implicit-coercion rule.
 */
function joinPart(value: Value, seen: Set<Value>): string {
  if (value == null) return ""
  if (!tagged(value) || value.kind !== "array") return str(value)
  if (seen.has(value)) return ""
  seen.add(value)
  const output = value.items.map((item) => joinPart(item, seen)).join(",")
  seen.delete(value)
  return output
}

export interface Runtime {
  budget: Budget
  call(fn: Value, args: Value[], receiver?: Value): Promise<Value>
  settle(value: Value): Promise<Value>
  clock?: () => number
}
const math: Record<string, (...args: number[]) => number> = Object.assign(Object.create(null), {
  abs: Math.abs,
  acos: Math.acos,
  acosh: Math.acosh,
  asin: Math.asin,
  asinh: Math.asinh,
  atan: Math.atan,
  atanh: Math.atanh,
  atan2: Math.atan2,
  cbrt: Math.cbrt,
  ceil: Math.ceil,
  clz32: Math.clz32,
  cos: Math.cos,
  cosh: Math.cosh,
  exp: Math.exp,
  expm1: Math.expm1,
  floor: Math.floor,
  fround: Math.fround,
  hypot: Math.hypot,
  imul: Math.imul,
  log: Math.log,
  log1p: Math.log1p,
  log2: Math.log2,
  log10: Math.log10,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sinh: Math.sinh,
  sqrt: Math.sqrt,
  tan: Math.tan,
  tanh: Math.tanh,
  trunc: Math.trunc,
})
const methods = {
  array: new Set([
    "map",
    "filter",
    "reduce",
    "forEach",
    "find",
    "some",
    "every",
    "includes",
    "indexOf",
    "slice",
    "join",
    "push",
    "pop",
    "sort",
    "concat",
    "reverse",
    "at",
    "keys",
    "values",
    "entries",
  ]),
  string: new Set([
    "includes",
    "indexOf",
    "slice",
    "split",
    "trim",
    "trimStart",
    "trimEnd",
    "toLowerCase",
    "toUpperCase",
    "replace",
    "startsWith",
    "endsWith",
    "padStart",
    "padEnd",
    "concat",
    "charAt",
    "charCodeAt",
    "at",
    "substring",
    "repeat",
  ]),
  map: new Set(["get", "set", "has", "delete", "clear", "keys", "values", "entries", "forEach"]),
  set: new Set(["add", "has", "delete", "clear", "keys", "values", "entries", "forEach"]),
  date: new Set(["getTime", "toISOString", "toJSON"]),
}
const statics: Record<string, readonly string[]> = {
  Object: ["keys", "values", "entries", "assign"],
  Array: ["isArray", "from"],
  JSON: ["stringify", "parse"],
  Promise: ["all"],
  Date: ["now"],
  Number: ["isFinite", "isInteger", "isNaN", "isSafeInteger"],
}
export function globals(budget: Budget) {
  const result = new Map<string, Value>([
    ["undefined", undefined],
    ["NaN", NaN],
    ["Infinity", Infinity],
  ])
  for (const name of [
    "Object",
    "Array",
    "JSON",
    "Promise",
    "Date",
    "Map",
    "Set",
    "Error",
    "Number",
    "String",
    "Boolean",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
  ])
    result.set(name, builtin(name))
  result.set("Math", builtin("Math"))
  return result
}
export function get(value: Value, name: string): Value {
  key(name)
  if (value === null || value === undefined) throw new Error("Cannot read property of null or undefined")
  if (typeof value === "string") {
    if (name === "length") return value.length
    if (/^(0|[1-9][0-9]*)$/.test(name)) return value[Number(name)]
    if (methods.string.has(name)) return builtin(`string.${name}`, value)
    return undefined
  }
  if (!tagged(value)) return undefined
  if (value.kind === "object" || value.kind === "error") return value.props.get(name)
  if (value.kind === "builtin") {
    if (value.name === "Math") {
      if (Object.hasOwn(math, name)) return builtin(`Math.${name}`)
      const constants: Record<string, number> = {
        E: Math.E,
        PI: Math.PI,
        LN2: Math.LN2,
        LN10: Math.LN10,
        LOG2E: Math.LOG2E,
        LOG10E: Math.LOG10E,
        SQRT1_2: Math.SQRT1_2,
        SQRT2: Math.SQRT2,
      }
      return Object.hasOwn(constants, name) ? constants[name] : undefined
    }
    if (statics[value.name]?.includes(name)) return builtin(`${value.name}.${name}`)
    return undefined
  }
  if (value.kind === "array") {
    if (name === "length") return value.items.length
    if (/^(0|[1-9][0-9]*)$/.test(name)) return value.items[Number(name)]
  }
  if (value.kind === "map" && name === "size") return value.entries.length
  if (value.kind === "set" && name === "size") return value.items.length
  if (
    (value.kind === "array" || value.kind === "map" || value.kind === "set" || value.kind === "date") &&
    methods[value.kind].has(name)
  )
    return builtin(`${value.kind}.${name}`, value)
  return undefined
}
export function set(value: Value, name: string, item: Value, budget: Budget): Value {
  key(name)
  if (tagged(value) && (value.kind === "object" || value.kind === "error")) {
    if (!value.props.has(name)) {
      budget.string(name)
      budget.size(value.props.size + 1)
      budget.allocate(1)
    }
    value.props.set(name, item)
    return item
  }
  if (tagged(value) && value.kind === "array") {
    if (name === "length") {
      const size = num(item)
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid array length")
      budget.size(size)
      budget.allocate(Math.max(0, size - value.items.length))
      while (value.items.length < size) value.items.push(undefined)
      value.items.length = size
      return item
    }
    if (/^(0|[1-9][0-9]*)$/.test(name)) {
      const index = Number(name)
      budget.size(index + 1)
      budget.allocate(Math.max(0, index + 1 - value.items.length))
      while (value.items.length <= index) value.items.push(undefined)
      value.items[index] = item
      return item
    }
  }
  throw new Error("Only plain object and array properties are writable")
}
export function iterable(value: Value, budget: Budget): Value[] {
  if (typeof value === "string") {
    budget.size(value.length)
    return [...value]
  }
  if (tagged(value)) {
    if (value.kind === "array" || value.kind === "set") return value.items
    if (value.kind === "map") return value.entries.map((entry) => list([...entry], budget))
  }
  throw new Error("Expected an array, string, Map or Set")
}
const same = (a: Value, b: Value) =>
  a === b || (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b))
export async function invoke(fn: Builtin, args: Value[], rt: Runtime): Promise<Value> {
  const b = rt.budget
  const [first, second] = args
  b.step()
  const text = (v: string) => b.string(v)
  switch (fn.name) {
    case "Number":
      return args.length ? num(first) : 0
    case "String":
      return text(args.length ? str(first) : "")
    case "Boolean":
      return truth(first)
    case "parseInt":
      return parseInt(str(first), second === undefined ? undefined : num(second))
    case "parseFloat":
      return parseFloat(str(first))
    case "isNaN":
      return Number.isNaN(num(first))
    case "isFinite":
      return Number.isFinite(num(first))
    case "Number.isNaN":
      return typeof first === "number" && Number.isNaN(first)
    case "Number.isFinite":
      return typeof first === "number" && Number.isFinite(first)
    case "Number.isInteger":
      return typeof first === "number" && Number.isInteger(first)
    case "Number.isSafeInteger":
      return typeof first === "number" && Number.isSafeInteger(first)
    case "Error":
      return record([["message", text(first === undefined ? "" : str(first))]], b, "error")
    case "Date.now":
      if (!rt.clock) throw new Error("Clock is unavailable")
      return rt.clock()
    case "Date": {
      if (first === undefined && !rt.clock) throw new Error("Clock is unavailable")
      const time =
        first === undefined ? rt.clock!() : typeof first === "string" ? new Date(first).getTime() : num(first)
      b.allocate(1)
      return { kind: "date", time }
    }
    case "Map": {
      const entries: [Value, Value][] = []
      for (const entry of first == null ? [] : iterable(first, b)) {
        b.step(entries.length + 1)
        const pair = array(entry)
        const old = entries.find((item) => same(item[0], pair[0]))
        if (old) old[1] = pair[1]
        else {
          b.size(entries.length + 1)
          b.allocate(2)
          entries.push([pair[0], pair[1]])
        }
      }
      return { kind: "map", entries }
    }
    case "Set": {
      const items: Value[] = []
      for (const entry of first == null ? [] : iterable(first, b)) {
        b.step(items.length + 1)
        if (!items.some((item) => same(item, entry))) {
          b.size(items.length + 1)
          b.allocate(1)
          items.push(entry)
        }
      }
      return { kind: "set", items }
    }
    case "Object.keys":
      return list([...object(first).keys()], b)
    case "Object.values":
      return list([...object(first).values()], b)
    case "Object.entries":
      return list(
        [...object(first)].map(([k, v]) => list([k, v], b)),
        b,
      )
    case "Object.assign": {
      object(first)
      for (const source of args.slice(1))
        for (const [k, v] of object(source)) {
          b.step()
          set(first, key(k), v, b)
        }
      return first
    }
    case "Array.isArray":
      return tagged(first) && first.kind === "array"
    case "Array.from": {
      const items: Value[] = []
      const source =
        tagged(first) && first.kind === "object"
          ? (() => {
              const length = Math.max(0, Math.floor(num(first.props.get("length") ?? 0)))
              if (!Number.isFinite(length)) b.fail("collection_size")
              b.size(length)
              b.allocate(length)
              const items: Value[] = []
              for (let i = 0; i < length; i++) items.push(first.props.get(String(i)))
              return items
            })()
          : iterable(first, b)
      b.size(source.length)
      for (let i = 0; i < source.length; i++) {
        b.step()
        items.push(second === undefined ? source[i] : await rt.call(second, [source[i], i]))
      }
      return list(items, b)
    }
    case "JSON.parse":
      return copyIn(parseJsonStrict(str(first)), b)
    case "JSON.stringify":
      return text(serialize(first, b))
    case "Promise.all": {
      const items = array(first)
      return { kind: "promise", promise: Promise.all(items.map((v) => rt.settle(v))).then((values) => list(values, b)) }
    }
  }
  if (fn.name.startsWith("Math.")) {
    const method = math[fn.name.slice(5)]
    if (!method) throw new Error("Unsupported Math operation")
    b.step(args.length)
    // Host spread arguments have a lower engine-specific ceiling than collections.
    if (args.length > 1024) b.fail("collection_size")
    return method(...args.map(num))
  }
  const receiver = fn.receiver
  const name = fn.name.slice(fn.name.indexOf(".") + 1)
  if (typeof receiver === "string") {
    b.step(Math.max(1, Math.ceil(receiver.length / 128)))
    const start = () => (first === undefined ? 0 : num(first))
    const end = () => (second === undefined ? undefined : num(second))
    switch (name) {
      case "includes":
        return receiver.includes(str(first), second === undefined ? 0 : num(second))
      case "indexOf":
        return receiver.indexOf(str(first), second === undefined ? 0 : num(second))
      case "startsWith":
        return receiver.startsWith(str(first), second === undefined ? 0 : num(second))
      case "endsWith":
        return receiver.endsWith(str(first), end())
      case "slice":
        return text(receiver.slice(start(), end()))
      case "substring":
        return text(receiver.substring(start(), end()))
      case "at":
        return receiver.at(start())
      case "charAt":
        return receiver.charAt(start())
      case "charCodeAt":
        return receiver.charCodeAt(start())
      case "trim":
        return text(receiver.trim())
      case "trimStart":
        return text(receiver.trimStart())
      case "trimEnd":
        return text(receiver.trimEnd())
      case "toLowerCase":
        return text(receiver.toLowerCase())
      case "toUpperCase":
        return text(receiver.toUpperCase())
      case "replace": {
        if (typeof first !== "string" || typeof second !== "string") throw new Error("replace accepts strings only")
        const index = receiver.indexOf(first)
        if (index < 0) return receiver
        const prefix = receiver.slice(0, index)
        const suffix = receiver.slice(index + first.length)
        const chunks: string[] = []
        let bytes = 0
        const append = (part: string) => {
          bytes += Buffer.byteLength(part)
          if (bytes > b.limits.max_string_bytes) b.fail("string_bytes")
          b.size(chunks.length + 1)
          chunks.push(part)
        }
        append(prefix)
        let cursor = 0
        // Expand replacement tokens ourselves. Repeated $'/$` tokens can
        // multiply a small replacement into an enormous host allocation.
        while (cursor < second.length) {
          b.step()
          const dollar = second.indexOf("$", cursor)
          if (dollar < 0) {
            append(second.slice(cursor))
            break
          }
          append(second.slice(cursor, dollar))
          const token = second[dollar + 1]
          if (token === "$" || token === "&" || token === "`" || token === "'") {
            append(token === "$" ? "$" : token === "&" ? first : token === "`" ? prefix : suffix)
            cursor = dollar + 2
          } else {
            append("$")
            cursor = dollar + 1
          }
        }
        append(suffix)
        return text(chunks.join(""))
      }
      case "split": {
        const limit =
          second === undefined
            ? b.limits.max_collection_size + 1
            : Math.min(num(second) >>> 0, b.limits.max_collection_size + 1)
        const parts = first === undefined ? (limit ? [receiver] : []) : receiver.split(str(first), limit)
        b.size(parts.length)
        return list(parts.map(text), b)
      }
      case "repeat": {
        const count = num(first)
        if (!Number.isFinite(count) || count < 0) throw new Error("Invalid repeat count")
        if (Buffer.byteLength(receiver) * Math.floor(count) > b.limits.max_string_bytes) b.fail("string_bytes")
        return text(receiver.repeat(count))
      }
      case "padStart":
      case "padEnd": {
        const length = num(first)
        if (!Number.isFinite(length) || length > b.limits.max_string_bytes) b.fail("string_bytes")
        const fill = second === undefined ? " " : str(second)
        if (length * Math.max(1, Buffer.byteLength(fill) / Math.max(1, fill.length)) > b.limits.max_string_bytes)
          b.fail("string_bytes")
        return text(name === "padStart" ? receiver.padStart(length, fill) : receiver.padEnd(length, fill))
      }
      case "concat": {
        let output = receiver
        for (const item of args) {
          const part = str(item)
          if (output.length + part.length > b.limits.max_string_bytes) b.fail("string_bytes")
          output = text(output + part)
        }
        return output
      }
    }
  }
  if (tagged(receiver) && receiver.kind === "array") {
    const items = receiver.items
    const length = items.length
    b.step(length + 1)
    switch (name) {
      case "push":
        b.size(length + args.length)
        b.allocate(args.length)
        for (const item of args) items.push(item)
        return items.length
      case "pop":
        return items.pop()
      case "reverse":
        items.reverse()
        return receiver
      case "at":
        return items.at(num(first))
      case "includes":
        return items.slice(second === undefined ? 0 : num(second)).some((item) => same(item, first))
      case "indexOf":
        return items.indexOf(first, second === undefined ? 0 : num(second))
      case "slice":
        return list(
          items.slice(first === undefined ? 0 : num(first), second === undefined ? undefined : num(second)),
          b,
        )
      case "values":
        return list([...items], b)
      case "keys":
        return list(
          items.map((_, i) => i),
          b,
        )
      case "entries":
        return list(
          items.map((item, i) => list([i, item], b)),
          b,
        )
      case "concat": {
        const output = [...items]
        for (const item of args) {
          const more = tagged(item) && item.kind === "array" ? item.items : [item]
          b.size(output.length + more.length)
          for (const value of more) output.push(value)
        }
        return list(output, b)
      }
      case "join": {
        const separator = first === undefined ? "," : str(first)
        let output = ""
        for (let i = 0; i < length; i++) {
          const part = joinPart(items[i], new Set([receiver]))
          if (output.length + part.length + (i ? separator.length : 0) > b.limits.max_string_bytes)
            b.fail("string_bytes")
          output += (i ? separator : "") + part
        }
        return text(output)
      }
      case "sort": {
        // Stable bottom-up merge sort: comparator work counts towards steps and
        // can never invoke a host callback or recurse on the host stack.
        let source = [...items]
        for (let width = 1; width < length; width *= 2) {
          const target: Value[] = []
          b.allocate(length)
          for (let left = 0; left < length; left += 2 * width) {
            let i = left,
              j = Math.min(left + width, length)
            const mid = j,
              end = Math.min(left + 2 * width, length)
            while (i < mid || j < end) {
              b.step()
              const cmp =
                i < mid && j < end
                  ? first === undefined
                    ? str(source[i]) <= str(source[j])
                      ? -1
                      : 1
                    : num(await rt.call(first, [source[i], source[j]]))
                  : 0
              target.push(j >= end || (i < mid && cmp <= 0) ? source[i++] : source[j++])
            }
          }
          source = target
        }
        for (let i = 0; i < length; i++) items[i] = source[i]
        return receiver
      }
      case "map":
      case "filter":
      case "forEach":
      case "find":
      case "some":
      case "every":
      case "reduce": {
        const output: Value[] = []
        let accumulator = second
        let start = 0
        if (name === "reduce" && args.length < 2) {
          if (!length) throw new Error("Reduce of empty array without initial value")
          accumulator = items[0]
          start = 1
        }
        for (let i = start; i < length; i++) {
          b.step()
          const value = items[i]
          // The second argument is thisArg for every callback method except
          // reduce, where it is the initial accumulator.
          const result = await rt.call(
            first,
            name === "reduce" ? [accumulator, value, i, receiver] : [value, i, receiver],
            name === "reduce" ? undefined : second,
          )
          if (name === "map") output.push(result)
          if (name === "filter" && truth(result)) output.push(value)
          if (name === "find" && truth(result)) return value
          if (name === "some" && truth(result)) return true
          if (name === "every" && !truth(result)) return false
          if (name === "reduce") accumulator = result
        }
        if (name === "reduce") return accumulator
        if (name === "some") return false
        if (name === "every") return true
        if (name === "find" || name === "forEach") return undefined
        return list(output, b)
      }
    }
  }
  if (tagged(receiver) && (receiver.kind === "map" || receiver.kind === "set")) {
    const entries: [Value, Value][] =
      receiver.kind === "map" ? receiver.entries : receiver.items.map((value) => [value, value])
    b.step(entries.length + 1)
    const index = entries.findIndex(([k]) => same(k, first))
    switch (name) {
      case "get":
        return index < 0 ? undefined : entries[index][1]
      case "has":
        return index >= 0
      case "set":
      case "add": {
        if (index < 0) {
          b.size(entries.length + 1)
          b.allocate(2)
        }
        if (receiver.kind === "map") {
          if (index < 0) receiver.entries.push([first, second])
          else receiver.entries[index][1] = second
        } else if (index < 0) receiver.items.push(first)
        return receiver
      }
      case "delete":
        if (index < 0) return false
        if (receiver.kind === "map") receiver.entries.splice(index, 1)
        else receiver.items.splice(index, 1)
        return true
      case "clear":
        if (receiver.kind === "map") receiver.entries.length = 0
        else receiver.items.length = 0
        return undefined
      case "keys":
        return list(
          entries.map(([k]) => k),
          b,
        )
      case "values":
        return list(
          entries.map(([, v]) => v),
          b,
        )
      case "entries":
        return list(
          entries.map((pair) => list([...pair], b)),
          b,
        )
      case "forEach":
        for (const [k, v] of entries) {
          b.step()
          await rt.call(first, [v, k, receiver])
        }
        return undefined
    }
  }
  if (tagged(receiver) && receiver.kind === "date") {
    if (name === "getTime") return receiver.time
    if (name === "toISOString") return text(new Date(receiver.time).toISOString())
    if (name === "toJSON") return new Date(receiver.time).toJSON()
  }
  throw new Error(`Unsupported builtin: ${fn.name}`)
}
