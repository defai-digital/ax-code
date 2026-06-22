export function shouldTriggerUpstreamHealthCheck(upstream) {
  if (!upstream) {
    return true
  }

  if (!upstream.body) {
    return upstream.ok || upstream.status >= 500
  }

  return upstream.status >= 500
}
