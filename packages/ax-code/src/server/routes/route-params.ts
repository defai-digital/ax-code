import { ProviderID } from "@/provider/schema"

export type ProviderRouteContext = {
  req: {
    valid: (input: "param") => { providerID: string }
  }
}

export function parseProviderID(c: ProviderRouteContext) {
  return ProviderID.make(c.req.valid("param").providerID)
}
