export function deferSessionMount(input: {
  onReady: () => void
  schedule?: (handler: () => void, delay: number) => ReturnType<typeof setTimeout>
  clear?: (handle: ReturnType<typeof setTimeout>) => void
}) {
  const schedule = input.schedule ?? setTimeout
  const clear = input.clear ?? clearTimeout
  const timer = schedule(() => {
    input.onReady()
  }, 0)

  return () => clear(timer)
}
