// FNV-1a over the raw bytes of a typed array. Backs determinism checks with a
// literal digest so a deleted snapshot cannot turn the gate green (team knowledge).
export function fnv1a(data: ArrayBufferView): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
