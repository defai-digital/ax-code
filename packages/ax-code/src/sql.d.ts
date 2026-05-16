declare module "*.sql" {
  const content: string
  export default content
}

declare module "*.wasm" {
  // Bun's `with { type: "file" }` import returns a path string to the asset.
  const path: string
  export default path
}
