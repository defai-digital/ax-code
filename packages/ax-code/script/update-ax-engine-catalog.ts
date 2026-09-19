import { fileURLToPath } from "node:url"
import { Filesystem } from "../src/util/filesystem"
import { HubCatalog, hubArtifactMetadata, evaluateHubModel, hubModelID } from "../src/provider/ax-engine/hub-model"
import { ModelsDev } from "../src/provider/models"
import { axEngineHubCatalog } from "../src/provider/ax-engine/hub-catalog"

const result = await axEngineHubCatalog.refresh()
if (result.source !== "remote" || result.warnings.length) {
  throw new Error(result.warnings.join("\n") || "AutomatosX catalog refresh did not complete")
}
const target = fileURLToPath(new URL("../src/provider/ax-engine/hub-catalog-snapshot.json", import.meta.url))
// Retain complete historical identities for offline status/cleanup when the Hub
// removes a repository or stops expanding metadata for an excluded source.
const previous = HubCatalog.parse(await Filesystem.readJson(target))
const catalog = await ModelsDev.get()
const models = new Map(previous.models.map((model) => [hubModelID(model), model]))
for (const model of result.catalog.models) {
  if (!models.has(hubModelID(model)) || hubArtifactMetadata(model, evaluateHubModel(model, catalog))) {
    models.set(hubModelID(model), model)
  }
}
await Filesystem.writeJson(target, { ...result.catalog, models: [...models.values()] })
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
