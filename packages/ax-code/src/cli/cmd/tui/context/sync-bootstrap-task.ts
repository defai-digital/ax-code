export interface BootstrapResponse<T> {
  data?: T
}

export type BootstrapTask = () => Promise<unknown>

export function createBootstrapTask<TInput, TOutput>(
  request: () => Promise<TInput>,
  normalize: (value: TInput) => TOutput,
  apply: (value: TOutput) => void,
) {
  return () =>
    Promise.resolve()
      .then(request)
      .then((value) => {
        apply(normalize(value))
      })
}

export function createBootstrapResponseTask<TInput, TOutput>(
  request: () => Promise<BootstrapResponse<TInput>>,
  normalize: (value: TInput | undefined) => TOutput,
  apply: (value: TOutput) => void,
) {
  return createBootstrapTask(request, (response) => normalize(response.data), apply)
}
