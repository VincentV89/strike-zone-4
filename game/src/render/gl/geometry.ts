/** BufferGeometry from pure mesh arrays (render side twin of assets/gl/materials geometryFrom). */
import type { MeshArrays } from '@sz/assets/core/box-mesh';
import { BufferAttribute, BufferGeometry } from 'three';

export function geometryFromArrays(mesh: MeshArrays): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  g.setAttribute('uv', new BufferAttribute(mesh.uvs, 2));
  if (mesh.colors !== null) g.setAttribute('color', new BufferAttribute(mesh.colors, 3));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  return g;
}
