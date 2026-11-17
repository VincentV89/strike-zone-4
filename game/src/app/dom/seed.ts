/** Round seeds (FD-AS-7, SD-AS-5): the only crypto use in the game. */
export interface SeedSource {
  getRandomValues(array: Uint32Array): Uint32Array;
}

export function createSeedSource(source: SeedSource = crypto): () => number {
  const buf = new Uint32Array(1);
  return () => source.getRandomValues(buf)[0] ?? 0;
}
