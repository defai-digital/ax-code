export const createRouteRegistry = () => {
  const routes = new Map()

  return {
    app: {
      get(routePath, handler) {
        routes.set(`GET ${routePath}`, handler)
      },
      post(routePath, handler) {
        routes.set(`POST ${routePath}`, handler)
      },
      put(routePath, handler) {
        routes.set(`PUT ${routePath}`, handler)
      },
      delete(routePath, handler) {
        routes.set(`DELETE ${routePath}`, handler)
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
      headers.set(name, value)
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
  }
}
