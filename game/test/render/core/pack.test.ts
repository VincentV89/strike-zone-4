// PD-R-4: matrix maths matches three's column-major layout and conventions.
import {
  fromAxisAngle,
  fromRotationY,
  identity,
  mat4,
  multiply,
  rotateZ,
  transformPoint,
  translate,
  writeMat,
} from '@sz/render/core/pack';
import { describe, expect, it } from 'vitest';

const p = { x: 0, y: 0, z: 0 };

describe('mat4', () => {
  it('Ry(+90°) turns -Z (yaw 0 forward) to -X (left), matching the kernel yaw convention', () => {
    transformPoint(fromRotationY(mat4(), Math.PI / 2), 0, 0, -1, p);
    expect(p.x).toBeCloseTo(-1, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('translate then rotate composes as T · R, and multiply may alias its output', () => {
    const m = translate(mat4(), mat4(), 1, 2, 3);
    rotateZ(m, m, Math.PI / 2);
    transformPoint(m, 1, 0, 0, p);
    expect([p.x, p.y, p.z].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 3, 3]);
    const a = fromRotationY(mat4(), 0.3);
    const b = fromRotationY(mat4(), -0.3);
    multiply(a, a, b);
    expect(a.map((v) => Math.round(v * 1e9) / 1e9)).toEqual(identity(mat4()));
  });

  it('axis-angle about +Y equals Ry; a zero or NaN axis gives identity', () => {
    const a = fromAxisAngle(mat4(), 0, 2, 0, 0.7);
    const b = fromRotationY(mat4(), 0.7);
    a.forEach((v, i) => {
      expect(v).toBeCloseTo(b[i] ?? Number.NaN, 12);
    });
    expect(fromAxisAngle(mat4(), 0, 0, 0, 1)).toEqual(identity(mat4()));
    expect(fromAxisAngle(mat4(), Number.NaN, 0, 0, 1)).toEqual(identity(mat4()));
  });

  it('writeMat copies 16 floats at the instance offset', () => {
    const buf = new Float32Array(32);
    writeMat(buf, 1, translate(mat4(), mat4(), 5, 6, 7));
    expect(Array.from(buf.slice(16 + 12, 16 + 15))).toEqual([5, 6, 7]);
    expect(buf[0]).toBe(0);
  });
});
