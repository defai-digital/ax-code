export function createSseResponse({ blocks = [], signal, holdOpen = false } = {}) {
  const encoder = new TextEncoder()
  let index = 0

  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (index < blocks.length) {
              return { value: encoder.encode(blocks[index++]), done: false }
            }

            if (!holdOpen) {
              return { value: undefined, done: true }
            }

            return new Promise((_resolve, reject) => {
              const onAbort = () => {
                signal.removeEventListener("abort", onAbort)
                const error = new Error("Aborted")
                error.name = "AbortError"
                reject(error)
              }
              signal.addEventListener("abort", onAbort, { once: true })
            })
          },
        }
      },
    },
  }
}
