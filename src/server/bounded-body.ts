/**
 * The body as text, or null when it is over `maxBytes`: by its declared length, or while reading,
 * so a missing or false content-length cannot make a route buffer more than the cap.
 */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  // An unparseable content-length (NaN) fails the comparison and is rejected on purpose.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!(declared <= maxBytes)) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
