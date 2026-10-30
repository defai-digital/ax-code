/** Native buffers use u32 cell offsets and signed drawing coordinates. */
export function validateBufferDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 0x7fffffff ||
    height > 0x7fffffff ||
    width * height > 0x3fffffff
  ) {
    throw new RangeError(`Invalid dimensions for OptimizedBuffer: ${width}x${height}`)
  }
}

export function validateGrayscaleSource(intensities: Float32Array, width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 0 ||
    height < 0 ||
    width > 0x7fffffff ||
    height > 0x7fffffff ||
    width * height > 0xffffffff ||
    width * height > intensities.length
  ) {
    throw new RangeError(`Grayscale intensities do not contain a valid ${width}x${height} image`)
  }
}
