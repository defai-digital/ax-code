import { createAxCodeClient } from "@ax-code/sdk/v2/client"
import { createAxCodeServer } from "@ax-code/sdk/v2/server"
import { glob } from "node:fs/promises"
import { pathToFileURL } from "url"

const server = await createAxCodeServer()
const client = createAxCodeClient({ baseUrl: server.url })

const input = await Array.fromAsync(glob("packages/core/*.ts"))

const tasks: Promise<unknown>[] = []
for await (const file of input) {
  console.log("processing", file)
  const session = await client.session.create()
  if (!session.data) throw new Error("Failed to create session")
  tasks.push(
    client.session.prompt({
      sessionID: session.data.id,
      parts: [
        {
          type: "file",
          mime: "text/plain",
          url: pathToFileURL(file).href,
        },
        {
          type: "text",
          text: `Write tests for every public function in this file.`,
        },
      ],
    }),
  )
  console.log("done", file)
}

await Promise.all(
  input.map(async (file) => {
    const session = await client.session.create()
    if (!session.data) throw new Error("Failed to create session")
    console.log("processing", file)
    await client.session.prompt({
      sessionID: session.data.id,
      parts: [
        {
          type: "file",
          mime: "text/plain",
          url: pathToFileURL(file).href,
        },
        {
          type: "text",
          text: `Write tests for every public function in this file.`,
        },
      ],
    })
    console.log("done", file)
  }),
)
