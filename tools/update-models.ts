#!/usr/bin/env -S npx tsx

// Compatibility entry point. The canonical script executes on import and
// reads process.argv directly, so a dynamic import preserves flags such as
// --check without requiring a second, divergent implementation.
await import("../packages/ax-code/script/update-models")
