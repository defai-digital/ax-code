export namespace FeatureFlag {
  export function set(key: string, value: string | boolean) {
    process.env[key] = String(value)
  }
}

