/**
 * @deprecated Effect-based HTTP retry helper. New code should not import
 * from here. Per ARCHITECTURE.md, Effect is frozen outside src/effect/
 * and src/util/effect-zod.ts. This
 * file remains for existing Effect-using modules; migrate callers to
 * plain `fetch` + Result<T, E> when touching them.
 */
import { Schedule } from "effect"
import { HttpClient } from "effect/unstable/http"

export const withTransientReadRetry = <E, R>(client: HttpClient.HttpClient.With<E, R>) =>
  client.pipe(
    HttpClient.retryTransient({
      retryOn: "errors-and-responses",
      times: 2,
      schedule: Schedule.exponential(200).pipe(Schedule.jittered),
    }),
  )
