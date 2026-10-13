import { fileURLToPath } from "node:url"
import z from "zod"
import collection from "../src/provider/ax-engine/collection.json"
import { readBoundedBody } from "../src/util/http-body"
import { parseJsonStrict } from "../src/util/json-value"
import { Filesystem } from "../src/util/filesystem"
import { HubCatalog, hubArtifactMetadata, evaluateHubModel, hubModelID } from "../src/provider/ax-engine/hub-model"
import { ModelsDev } from "../src/provider/models"
import { axEngineHubCatalog } from "../src/provider/ax-engine/hub-catalog"

// Selection is a reviewed snapshot of the publisher collection. Detect drift
// before refreshing metadata rather than silently retaining an incomplete menu.
const response = await fetch("https://huggingface.co/api/collections/AutomatosX/ax-code", {
  signal: AbortSignal.timeout(15_000),
  redirect: "error",
  headers: { accept: "application/json" },
})
if (!response.ok) {
  await response.body?.cancel()
  throw new Error(`AX Code collection request failed with HTTP ${response.status}`)
}
const remote = z
  .object({ items: z.array(z.object({ type: z.string(), id: z.string().max(256) })).max(2_000) })
  .parse(parseJsonStrict(Buffer.from(await readBoundedBody(response, 2 * 1024 ** 2)).toString("utf8")))
const repositories = remote.items.filter((item) => item.type === "model").map((item) => item.id)
if (
  repositories.length !== collection.models.length ||
  repositories.some((repo, index) => repo !== collection.models[index])
) {
  throw new Error("AX Code collection changed; update collection.json, curated definitions and selection tests first")
}
if (process.argv.includes("--check-collection")) {
  console.log(`AX Code collection matches all ${repositories.length} selected repositories`)
  process.exit(0)
}

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
