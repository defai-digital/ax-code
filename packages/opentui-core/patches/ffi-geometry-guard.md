# `ffi-geometry-guard`

OpenTUI native draw symbols declare x/y/width/height as `u32`. Node's FFI
marshalling rejects negative, fractional, or non-finite values. A
`LineNumberRenderable` scrolled above the viewport produces `y < 0`; a gutter
wider than its container produces `width < 0`. Either threw every frame.

## Contract

1. `ffiCellOrigin(x, y)` floors and drops off-screen / non-finite origins.
2. Point-draw methods (`bufferDrawText`, `bufferSetCell`,
   `bufferSetCellWithAlphaBlending`, `bufferDrawChar`,
   `bufferDrawSuperSampleBuffer`) call that helper before FFI.
3. `bufferFillRect` floors, clips a negative origin, and skips non-positive
   width/height before the native call.

Regression: `packages/ax-code/test/cli/tui/opentui-ffi-coordinate-guard.test.ts`.
