/**
 * MiniMax Code (mcode) rejects a bare model id in `--model` with
 * "--model must use provider/model or provider/model#variant". A catalog id
 * without a provider prefix is sent as `minimax/<id>`; ids the user or the
 * vendor already namespaced (`minimax/...`, `openrouter/...`) pass through.
 */
export function minimaxModelArg(modelID: string): string {
  return modelID.includes("/") ? modelID : `minimax/${modelID}`
}
