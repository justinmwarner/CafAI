/**
 * Random ids for records and messages.
 *
 * crypto.randomUUID() only arrived in Chromium 92, one milestone above the
 * WebView floor of Decaid's oldest tablets, so build a v4 UUID from
 * crypto.getRandomValues() (Chromium 11+) instead.
 */
export function newId(prefix = ''): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}
