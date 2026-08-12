import { privateGpuVendor } from "../private-gpu/presets"

const vendor = privateGpuVendor("alibaba-pai")!

export const ALIBABA_PAI_PROVIDER_ID = vendor.id
export const ALIBABA_PAI_DISPLAY_NAME = vendor.name
export const ALIBABA_PAI_API_KEY_ENV = vendor.envKey
export const ALIBABA_PAI_BASE_URL_ENV = vendor.envBaseURL!
export const ALIBABA_PAI_NPM = vendor.npm

/** Cold GPU services can take a while to emit the first token. */
export const ALIBABA_PAI_REQUEST_TIMEOUT_MS = 180_000
export const ALIBABA_PAI_DISCOVERY_TIMEOUT_MS = 10_000
