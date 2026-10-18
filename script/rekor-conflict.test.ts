import { createServer } from "node:http"
import { once } from "node:events"
import { RekorWitness } from "@sigstore/sign"
import { expect, test } from "vitest"

test.each([true, false])("Rekor duplicate entry recovery uses the existing log entry (enabled=%s)", async (enabled) => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    request.resume()
    if (request.method === "POST") {
      response.writeHead(409, { location: "/api/v1/log/entries/fixture", "content-type": "application/json" })
      response.end(JSON.stringify({ message: "entry already exists" }))
    } else {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          fixture: {
            body: Buffer.from(JSON.stringify({ kind: "intoto", apiVersion: "0.0.2" })).toString("base64"),
            logIndex: 123,
            logID: "ab".repeat(32),
            integratedTime: 100,
            verification: { signedEntryTimestamp: Buffer.from("fixture").toString("base64") },
          },
        }),
      )
    }
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture listener")
    const witness = new RekorWitness({
      rekorBaseURL: `http://127.0.0.1:${address.port}`,
      entryType: "intoto",
      fetchOnConflict: enabled,
      retry: 0,
      timeout: 1000,
    })
    const result = witness.testify(
      {
        $case: "dsseEnvelope",
        dsseEnvelope: {
          payload: Buffer.from("fixture"),
          payloadType: "application/vnd.in-toto+json",
          signatures: [{ keyid: "", sig: Buffer.from("signature fixture") }],
        },
      },
      "public key fixture",
    )
    if (enabled) {
      expect((await result).tlogEntries?.[0].logIndex).toBe("123")
      expect(requests).toEqual(["POST /api/v1/log/entries", "GET /api/v1/log/entries/fixture"])
    } else {
      await expect(result).rejects.toMatchObject({ code: "TLOG_CREATE_ENTRY_ERROR", cause: { statusCode: 409 } })
      expect(requests).toEqual(["POST /api/v1/log/entries"])
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
