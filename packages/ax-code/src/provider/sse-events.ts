export function eventData(event: string): string {
  return event
    .split(/\r\n|\r|\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n")
}

export function mapSSEEvents(response: Response, map: (event: string) => string): Response {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response
  const source = response.body.pipeThrough(new TextDecoderStream())
  const encoder = new TextEncoder()

  async function* events(): AsyncGenerator<Uint8Array> {
    let pending = ""
    for await (const chunk of source) {
      pending += chunk
      let boundary: RegExpExecArray | null
      while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(pending))) {
        yield encoder.encode(map(pending.slice(0, boundary.index)) + boundary[0])
        pending = pending.slice(boundary.index + boundary[0].length)
      }
    }
    if (pending) yield encoder.encode(map(pending))
  }

  const iterator = events()
  const body = new ReadableStream(
    {
      async pull(controller) {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(next.value)
      },
      async cancel(reason) {
        await source.cancel(reason).catch(async () => {
          await iterator.return(undefined)
        })
      },
    },
    { highWaterMark: 0 },
  )
  const headers = new Headers(response.headers)
  // @scan-suppress security_scan - Headers.delete removes stale length metadata.
  headers.delete("content-length")
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}
