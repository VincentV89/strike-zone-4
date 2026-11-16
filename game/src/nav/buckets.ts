/** Spatial bucket grid shared by the build and nearestNode (8 m cells over x and z). */
export const BUCKET_SIZE = 8;

/** Integer key for the cell containing (x, z); valid for any finite map coordinates. */
export function bucketKey(x: number, z: number): number {
  const cx = Math.floor(x / BUCKET_SIZE) + 4096;
  const cz = Math.floor(z / BUCKET_SIZE) + 4096;
  return cx * 8192 + cz;
}
