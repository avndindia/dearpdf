/** Decode an image on-device, including iOS Safari that rejects imageOrientation. */
export async function decodeImageBitmap(
  source: Blob | ImageBitmapSource,
  options?: ImageBitmapOptions,
): Promise<ImageBitmap> {
  if (options) {
    try {
      return await createImageBitmap(source, options);
    } catch {
      // Safari < 16.4 and some in-app browsers throw on imageOrientation.
    }
  }
  return createImageBitmap(source);
}
