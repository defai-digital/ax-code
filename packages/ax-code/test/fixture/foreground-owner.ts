import { ForegroundOwnership } from "../../src/session/foreground-ownership"

const lease = ForegroundOwnership.acquire(process.argv[2], process.argv[3])
lease.begin()
process.stdout.write("owned\n")
setInterval(() => {}, 1000)
