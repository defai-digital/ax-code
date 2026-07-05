export const createRouteRegistry = () => {
  const routes = new Map()
  const register = (method, routePath, handlers) => {
    routes.set(`${method} ${routePath}`, handlers.at(-1))
  }

  return {
    app: {
      get(routePath, ...handlers) {
        register("GET", routePath, handlers)
      },
      post(routePath, ...handlers) {
        register("POST", routePath, handlers)
      },
      put(routePath, ...handlers) {
        register("PUT", routePath, handlers)
      },
      delete(routePath, ...handlers) {
        register("DELETE", routePath, handlers)
      },
    },
    getRoute(method, routePath) {
      return routes.get(`${method} ${routePath}`)
    },
  }
}

export const createMockResponse = () => {
  let statusCode = 200
  let body = null
  let sent = null
  let contentType = null
  let flushed = false
  const headers = new Map()

  return {
    status(code) {
      statusCode = code
      return this
    },
    type(value) {
      contentType = value
      return this
    },
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value)
      return this
    },
    getHeader(name) {
      return headers.get(name.toLowerCase())
    },
    flushHeaders() {
      flushed = true
      return this
    },
    json(payload) {
      body = payload
      return this
    },
    send(payload) {
      sent = payload
      body = payload
      return this
    },
    write(chunk) {
      body = `${body ?? ""}${String(chunk)}`
      return true
    },
    end() {
      return this
    },
    get statusCode() {
      return statusCode
    },
    get body() {
      return body
    },
    get sent() {
      return sent
    },
    get contentType() {
      return contentType
    },
    get headers() {
      return headers
    },
    get flushed() {
      return flushed
    },
  }
}

export const createMockRequest = ({ host, origin, protocol = "http", forwardedHost, forwardedProto } = {}) => {
  const listeners = new Map()

  return {
    headers: {
      host,
      ...(origin ? { origin } : {}),
      ...(protocol ? { "x-forwarded-proto": protocol } : {}),
      ...(forwardedHost ? { "x-forwarded-host": forwardedHost } : {}),
      ...(forwardedProto ? { "x-forwarded-proto": forwardedProto } : {}),
    },
    hostname: host,
    socket: {
      encrypted: protocol === "https",
    },
    on(event, handler) {
      listeners.set(event, handler)
      return this
    },
    emit(event) {
      const handler = listeners.get(event)
      if (typeof handler === "function") {
        handler()
      }
    },
  }
}
