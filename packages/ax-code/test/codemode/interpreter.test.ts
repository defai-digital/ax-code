import { describe, expect, test } from "vitest"
import { parseJsonStrict } from "@ax-code/util/json-value"
import { execute } from "../../src/codemode/interpreter"
import { Budget, LIMITS, type Limits } from "../../src/codemode/limits"

const cases: [string, string, unknown][] = [
  ["literals", "[null,true,false,12,1.5,'text']", [null, true, false, 12, 1.5, "text"]],
  ["arithmetic", "[1+2*3,10/2,7%3,2**3,1<<2,8>>1,8>>>1,1|2,3&1,3^1,~1]", [7, 5, 1, 8, 4, 4, 4, 3, 1, 2, -2]],
  ["comparison", "[1<2,2<=2,3>2,3>=3,1=='1',1==='1',1!=2,1!==2]", [true, true, true, true, true, false, true, true]],
  [
    "logical",
    "[null??2,0||3,1&&4,!0,true?5:6,typeof [],typeof (()=>1),typeof missing]",
    [2, 3, 4, true, 5, "object", "function", "undefined"],
  ],
  ["var hoisting", "x=2;var x;var x;function f(a){var a;return a}; [x,f(3)]", [2, 3]],
  ["array-like", "Array.from({length:3},(_,i)=>i)", [0, 1, 2]],
  ["bindings", "var a=1; let b=2; const c=3; a+=b; b++; [a,b,c]", [3, 3, 3]],
  [
    "destructuring",
    "let [a,,b=4,...r]=[1,2,undefined,5,6]; const {x:y,...s}={x:3,z:9}; [a,b,r,y,s]",
    [1, 4, [5, 6], 3, { z: 9 }],
  ],
  ["destructuring assignment", "let a,b; [a,b]=[2,3]; ({x:a}={x:4}); [a,b]", [4, 3]],
  ["templates", "const n=2; `value ${n+1}!`", "value 3!"],
  ["spread", "const a=[1,2]; const b={x:3}; [...a, {...b,y:4}]", [1, 2, { x: 3, y: 4 }]],
  ["if", "let x=0; if(false) x=1; else x=2; x", 2],
  ["for", "let n=0; for(let i=0;i<6;i++){if(i===2)continue;if(i===5)break;n+=i} n", 8],
  ["for-of", "let n=0; for(const v of [1,2,3])n+=v; n", 6],
  ["for-in", "let keys=[]; for(const k in {a:1,b:2})keys.push(k); keys", ["a", "b"]],
  ["while", "let i=0; while(i<3)i++; do{i--}while(i>1); i", 1],
  ["return", "1; return {ok:true}; 3", { ok: true }],
  ["functions", "function f(x){return y=>x+y}; const g=f(2); g(4)", 6],
  ["function hoisting", "const x=f(3); function f(n){return n*2}; x", 6],
  ["loop closures", "const a=[]; for(let i=0;i<3;i++)a.push(()=>i); a.map(f=>f())", [0, 1, 2]],
  ["named closure recursion", "const f=function count(n){return n?1+count(n-1):0}; f(3)", 3],
  ["rest", "function f(a,...xs){return [a,...xs]}; f(...[1,2,3])", [1, 2, 3]],
  ["plain method receiver", "const o={x:3,f(){return this.x}}; o.f()", 3],
  ["try catch finally", "let x=0; try{throw new Error('bad')}catch(e){x=e.message}finally{x+='!'} x", "bad!"],
  ["finally completion", "function f(){try{return 1}finally{return 2}}; f()", 2],
  ["optional chain", "const x=null; [x?.a.b, x?.f(), ({a:2})?.a, null??7]", [null, null, 2, 7]],
  ["logical assignment", "let x=null; x??=2; x&&=3; x||=4; x", 3],
  ["unary sequence", "let x=1; (++x,x++,void 0); [-'2',+'3',x]", [-2, 3, 3]],
  ["array callbacks", "[1,2,3,4].filter(x=>x%2===0).map(x=>x*2).reduce((a,b)=>a+b,0)", 12],
  [
    "array predicates",
    "const a=[1,2,3]; let n=0;a.forEach(x=>n+=x);[a.find(x=>x>1),a.some(x=>x>2),a.every(x=>x>0),n]",
    [2, true, true, 6],
  ],
  [
    "array operations",
    "let a=[3,1,2]; a.sort((a,b)=>a-b); a.push(4);const p=a.pop();[a.slice(1).join('-'),p,a.includes(2),a.indexOf(3),a.concat([5])]",
    ["2-3", 4, true, 2, [1, 2, 3, 5]],
  ],
  ["array own indexes", "let a=[]; a[2]=3; a.length=4; [a.length, 2 in a, 'map' in a, a[0]]", [4, true, false, null]],
  [
    "strings",
    "' A,b '.trim().toLowerCase().split(',').map(x=>x.toUpperCase()).join('-').replace('A','C').padStart(5,'0')",
    "00C-B",
  ],
  [
    "string queries",
    "['abc'.startsWith('a'),'abc'.endsWith('c'),'abc'.includes('b'),'abc'.indexOf('b'),'abc'.slice(1),'x'.repeat(3)]",
    [true, true, true, 1, "bc", "xxx"],
  ],
  [
    "objects",
    "let x={a:1};Object.assign(x,{b:2});[Object.keys(x),Object.values(x),Object.entries(x),'a' in x,'toString' in x]",
    [
      ["a", "b"],
      [1, 2],
      [
        ["a", 1],
        ["b", 2],
      ],
      true,
      false,
    ],
  ],
  ["array static", "[Array.isArray([]),Array.from('ab', x=>x+x)]", [true, ["aa", "bb"]]],
  ["JSON", "JSON.parse(JSON.stringify({x:[1,true]}))", { x: [1, true] }],
  ["Math", "[Math.max(1,4,2),Math.floor(2.8),Math.abs(-3),Math.pow(2,3),Math.PI>3]", [4, 2, 3, 8, true]],
  [
    "conversions",
    "[Number('2'),String(3),Boolean(0),parseInt('10',2),parseFloat('1.5'),Number.isNaN(NaN)]",
    [2, "3", false, 2, 1.5, true],
  ],
  [
    "Map",
    "let m=new Map([['x',1]]);m.set('y',2);[m.get('x'),m.has('y'),m.size,Array.from(m),m instanceof Map]",
    [
      1,
      true,
      2,
      [
        ["x", 1],
        ["y", 2],
      ],
      true,
    ],
  ],
  [
    "Set",
    "let s=new Set([1,1,2]);s.add(3);s.delete(1);[s.size,s.has(3),Array.from(s),s instanceof Set]",
    [2, true, [2, 3], true],
  ],
  ["Date", "new Date(0).toISOString()", "1970-01-01T00:00:00.000Z"],
  ["async functions", "async function f(n){return n+1}; await f(2)", 3],
]
describe("Code Mode language", () => {
  test.each(cases)("%s", async (_, source, expected) => {
    const result = await execute(source)
    expect(result.diagnostic).toBeUndefined()
    expect(parseJsonStrict(result.output)).toEqual(expected)
    expect(result.metadata.steps).toBeGreaterThan(0)
  })
  test("only an injected clock is visible", async () => {
    expect((await execute("Date.now()")).diagnostic?.error).toBe("RuntimeError")
    expect((await execute("Date.now()", { clock: () => 123 })).output).toBe("123")
  })
  test("constant assignment is catchable", async () => {
    expect((await execute("const x=1; try{x=2}catch(e){return e.message}")).output).toContain("constant")
  })
})

const unsupported = [
  "this",
  "(()=>this)()",
  "class A {}",
  "function* f(){yield 1}",
  "async function* f(){yield 1}",
  "import x from 'x'",
  "export const x=1",
  "import('fs')",
  "new Object()",
  "({get x(){return 1}})",
  "({set x(v){}})",
  "with({}){}",
  "label: while(true)break label",
  "/(a+)+$/",
  "1n",
  "String.raw`x`",
  "delete ({x:1}).x",
]
test.each(unsupported)("unsupported syntax: %s", async (source) => {
  const result = await execute(source)
  expect(result.diagnostic?.error).toBe("UnsupportedSyntax")
  expect(result.diagnostic?.line).toBeGreaterThan(0)
  expect(result.diagnostic?.column).toBeGreaterThanOrEqual(0)
  expect(result.diagnostic?.excerpt).toBeTruthy()
})

test.each(["__proto__", "constructor", "prototype"])("forbidden properties: %s", async (name) => {
  for (const source of [
    `({}).${name}`,
    `({})['${name}']`,
    `const k='${name}'; ({})[k]`,
    `const {${name}: x}={};x`,
    `const {['${name}']:x}={};x`,
    `({...{['${name}']:1}})`,
    `({})?.['${name}']`,
    `null?.['${name}']`,
    `JSON.parse('{"${name}":1}')`,
    `const x={};x['${name}']=1`,
    `'${name}' in {}`,
  ])
    expect((await execute(source)).diagnostic?.error, source).toBe("UnsupportedSyntax")
})
test.each([
  "globalThis",
  "process",
  "require",
  "Function",
  "eval",
  "Symbol",
  "Proxy",
  "Reflect",
  "setTimeout",
  "setInterval",
  "fetch",
])("no host global: %s", async (name) => {
  expect((await execute(`typeof ${name}`)).output).toBe('"undefined"')
})
test("host objects, accessors and functions cannot cross the tool boundary", async () => {
  for (const result of [
    new Date(),
    new Error("secret"),
    () => 1,
    {
      get secret() {
        throw new Error("accessor ran")
      },
    },
  ]) {
    const output = await execute("await tools.read({})", { tools: ["read"], dispatch: async () => result })
    expect(output.diagnostic?.error).toBe("RuntimeError")
    expect(output.output).not.toContain("accessor ran")
  }
})
test("tool data is copied and its prototype is inaccessible", async () => {
  const value = { nested: { n: 1 } }
  const result = await execute("const x=await tools.read({});x.nested.n=2;[x.nested.n,typeof x.toString]", {
    tools: ["read"],
    dispatch: async () => value,
  })
  expect(result.output).toBe('[2,"undefined"]')
  expect(value.nested.n).toBe(1)
})

test.each<[string, string, Partial<Limits>]>([
  ["steps", "while(true){}", { max_steps: 1000 }],
  ["duration_ms", "while(true){}", { max_duration_ms: 5 }],
  ["ast_depth", "[[[[[[1]]]]]]", { max_ast_depth: 5 }],
  ["call_depth", "function f(){return f()};f()", { max_call_depth: 3 }],
  ["collection_size", "[1,2,3]", { max_collection_size: 2 }],
  ["collection_size", "Array.from({length:1000000000})", {}],
  ["collection_size", "new Map([[1,1],[2,2],[3,3]])", { max_collection_size: 2 }],
  ["string_bytes", "'a'.repeat(1000)", { max_string_bytes: 10 }],
  ["source_bytes", "1+2+3+4+5", { max_source_bytes: 5 }],
  ["result_bytes", "[1,2,3]", { max_result_bytes: 5 }],
  ["heap_units", "while(true){const a=[1,2,3]}", { max_heap_units: 100 }],
  ["collection_size", "let a=[];a.length=1000000000;a", {}],
  ["collection_size", "let a=[];a[1000000000]=1;a", {}],
  ["string_bytes", "'a'.padStart(1000000000)", {}],
])("limit %s for %s", async (limit, source, limits) => {
  expect((await execute(source, { limits })).diagnostic).toMatchObject({ error: "LimitExceeded", limit })
})
test("limit failures cannot be swallowed by catch or finally", async () => {
  for (const source of [
    "try{while(true){}}catch(e){return 1}",
    "try{while(true){}}finally{return 1}",
    "try{'x'.repeat(100000000)}finally{return 1}",
  ])
    expect((await execute(source, { limits: { max_steps: 1000 } })).diagnostic?.error).toBe("LimitExceeded")
})
test("limits can only be lowered", () => {
  const budget = new Budget({ max_steps: Infinity, max_duration_ms: 999999, max_tool_calls: 300 })
  expect(budget.limits).toEqual(LIMITS)
})
test("cyclic and exponentially expanded results are bounded", async () => {
  expect((await execute("let x={};x.x=x;x")).diagnostic?.error).toBe("RuntimeError")
  expect(
    (await execute("let x=[1];for(let i=0;i<25;i++)x=[x,x];x", { limits: { max_result_bytes: 1000 } })).diagnostic
      ?.limit,
  ).toBe("result_bytes")
})
test("abort interrupts CPU loops and pending tools", async () => {
  for (const code of ["while(true){}", "await tools.read({})"]) {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 5)
    const result = await execute(code, {
      signal: abort.signal,
      tools: ["read"],
      dispatch: async () => new Promise(() => {}),
    })
    clearTimeout(timer)
    expect(result.diagnostic?.error).toBe("Aborted")
  }
  const abort = new AbortController()
  abort.abort()
  expect((await execute("1", { signal: abort.signal })).diagnostic?.error).toBe("Aborted")
})
test("tool timeout aborts the underlying signal", async () => {
  let signal: AbortSignal | undefined
  const result = await execute("await tools.read({})", {
    limits: { max_duration_ms: 10 },
    tools: ["read"],
    dispatch: async (_, __, s) => {
      signal = s
      return new Promise(() => {})
    },
  })
  expect(result.diagnostic?.limit).toBe("duration_ms")
  expect(signal?.aborted).toBe(true)
})

test("tight collection limits apply to script values, not the fixed builtin catalog", async () => {
  expect((await execute("1", { limits: { max_collection_size: 1 } })).output).toBe("1")
})
test("unawaited async recursion cannot hide a fatal limit", async () => {
  expect(
    (await execute("async function f(){f()};f();return 1", { limits: { max_call_depth: 4 } })).diagnostic?.limit,
  ).toBe("call_depth")
})

test.each(["JSON.parse('{\"constructor\":1}')", "await tools.read({})", "const k='proto'+'type';({})[k]"])(
  "dynamic forbidden access reports source location: %s",
  async (source) => {
    const result = await execute(source, { tools: ["read"], dispatch: async () => ({ constructor: 1 }) })
    expect(result.diagnostic).toMatchObject({ error: "UnsupportedSyntax", line: 1 })
    expect(result.diagnostic?.column).toBeGreaterThanOrEqual(0)
    expect(result.diagnostic?.excerpt).toBeTruthy()
  },
)
test("closure internals and builtin implementations are inaccessible", async () => {
  expect(
    (
      await execute("const f=()=>1;[f.env,f.node,f.kind,Math.max.name,Math.max.call,tools.read.receiver]", {
        tools: ["read"],
      })
    ).output,
  ).toBe("[null,null,null,null,null,null]")
})
test("object and Map growth stop at collection ceilings", async () => {
  for (const source of ["let o={};for(let i=0;i<4;i++)o[i]=i;o", "let m=new Map();for(let i=0;i<4;i++)m.set(i,i);m"])
    expect((await execute(source, { limits: { max_collection_size: 3 } })).diagnostic?.limit).toBe("collection_size")
})

test("string replacement expansion is bounded before allocation", async () => {
  const result = await execute(`'abc'.replace('b',"$&-$$-$` + "`" + `-$'")`)
  expect(result.output).toBe('"ab-$-a-cc"')
  expect(
    (await execute(`'x'.repeat(1000).replace('x',"$'".repeat(1000))`, { limits: { max_string_bytes: 3000 } }))
      .diagnostic?.limit,
  ).toBe("string_bytes")
})
test("a finally return cannot swallow a diagnostic raised by a catch body", async () => {
  const result = await execute("const k='proto'+'type';try{throw 1}catch(e){({})[k]}finally{return 1}")
  expect(result.diagnostic?.error).toBe("UnsupportedSyntax")
})

test("error diagnostics obey the result cap with a fixed limit envelope", async () => {
  const result = await execute("throw new Error('x'.repeat(1000))", { limits: { max_result_bytes: 100 } })
  expect(result.diagnostic).toEqual({ error: "LimitExceeded", limit: "result_bytes" })
  expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(100)
})

test("property names obey the string budget, including tool result keys", async () => {
  expect((await execute("({longName:1})", { limits: { max_string_bytes: 4 } })).diagnostic?.limit).toBe("string_bytes")
  expect(
    (
      await execute("await tools.read({})", {
        limits: { max_string_bytes: 10 },
        tools: ["read"],
        dispatch: async () => ({ ["x".repeat(100)]: 1 }),
      })
    ).diagnostic?.limit,
  ).toBe("string_bytes")
})

test("throwing a script error with a non-string message never throws a host error", async () => {
  const result = await execute("const e=new Error('x');e.message=()=>1;throw e")
  expect(result.diagnostic).toMatchObject({ error: "RuntimeError", message: "Uncaught script exception" })
})
