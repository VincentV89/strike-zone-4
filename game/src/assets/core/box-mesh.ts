/**
 * Pure box mesh writer shared by map geometry, bot parts and viewmodels (LC-A-2). Each box is
 * 24 vertices and 12 triangles. Rotation follows world-maps: q = qYaw × qPitch, pitch about the
 * box's local X axis (BR-WM rotation convention), so drawn boxes match the physics colliders.
 */
import type { Vec3 } from '@sz/kernel';

export const BOX_VERTICES = 24;
export const BOX_TRIANGLES = 12;

export type Rgb = readonly [number, number, number];

export interface BoxSpec {
  readonly center: Vec3;
  readonly half: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  /** Linear 0..1 vertex colour, used when the batch is built with colours. */
  readonly color?: Rgb;
}

export interface MeshArrays {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly colors: Float32Array | null;
  readonly indices: Uint32Array;
  readonly triangles: number;
}

export interface BoxBatchOptions {
  /** World metres per texture tile; omit for 0..1 UVs per face. */
  readonly uvTileM?: number;
  readonly withColor?: boolean;
}

type Axis = readonly [number, number, number];
interface Face {
  readonly n: Axis;
  readonly u: Axis;
  readonly v: Axis;
}

/** u × v = n for every face, so (0,1,2),(0,2,3) winds counter-clockwise seen from outside. */
const FACES: ReadonlyArray<Face> = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const fin = (x: number): number => (Number.isFinite(x) ? x : 0);

/** Builds one indexed mesh from a list of boxes. Non-finite numbers are treated as 0. */
export function buildBoxes(boxes: ReadonlyArray<BoxSpec>, opts: BoxBatchOptions = {}): MeshArrays {
  const count = boxes.length;
  const positions = new Float32Array(count * BOX_VERTICES * 3);
  const normals = new Float32Array(count * BOX_VERTICES * 3);
  const uvs = new Float32Array(count * BOX_VERTICES * 2);
  const colors = opts.withColor === true ? new Float32Array(count * BOX_VERTICES * 3) : null;
  const indices = new Uint32Array(count * BOX_TRIANGLES * 3);
  const tile = opts.uvTileM !== undefined && opts.uvTileM > 0 ? opts.uvTileM : 0;
  let vi = 0;
  let ii = 0;
  for (const box of boxes) {
    const hx = Math.abs(fin(box.half.x));
    const hy = Math.abs(fin(box.half.y));
    const hz = Math.abs(fin(box.half.z));
    const cy = Math.cos(fin(box.yaw));
    const sy = Math.sin(fin(box.yaw));
    const cp = Math.cos(fin(box.pitch));
    const sp = Math.sin(fin(box.pitch));
    const cx = fin(box.center.x);
    const cyy = fin(box.center.y);
    const cz = fin(box.center.z);
    const color = box.color ?? [1, 1, 1];
    for (const f of FACES) {
      const w = 2 * Math.abs(hx * f.u[0] + hy * f.u[1] + hz * f.u[2]);
      const h = 2 * Math.abs(hx * f.v[0] + hy * f.v[1] + hz * f.v[2]);
      const base = vi;
      for (const [a, b] of CORNERS) {
        const lx = hx * (f.n[0] + a * f.u[0] + b * f.v[0]);
        const ly = hy * (f.n[1] + a * f.u[1] + b * f.v[1]);
        const lz = hz * (f.n[2] + a * f.u[2] + b * f.v[2]);
        // pitch about local X, then yaw about +Y
        const py = ly * cp - lz * sp;
        const pz = ly * sp + lz * cp;
        positions[vi * 3] = cx + lx * cy + pz * sy;
        positions[vi * 3 + 1] = cyy + py;
        positions[vi * 3 + 2] = cz - lx * sy + pz * cy;
        const ny = f.n[1] * cp - f.n[2] * sp;
        const nz = f.n[1] * sp + f.n[2] * cp;
        normals[vi * 3] = f.n[0] * cy + nz * sy;
        normals[vi * 3 + 1] = ny;
        normals[vi * 3 + 2] = -f.n[0] * sy + nz * cy;
        uvs[vi * 2] = tile > 0 ? (((a + 1) / 2) * w) / tile : (a + 1) / 2;
        uvs[vi * 2 + 1] = tile > 0 ? (((b + 1) / 2) * h) / tile : (b + 1) / 2;
        if (colors !== null) {
          colors[vi * 3] = color[0];
          colors[vi * 3 + 1] = color[1];
          colors[vi * 3 + 2] = color[2];
        }
        vi += 1;
      }
      indices[ii++] = base;
      indices[ii++] = base + 1;
      indices[ii++] = base + 2;
      indices[ii++] = base;
      indices[ii++] = base + 2;
      indices[ii++] = base + 3;
    }
  }
  return { positions, normals, uvs, colors, indices, triangles: count * BOX_TRIANGLES };
}
