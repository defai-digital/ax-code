type Fn<Args extends unknown[], Result> = (...args: Args) => Result | Promise<Result>

export namespace Gate {
  export function create<Args extends unknown[], Result>(fn: Fn<Args, Result>) {
    let busy = false

    return async (...args: Args): Promise<Result | undefined> => {
      if (busy) return
      busy = true
      try {
        return await fn(...args)
      } finally {
        busy = false
      }
    }
  }
}
