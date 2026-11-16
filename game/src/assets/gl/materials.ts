/**
 * GPU objects from pure asset data (LC-G-2, ADR-R-5, ADR-R-9): DataTextures from typed-array
 * pixels (no canvas, no URL loaders), Lambert world materials, additive or alpha sprite materials.
 */
import type { MeshArrays } from '@sz/assets/core/box-mesh';
import type { SpriteKind } from '@sz/assets/core/textures';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearMipmapLinearFilter,
  LinearFilter,
  MeshBasicMaterial,
  NormalBlending,
  RGBAFormat,
  RepeatWrapping,
  ClampToEdgeWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';

export function tileTexture(pixels: Uint8Array, size: number): DataTexture {
  const tex = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function spriteTexture(pixels: Uint8Array, size: number): DataTexture {
  const tex = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function geometryFrom(mesh: MeshArrays): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  g.setAttribute('uv', new BufferAttribute(mesh.uvs, 2));
  if (mesh.colors !== null) g.setAttribute('color', new BufferAttribute(mesh.colors, 3));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** Muzzle, puff and spark add light; decals darken with alpha. All skip depth writes. */
export function effectMaterialFor(kind: SpriteKind, map: DataTexture): MeshBasicMaterial {
  const additive = kind !== 'decal';
  return new MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
    polygonOffset: kind === 'decal',
    polygonOffsetFactor: -2,
    fog: kind !== 'muzzle',
  });
}
