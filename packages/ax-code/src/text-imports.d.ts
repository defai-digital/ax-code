// Tools import their prompt/description text as `import D from "./x.txt"`.
// Bun loads `.txt` as a string; the Node build and vitest both apply a text loader.
declare module "*.txt" {
  const content: string
  export default content
}
