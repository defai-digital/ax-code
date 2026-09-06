import { fileURLToPath } from "node:url"
import { Filesystem } from "../src/util/filesystem"
import { axEngineHubCatalog } from "../src/provider/ax-engine/hub-catalog"

const result = await axEngineHubCatalog.refresh()
if (result.source !== "remote" || result.warnings.length) {
  throw new Error(result.warnings.join("\n") || "AutomatosX catalog refresh did not complete")
}
const target = fileURLToPath(new URL("../src/provider/ax-engine/hub-catalog-snapshot.json", import.meta.url))
await Filesystem.writeJson(target, result.catalog)
const inspected = await axEngineHubCatalog.inspect()
const counts = Object.groupBy(inspected.decisions, (decision) => decision.policy)
console.log(
  JSON.stringify(
    {
      repositories: inspected.decisions.length,
      candidates: inspected.definitions.length,
      decisions: Object.fromEntries(Object.entries(counts).map(([key, rows]) => [key, rows?.length])),
      output: target,
    },
    null,
    2,
  ),
)
