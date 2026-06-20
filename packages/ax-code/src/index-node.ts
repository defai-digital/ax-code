import { installNodeBunCompat } from "./bun/node-compat"

installNodeBunCompat()

const { hooks, run } = await import("./cli/boot-node")

hooks()
await run()
