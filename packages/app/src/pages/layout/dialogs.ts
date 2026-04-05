export const createDialogLoader = () => {
  let dead = false
  let run = 0

  return {
    stop() {
      dead = true
      run += 1
    },
    open<T>(load: () => Promise<T>, show: (mod: T) => void) {
      const id = ++run
      void load().then((mod) => {
        if (dead || run !== id) return
        show(mod)
      })
    },
  }
}
