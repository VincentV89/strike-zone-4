/**
 * Minimal column-major 4×4 matrix maths (PD-R-4, ADR-R-8: core stays three-free). A Mat4 is a
 * 16-number tuple used as scratch; writeMat copies one into an instance buffer slot. Layout
 * matches three's Matrix4.elements, so gl wraps the Float32Arrays without conversion.
 */
export type Mat4 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export function mat4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

/** out = a × b. out may alias a or b. */
export function multiply(out: Mat4, a: Readonly<Mat4>, b: Readonly<Mat4>): Mat4 {
  const m0 = a[0] * b[0] + a[4] * b[1] + a[8] * b[2] + a[12] * b[3];
  const m1 = a[1] * b[0] + a[5] * b[1] + a[9] * b[2] + a[13] * b[3];
  const m2 = a[2] * b[0] + a[6] * b[1] + a[10] * b[2] + a[14] * b[3];
  const m3 = a[3] * b[0] + a[7] * b[1] + a[11] * b[2] + a[15] * b[3];
  const m4 = a[0] * b[4] + a[4] * b[5] + a[8] * b[6] + a[12] * b[7];
  const m5 = a[1] * b[4] + a[5] * b[5] + a[9] * b[6] + a[13] * b[7];
  const m6 = a[2] * b[4] + a[6] * b[5] + a[10] * b[6] + a[14] * b[7];
  const m7 = a[3] * b[4] + a[7] * b[5] + a[11] * b[6] + a[15] * b[7];
  const m8 = a[0] * b[8] + a[4] * b[9] + a[8] * b[10] + a[12] * b[11];
  const m9 = a[1] * b[8] + a[5] * b[9] + a[9] * b[10] + a[13] * b[11];
  const m10 = a[2] * b[8] + a[6] * b[9] + a[10] * b[10] + a[14] * b[11];
  const m11 = a[3] * b[8] + a[7] * b[9] + a[11] * b[10] + a[15] * b[11];
  const m12 = a[0] * b[12] + a[4] * b[13] + a[8] * b[14] + a[12] * b[15];
  const m13 = a[1] * b[12] + a[5] * b[13] + a[9] * b[14] + a[13] * b[15];
  const m14 = a[2] * b[12] + a[6] * b[13] + a[10] * b[14] + a[14] * b[15];
  const m15 = a[3] * b[12] + a[7] * b[13] + a[11] * b[14] + a[15] * b[15];
  out[0] = m0;
  out[1] = m1;
  out[2] = m2;
  out[3] = m3;
  out[4] = m4;
  out[5] = m5;
  out[6] = m6;
  out[7] = m7;
  out[8] = m8;
  out[9] = m9;
  out[10] = m10;
  out[11] = m11;
  out[12] = m12;
  out[13] = m13;
  out[14] = m14;
  out[15] = m15;
  return out;
}

export function fromTranslation(out: Mat4, x: number, y: number, z: number): Mat4 {
  identity(out);
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

export function fromRotationX(out: Mat4, a: number): Mat4 {
  identity(out);
  const c = Math.cos(a);
  const s = Math.sin(a);
  out[5] = c;
  out[6] = s;
  out[9] = -s;
  out[10] = c;
  return out;
}

export function fromRotationY(out: Mat4, a: number): Mat4 {
  identity(out);
  const c = Math.cos(a);
  const s = Math.sin(a);
  out[0] = c;
  out[2] = -s;
  out[8] = s;
  out[10] = c;
  return out;
}

export function fromRotationZ(out: Mat4, a: number): Mat4 {
  identity(out);
  const c = Math.cos(a);
  const s = Math.sin(a);
  out[0] = c;
  out[1] = s;
  out[4] = -s;
  out[5] = c;
  return out;
}

/** Rotation by `a` about the unit axis (x, y, z). A zero or non-finite axis gives identity. */
export function fromAxisAngle(out: Mat4, x: number, y: number, z: number, a: number): Mat4 {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (!(len >= 1e-9 && Number.isFinite(len))) return identity(out);
  const ux = x / len;
  const uy = y / len;
  const uz = z / len;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  identity(out);
  out[0] = t * ux * ux + c;
  out[1] = t * ux * uy + s * uz;
  out[2] = t * ux * uz - s * uy;
  out[4] = t * ux * uy - s * uz;
  out[5] = t * uy * uy + c;
  out[6] = t * uy * uz + s * ux;
  out[8] = t * ux * uz + s * uy;
  out[9] = t * uy * uz - s * ux;
  out[10] = t * uz * uz + c;
  return out;
}

const step = mat4();

/** out = m × T(x, y, z). */
export function translate(out: Mat4, m: Readonly<Mat4>, x: number, y: number, z: number): Mat4 {
  return multiply(out, m, fromTranslation(step, x, y, z));
}

/** out = m × Ry(a). */
export function rotateY(out: Mat4, m: Readonly<Mat4>, a: number): Mat4 {
  return multiply(out, m, fromRotationY(step, a));
}

/** out = m × Rx(a). */
export function rotateX(out: Mat4, m: Readonly<Mat4>, a: number): Mat4 {
  return multiply(out, m, fromRotationX(step, a));
}

/** out = m × Rz(a). */
export function rotateZ(out: Mat4, m: Readonly<Mat4>, a: number): Mat4 {
  return multiply(out, m, fromRotationZ(step, a));
}

/** out = m × S(x, y, z). */
export function scaleBy(out: Mat4, m: Readonly<Mat4>, x: number, y: number, z: number): Mat4 {
  identity(step);
  step[0] = x;
  step[5] = y;
  step[10] = z;
  return multiply(out, m, step);
}

/** Copies m into buf at instance `index` (16 floats per instance). */
export function writeMat(buf: Float32Array, index: number, m: Readonly<Mat4>): void {
  buf.set(m, index * 16);
}

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

/** out = m × (x, y, z, 1). */
export function transformPoint(
  m: Readonly<Mat4>,
  x: number,
  y: number,
  z: number,
  out: MutableVec3,
): MutableVec3 {
  out.x = m[0] * x + m[4] * y + m[8] * z + m[12];
  out.y = m[1] * x + m[5] * y + m[9] * z + m[13];
  out.z = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}
