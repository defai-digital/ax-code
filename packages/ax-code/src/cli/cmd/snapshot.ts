import type { Argv } from "yargs"
import { UI } from "../ui"
import { confirmDestructiveAction } from "../confirm-destructive"
import { cmd } from "./cmd"
import { jsonOption, writeJson } from "./json-output"
import type { SnapshotStores } from "../../snapshot/stores"
import { formatStorageBytes } from "../../storage/policy"

const DAY_MS = 24 * 60 * 60 * 1000

function age(ms: number, now: number) {
  if (!ms) return "never"
  const days = Math.floor((now - ms) / DAY_MS)
  if (days >= 1) return `${days}d`
  const hours = Math.floor((now - ms) / (60 * 60 * 1000))
  return hours >= 1 ? `${hours}h` : "<1h"
}

function table(stores: SnapshotStores.Store[], now: number) {
  const rows = stores.map((store) => [
    formatStorageBytes(store.bytes),
    store.garbageBytes ? formatStorageBytes(store.garbageBytes) : "-",
    String(store.refs),
    age(store.lastActivity, now),
    store.state,
    store.worktree ?? `(unknown) ${store.id.slice(0, 8)}`,
  ])
  const head = ["SIZE", "GARBAGE", "REFS", "IDLE", "STATE", "WORKTREE"]
  const widths = head.map((title, i) => Math.max(title.length, ...rows.map((row) => row[i].length)))
  const line = (row: string[]) =>
    row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join("  ")
  return [line(head), ...rows.map(line)].join("\n")
}

const StatusCommand = cmd({
  command: "status",
  describe: "show how much disk the per-project snapshot stores use",
  builder: (yargs: Argv) =>
    yargs
      .option("top", { describe: "number of largest stores to list", type: "number", default: 15 })
      .option("all", { describe: "list every store", type: "boolean", default: false })
      .option("json", { ...jsonOption(), default: false }),
  async handler(args) {
    const { SnapshotStores } = await import("../../snapshot/stores")
    const now = Date.now()
    const stores = await SnapshotStores.inspect({ now })
    const total = stores.reduce((sum, store) => sum + store.bytes, 0)
    const garbage = stores.reduce((sum, store) => sum + store.garbageBytes, 0)
    const count = (state: SnapshotStores.State) => stores.filter((store) => store.state === state).length
    const orphaned = stores.filter((store) => store.state === "orphaned")
    const idle = stores.filter((store) => store.state === "idle")
    // Stranded temporaries inside a store that is removed whole are already in its size.
    const reclaimable = stores.reduce(
      (sum, store) => sum + (store.state === "orphaned" || store.state === "idle" ? store.bytes : store.garbageBytes),
      0,
    )
    if (args.json) {
      writeJson({
        root: SnapshotStores.root(),
        stores: stores.length,
        bytes: total,
        garbageBytes: garbage,
        reclaimableBytes: reclaimable,
        states: Object.fromEntries(
          (["active", "referenced", "unknown", "orphaned", "idle"] as const).map((state) => [state, count(state)]),
        ),
        entries: (args.all ? stores : stores.slice(0, Math.max(0, args.top))).map((store) => ({
          id: store.id,
          worktree: store.worktree,
          bytes: store.bytes,
          garbageBytes: store.garbageBytes,
          refs: store.refs,
          lastActivity: store.lastActivity || undefined,
          state: store.state,
        })),
      })
      return
    }
    console.log(`Snapshot root: ${SnapshotStores.root()}`)
    console.log(`Stores: ${stores.length}   Total: ${formatStorageBytes(total)}`)
    console.log(
      `States: ${count("active")} active, ${count("referenced")} referenced, ${orphaned.length} orphaned, ${idle.length} idle` +
        (count("unknown") ? `, ${count("unknown")} unknown` : ""),
    )
    if (garbage) {
      console.log(`Stranded temporary pack files: ${formatStorageBytes(garbage)} (removed by "ax-code snapshot prune")`)
    }
    console.log(`Reclaimable now: ${formatStorageBytes(reclaimable)}`)
    if (!stores.length) return
    console.log("")
    console.log(table(args.all ? stores : stores.slice(0, Math.max(0, args.top)), now))
    if (!args.all && stores.length > args.top) console.log(`\n… ${stores.length - args.top} more (use --all)`)
  },
})

const PruneCommand = cmd({
  command: "prune",
  describe: "remove stranded pack temporaries and unused snapshot stores",
  builder: (yargs: Argv) =>
    yargs
      .option("orphaned", {
        describe: "remove stores whose project directory no longer exists and that no session references",
        type: "boolean",
        default: false,
      })
      .option("idle", {
        describe: "also remove unreferenced stores with no snapshot activity for 7 days",
        type: "boolean",
        default: false,
      })
      .option("dry-run", { describe: "show what would be removed without deleting", type: "boolean", default: false })
      .option("force", { describe: "skip confirmation prompt", type: "boolean", default: false }),
  async handler(args) {
    const { SnapshotStores } = await import("../../snapshot/stores")
    const now = Date.now()
    const stores = await SnapshotStores.inspect({ now })
    const wanted = { orphaned: args.orphaned, idle: args.idle }
    const plan = await SnapshotStores.prune({ stores, ...wanted, dryRun: true, now })
    if (!plan.removed.length && !plan.garbageFiles) {
      console.log("Nothing to prune.")
      return
    }
    if (plan.removed.length) {
      console.log(`Stores to remove (${plan.removed.length}):`)
      console.log(table(plan.removed.slice(0, 25), now))
      if (plan.removed.length > 25) console.log(`… ${plan.removed.length - 25} more`)
    }
    if (plan.garbageFiles) {
      console.log(
        `Stranded temporary pack files: ${plan.garbageFiles} (${formatStorageBytes(plan.garbageBytes)}), older than 7 days`,
      )
    }
    console.log(`Would free ${formatStorageBytes(plan.freedBytes)}`)
    if (args["dry-run"]) return
    if (!args.force && !(await confirmDestructiveAction("Proceed?"))) return
    const done = await SnapshotStores.prune({ stores, ...wanted, dryRun: false, now })
    console.log(
      `Freed ${formatStorageBytes(done.freedBytes)} (${done.removed.length} stores, ${done.garbageFiles} files)`,
    )
  },
})

export const SnapshotCommand = cmd({
  command: "snapshot",
  describe: "inspect and prune undo snapshot storage",
  builder: (yargs: Argv) => yargs.command(StatusCommand).command(PruneCommand).demandCommand(),
  handler: () => {},
})
