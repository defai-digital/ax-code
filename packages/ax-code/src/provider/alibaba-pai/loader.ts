import { PRIVATE_GPU_LOADERS } from "../private-gpu/loader"
import type { CustomLoader } from "../loaders"
import { ALIBABA_PAI_PROVIDER_ID } from "./constants"

export function alibabaPaiLoader(): CustomLoader {
  return PRIVATE_GPU_LOADERS[ALIBABA_PAI_PROVIDER_ID]
}
