export function signal() {
  let resolve: (value?: unknown) => void
  const promise = new Promise((r) => (resolve = r))
  return {
    trigger() {
      return resolve()
    },
    wait() {
      return promise
    },
  }
}
