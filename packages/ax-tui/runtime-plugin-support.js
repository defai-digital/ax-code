import { ensureRuntimePluginSupport } from "./runtime-plugin-support-configure.js";
import {
  createRuntimePlugin,
  runtimeModuleIdForSpecifier
} from "./runtime-plugin-support-configure.js";
ensureRuntimePluginSupport();
export {
  createRuntimePlugin,
  ensureRuntimePluginSupport,
  runtimeModuleIdForSpecifier
};
