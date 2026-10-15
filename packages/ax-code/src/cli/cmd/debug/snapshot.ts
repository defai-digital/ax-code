import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

// snapshot/index carries Config and the storage graph; load it per handler
// so `--help` never evaluates it.
const loadSnapshot = async () => (await import("../../../snapshot")).Snapshot

export const SnapshotCommand = cmd({
  command: "snapshot",
  describe: "snapshot debugging utilities",
  builder: (yargs) => yargs.command(TrackCommand).command(PatchCommand).command(DiffCommand).demandCommand(),
  async handler() {},
})

const TrackCommand = cmd({
  command: "track",
  describe: "track current snapshot state",
  async handler() {
    const Snapshot = await loadSnapshot()
    await bootstrap(process.cwd(), async () => {
      console.log(await Snapshot.track())
    })
  },
})

const PatchCommand = cmd({
  command: "patch <hash>",
  describe: "show patch for a snapshot hash",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  async handler(args) {
    const Snapshot = await loadSnapshot()
    await bootstrap(process.cwd(), async () => {
      console.log(await Snapshot.patch(args.hash))
    })
  },
})

const DiffCommand = cmd({
  command: "diff <hash>",
  describe: "show diff for a snapshot hash",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  async handler(args) {
    const Snapshot = await loadSnapshot()
    await bootstrap(process.cwd(), async () => {
      console.log(await Snapshot.diff(args.hash))
    })
  },
})
